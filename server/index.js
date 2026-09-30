import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate, ensureDefaultResellers, hashPassword, requireAuth, requireRole, signUser } from './auth.js';
import { categoryList, ensureCategoriesShape, ensureCommentsShape, ensureSubcategoriesShape, isValidSubcategory, subcategoryList, subcategoryMap, generalCategoryNames, mutateStore, productTotalStock, publicComment, publicProduct, readStore, resellerCategoryNames, visibleCategoryNames } from './db.js';
import { deleteImage, uploadImage } from './imageStorage.js';
import { createSeoRouter, createHomeSeo } from './seoRoutes.js';

const app = express();
app.disable('x-powered-by');
// Behind Cloudflare/nginx, req.protocol otherwise always reads 'http'. This
// makes Express trust X-Forwarded-Proto so req.protocol is correct — used
// only by the new SEO routes' fallback URL detection (server/seo.js prefers
// the SITE_URL env var; this is just a safety net).
app.set('trust proxy', true);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 5 } });
const root = path.dirname(fileURLToPath(import.meta.url));
ensureDefaultResellers();
ensureCategoriesShape();
ensureCommentsShape(); ensureSubcategoriesShape();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const safeUser = (req) => ({ id: req.auth.sub, username: req.auth.username, role: req.auth.role });
const priceOf = (product) => Number(product.salePrice || product.price);
// Turns client-submitted [{label, stock}] (max 4, custom-typed size names) into { sizes, inventory }
function buildSizesInventory(sizeBoxes) {
  const boxes = Array.isArray(sizeBoxes) ? sizeBoxes.filter((b) => String(b?.label || '').trim()) : [];
  if (!boxes.length) throw new Error('Add at least one size with a stock quantity');
  if (boxes.length > 4) throw new Error('Maximum 4 sizes per product');
  const labels = boxes.map((b) => String(b.label).trim());
  if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) throw new Error('Size names must be unique');
  const sizes = labels;
  const inventory = Object.fromEntries(boxes.map((b) => [`Default-${String(b.label).trim()}`, Math.max(0, Number(b.stock) || 0)]));
  return { sizes, inventory };
}
// ---- Owner-defined product-form rules, per category / subcategory ----
// Stored under store.formConfigs[<categoryId or subcategoryId>]. Nothing existing is migrated: no rule saved = the classic clothing form (sizes + colours), exactly as before.
const FORM_EXTRA_FIELDS = { volume: 'Volume (ml)', scentType: 'Scent type', modelNumber: 'Model number', brand: 'Brand', material: 'Material', weight: 'Weight' };
const defaultFormConfig = () => ({ fields: { sizes: { show: true, help: '' }, colors: { show: true, help: '' }, ...Object.fromEntries(Object.keys(FORM_EXTRA_FIELDS).map((k) => [k, { show: false, required: false, help: '' }])), stock: { show: true, required: true, help: '' } } });
function sanitizeFormConfig(input) {
  const base = defaultFormConfig(); const given = input?.fields || {};
  for (const key of Object.keys(base.fields)) {
    const f = given[key] || {}; const target = base.fields[key];
    if (key !== 'stock' && typeof f.show === 'boolean') target.show = f.show;
    if (key in FORM_EXTRA_FIELDS) target.required = target.show && Boolean(f.required);
    target.help = String(f.help || '').trim().slice(0, 160);
  }
  return base;
}
function formConfigFor(store, categoryName, subName) {
  const cats = (store.categories || []).filter((c) => c && typeof c === 'object');
  const category = cats.find((c) => c.name === categoryName);
  const sub = category && subName ? (store.subcategories || []).find((x) => x.categoryId === category.id && x.name === subName) : null;
  const all = store.formConfigs || {};
  const raw = (sub && all[sub.id]) || (category && all[category.id]);
  return raw ? sanitizeFormConfig(raw) : defaultFormConfig();
}
function buildAttributes(input, cfg) {
  const out = {};
  for (const [key, label] of Object.entries(FORM_EXTRA_FIELDS)) {
    const rule = cfg.fields[key]; if (!rule?.show) continue;
    const value = String(input?.[key] ?? '').trim().slice(0, 120);
    if (rule.required && !value) throw new Error(`${label} is required for this category`);
    if (value) out[key] = value;
  }
  return out;
}
// Turns client-submitted colour/design blocks — each with its own photo set and per-size stock — into the full variant shape.
// cfg decides whether sizes / colours apply at all; stock quantity is mandatory in every mode.
function buildVariants(colorBlocks, cfg = defaultFormConfig()) {
  const useColors = cfg.fields.colors.show !== false; const useSizes = cfg.fields.sizes.show !== false;
  let blocks = Array.isArray(colorBlocks) ? colorBlocks : [];
  blocks = useColors ? blocks.filter((b) => String(b?.name || '').trim()) : blocks.slice(0, 1).map((b) => ({ ...b, name: 'Default' }));
  if (!blocks.length) throw new Error(useColors ? 'Add at least one colour/design with photos and stock' : 'Add photos and stock quantity for this product');
  if (blocks.length > 4) throw new Error('Maximum 4 colours/designs per product');
  const names = blocks.map((b) => String(b.name).trim());
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) throw new Error('Colour/design names must be unique');
  for (const b of blocks) { if (!b.images?.length) throw new Error(useColors ? `Add at least one photo for "${b.name}"` : 'Add at least one photo'); if (b.images.length > 5) throw new Error(`Maximum 5 photos per colour/design ("${b.name}")`); }
  let sizes;
  if (useSizes) {
    const sizeSet = new Set();
    for (const b of blocks) Object.keys(b.stocks || {}).forEach((s) => { if (String(s).trim()) sizeSet.add(String(s).trim()); });
    sizes = [...sizeSet];
    if (!sizes.length) throw new Error('Add at least one size with a stock quantity');
    if (sizes.length > 4) throw new Error('Maximum 4 sizes per product');
  } else {
    sizes = ['One Size'];
    for (const b of blocks) if (String(b.stocks?.['One Size'] ?? '').trim() === '') throw new Error('Stock quantity is required');
  }
  const inventory = {}; const galleryByColor = {}; const imagePublicIdsByColor = {};
  for (const b of blocks) {
    const name = String(b.name).trim();
    galleryByColor[name] = b.images || [];
    imagePublicIdsByColor[name] = b.imagePublicIds || [];
    for (const size of sizes) inventory[`${name}-${size}`] = Math.max(0, Number(b.stocks?.[size]) || 0);
  }
  if (Object.values(inventory).reduce((sum, v) => sum + v, 0) < 1) throw new Error('Stock quantity is required — enter how many pieces are available');
  const colors = names;
  const images = galleryByColor[names[0]] || [];
  const imagePublicIds = Object.values(imagePublicIdsByColor).flat();
  return { colors, sizes, inventory, galleryByColor, imagePublicIdsByColor, images, imagePublicIds };
}
const resellerProduct = (listing, reseller) => { const sizes = listing.sizes || ['S', 'M', 'L', 'XL']; const colors = listing.colors || ['Black']; const inventory = listing.inventory || Object.fromEntries(colors.flatMap((color) => sizes.map((size) => [`${color}-${size}`, 5]))); return { ...listing, name: listing.title, shortDescription: listing.shortDescription || 'A considered partner piece.', description: listing.description || 'A considered piece from the ZEEOR partner edit.', sku: listing.sku || listing.id, collection: listing.collection || 'Partner Edit', gender: listing.gender || 'Unisex', sizes, colors, inventory, galleryByColor: listing.galleryByColor || {}, tags: listing.tags || [], flags: { featured: false, new: true, bestseller: false, sale: Boolean(listing.salePrice) }, resellerId: reseller.id, sellerWhatsapp: reseller.whatsapp, sellerName: reseller.displayName, source: 'reseller', published: listing.active !== false }; };
const catalogItems = (store) => [...store.products, ...store.resellers.filter((reseller) => reseller.active !== false).flatMap((reseller) => (reseller.listings || []).filter((listing) => listing.active !== false).map((listing) => resellerProduct(listing, reseller)))];

app.get('/api/health', (_req, res) => res.json({ ok: true, brand: 'ZEEOR' }));
app.get('/api/cms', (_req, res) => res.json(readStore().cms));
app.get('/api/settings', (_req, res) => res.json(readStore().settings));
app.patch('/api/admin/settings', requireAuth, requireRole('owner'), (req, res) => { let updated; mutateStore((store) => { store.settings = { ...store.settings, ...req.body }; updated = store.settings; return store; }); res.json(updated); });
app.get('/api/categories', (_req, res) => res.json(visibleCategoryNames(readStore())));
app.get('/api/subcategories', (_req, res) => res.json(subcategoryMap(readStore())));
app.get('/api/products', (req, res) => {
  const store = readStore();
  let items = catalogItems(store).filter((p) => p.published);
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q) items = items.filter((p) => [p.name, p.sku, p.category, p.collection, ...(p.tags || [])].join(' ').toLowerCase().includes(q));
  if (req.query.category) items = items.filter((p) => p.category.toLowerCase() === String(req.query.category).toLowerCase());
  if (req.query.sale === 'true') items = items.filter((p) => p.flags.sale);
  if (req.query.new === 'true') items = items.filter((p) => p.flags.new);
  if (req.query.collection) items = items.filter((p) => p.collection.toLowerCase() === String(req.query.collection).toLowerCase());
  if (req.query.gender) items = items.filter((p) => p.gender.toLowerCase() === String(req.query.gender).toLowerCase() || p.gender === 'Unisex');
  const sort = String(req.query.sort || 'featured');
  if (sort === 'price-asc') items.sort((a, b) => priceOf(a) - priceOf(b));
  if (sort === 'price-desc') items.sort((a, b) => priceOf(b) - priceOf(a));
  if (sort === 'newest') items.sort((a, b) => Number(b.flags.new) - Number(a.flags.new));
  if (sort === 'bestselling') items.sort((a, b) => Number(b.flags.bestseller) - Number(a.flags.bestseller));
  res.json({ products: items.map(publicProduct), categories: visibleCategoryNames(store), subcategories: subcategoryMap(store), collections: [...new Set(items.map((p) => p.collection))] });
});
app.get('/api/products/:id', (req, res) => {
  const product = catalogItems(readStore()).find((p) => p.id === req.params.id || p.slug === req.params.id);
  product ? res.json(publicProduct(product)) : res.status(404).json({ error: 'Product not found' });
});

// Public comments — visible to everyone (name + text only). Email/phone are collected but only the owner ever sees them.
app.get('/api/products/:id/comments', (req, res) => {
  const list = (readStore().comments || []).filter((c) => c.productId === req.params.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(list.map(publicComment));
});
app.post('/api/products/:id/comments', (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Write a comment before submitting' });
  const email = String(req.body.email || '').trim();
  const phone = String(req.body.phone || '').trim();
  if (!email && !phone) return res.status(400).json({ error: 'Please share an email or WhatsApp number so the studio can follow up if needed' });
  const comment = { id: `cm-${Date.now()}`, productId: req.params.id, name: String(req.body.name || '').trim() || 'Guest', email, phone, text, createdAt: new Date().toISOString() };
  mutateStore((store) => { store.comments = [...(store.comments || []), comment]; return store; });
  res.status(201).json(publicComment(comment));
});
// Owner-only: full detail including email/phone, across every product, for follow-up.
app.get('/api/admin/comments', requireAuth, requireRole('owner'), (_req, res) => {
  const store = readStore();
  const productName = Object.fromEntries(catalogItems(store).map((p) => [p.id, p.name]));
  res.json((store.comments || []).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((c) => ({ ...c, productName: productName[c.productId] || 'Deleted product' })));
});
app.patch('/api/admin/comments/:id', requireAuth, requireRole('owner'), (req, res) => {
  let updated;
  mutateStore((store) => { const comment = (store.comments || []).find((c) => c.id === req.params.id); if (comment && req.body.text !== undefined) comment.text = String(req.body.text).trim(); updated = comment; return store; });
  updated ? res.json(updated) : res.status(404).json({ error: 'Comment not found' });
});
app.delete('/api/admin/comments/:id', requireAuth, requireRole('owner'), (req, res) => {
  mutateStore((store) => { store.comments = (store.comments || []).filter((c) => c.id !== req.params.id); return store; });
  res.json({ ok: true });
});

// Rich share preview for one product — WhatsApp/Facebook/Twitter crawlers read the og:* tags here
// and render the full photo + "Shop Now" card; real visitors bounce straight into the SPA below.
const esc = (str) => String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shareMoney = (value) => `Rs ${Number(value || 0).toLocaleString('en-PK')}`;
app.get('/share/:id', (req, res) => {
  const product = catalogItems(readStore()).find((p) => p.id === req.params.id || p.slug === req.params.id);
  if (!product) return res.redirect('/');
  const pub = publicProduct(product);
  const siteUrl = `${req.protocol}://${req.get('host')}`;
  const image = pub.images?.[0] || `${siteUrl}/zeeor-logo.png`;
  const price = shareMoney(pub.salePrice || pub.price);
  const title = `${pub.name} — ZEEOR`;
  const written = String(pub.description || '').trim();
  const cleanDescription = written && !/^A considered (ZEEOR|piece)/i.test(written) ? written.replace(/\s+/g, ' ').slice(0, 180) : '';
  const description = cleanDescription ? `${price} · ${cleanDescription}` : `${price} · Shop now on ZEEOR — wear without limits.`;
  const productUrl = `${siteUrl}/#product/${pub.id}`;
  res.set('Content-Type', 'text/html').send(`<!doctype html><html lang="en"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta property="og:type" content="product" />
<meta property="og:site_name" content="ZEEOR" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${esc(image)}" />
<meta property="og:url" content="${esc(productUrl)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${esc(image)}" />
<meta http-equiv="refresh" content="0; url=${esc(productUrl)}" />
<style>body{margin:0;font-family:Arial,sans-serif;background:#0b1714;color:#f2efe6;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}.card{max-width:420px;padding:30px}img{width:100%;max-height:520px;object-fit:cover;border-radius:4px;margin-bottom:24px}h1{font-size:20px;margin:0 0 8px}p{color:#cbbd91;font-size:14px;margin:0 0 24px}a{display:inline-block;background:#274d3d;color:#f2efe6;padding:14px 28px;text-decoration:none;letter-spacing:.08em;text-transform:uppercase;font-size:12px;border-radius:2px}</style></head>
<body><div class="card"><img src="${esc(image)}" alt="${esc(pub.name)}" /><h1>${esc(pub.name)}</h1><p>${esc(price)}</p><a href="${esc(productUrl)}">Shop Now ↗</a></div>
<script>location.replace(${JSON.stringify(productUrl)});</script>
</body></html>`);
});
app.post('/api/auth/login', (req, res) => {
  const user = authenticate(String(req.body.username || ''), String(req.body.password || ''));
  user ? res.json({ token: signUser(user), user }) : res.status(401).json({ error: 'Invalid credentials' });
});
app.get('/api/auth/me', requireAuth, (req, res) => res.json(safeUser(req)));

app.post('/api/orders', (req, res) => {
  const { customer = {}, items = [], couponCode = '' } = req.body;
  const store = readStore();
  if (!items.length) return res.status(400).json({ error: 'Your cart is empty' });
  let subtotal = 0;
  const normalized = [];
  for (const item of items) {
    const product = catalogItems(store).find((p) => p.id === item.productId);
    if (!product) return res.status(400).json({ error: 'A product is no longer available' });
    const key = `${item.color}-${item.size}`;
    const available = Number(product.inventory[key] || 0);
    if (available < Number(item.quantity)) return res.status(400).json({ error: `${product.name} is not available in that variant` });
    subtotal += priceOf(product) * Number(item.quantity);
    normalized.push({ productId: product.id, resellerId: product.resellerId, name: product.name, size: item.size, color: item.color, quantity: Number(item.quantity), unitPrice: priceOf(product) });
  }
  const coupon = store.coupons.find((c) => c.code.toLowerCase() === String(couponCode).toLowerCase() && c.active);
  const discount = coupon ? (coupon.type === 'percent' ? subtotal * coupon.value / 100 : coupon.value) : 0;
  const shipping = subtotal - discount >= store.settings.freeShippingThreshold ? 0 : store.settings.shippingFlat;
  const total = Math.max(0, subtotal - discount + shipping);
  const order = { id: `Z-${Date.now().toString().slice(-8)}`, createdAt: new Date().toISOString(), customer, items: normalized, subtotal, discount, shipping, total, payment: customer.payment || 'cod', status: 'Pending', tracking: '' };
  const soldOutImagePublicIds = [];
  mutateStore((next) => {
    for (const item of normalized) {
      if (item.resellerId) {
        const reseller = next.resellers.find((entry) => entry.id === item.resellerId);
        const listing = reseller?.listings.find((entry) => entry.id === item.productId);
        if (listing) listing.inventory[`${item.color}-${item.size}`] -= item.quantity;
      } else {
        const product = next.products.find((entry) => entry.id === item.productId);
        if (product) product.inventory[`${item.color}-${item.size}`] -= item.quantity;
      }
    }
    // Auto-remove anything whose stock has hit zero across every size
    for (const reseller of next.resellers) {
      const stillStocked = [];
      for (const listing of reseller.listings) {
        const totalStock = Object.values(listing.inventory || {}).reduce((sum, v) => sum + Math.max(0, Number(v) || 0), 0);
        if (totalStock <= 0) { soldOutImagePublicIds.push(...(listing.imagePublicIds || [])); } else { stillStocked.push(listing); }
      }
      reseller.listings = stillStocked;
    }
    const stillStockedProducts = [];
    for (const product of next.products) {
      const totalStock = Object.values(product.inventory || {}).reduce((sum, v) => sum + Math.max(0, Number(v) || 0), 0);
      if (totalStock <= 0) { soldOutImagePublicIds.push(...(product.imagePublicIds || [])); } else { stillStockedProducts.push(product); }
    }
    next.products = stillStockedProducts;
    next.orders.unshift(order);
    next.notifications = next.notifications || [];
    const resellerIds = [...new Set(normalized.filter((item) => item.resellerId).map((item) => item.resellerId))];
    for (const rid of resellerIds) next.notifications.unshift({ id: `n-${Date.now()}-${rid}`, resellerId: rid, message: `New order ${order.id} — one of your products was just ordered.`, createdAt: new Date().toISOString(), readBy: [] });
    return next;
  });
  Promise.allSettled(soldOutImagePublicIds.map((id) => deleteImage(id))).catch(() => {});
  res.status(201).json(order);
});

app.get('/api/admin/orders', requireAuth, requireRole('owner'), (_req, res) => { res.json(readStore().orders); });
app.get('/api/reseller/orders', requireAuth, requireRole('reseller'), (req, res) => { const mine = readStore().orders.map((order) => ({ ...order, items: order.items.filter((item) => item.resellerId === req.auth.sub) })).filter((order) => order.items.length); res.json(mine); });
app.post('/api/admin/notifications', requireAuth, requireRole('owner'), (req, res) => { const message = String(req.body.message || '').trim(); if (!message) return res.status(400).json({ error: 'Write a message' }); const notification = { id: `n-${Date.now()}`, resellerId: req.body.resellerId || null, message, createdAt: new Date().toISOString(), readBy: [] }; mutateStore((store) => { store.notifications = store.notifications || []; store.notifications.unshift(notification); return store; }); res.status(201).json(notification); });
app.get('/api/reseller/notifications', requireAuth, requireRole('reseller'), (req, res) => { const list = (readStore().notifications || []).filter((n) => n.resellerId === null || n.resellerId === req.auth.sub).map((n) => ({ ...n, read: n.readBy.includes(req.auth.sub) })); res.json(list); });
app.patch('/api/reseller/notifications/:id/read', requireAuth, requireRole('reseller'), (req, res) => { let found = false; mutateStore((store) => { const n = (store.notifications || []).find((item) => item.id === req.params.id); if (n) { found = true; if (!n.readBy.includes(req.auth.sub)) n.readBy.push(req.auth.sub); } return store; }); found ? res.json({ ok: true }) : res.status(404).json({ error: 'Notification not found' }); });
app.get('/api/admin/summary', requireAuth, requireRole('owner'), (_req, res) => {
  const store = readStore();
  const revenue = store.orders.reduce((sum, o) => sum + o.total, 0);
  res.json({ revenue, orders: store.orders.length, pending: store.orders.filter((o) => o.status === 'Pending').length, products: store.products.length, customers: store.customers.length, lowStock: store.products.filter((p) => productTotalStock(p) < 8).length, ordersList: store.orders.slice(0, 8), productsList: store.products.map((p) => ({ ...publicProduct(p), inventory: p.inventory, totalStock: productTotalStock(p) })) });
});
// Owner sees every category (general + every reseller's private ones) with the owning reseller's name attached.
app.get('/api/admin/categories', requireAuth, requireRole('owner'), (_req, res) => {
  const store = readStore();
  const resellerName = Object.fromEntries(store.resellers.map((r) => [r.id, r.displayName]));
  res.json(categoryList(store).map((c) => ({ ...c, resellerName: c.resellerId ? resellerName[c.resellerId] || null : null })));
});
// General category — usable by the owner AND every reseller.
app.post('/api/admin/categories', requireAuth, requireRole('owner'), (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Category name is required' });
  const store = readStore();
  if (categoryList(store).some((c) => c.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: 'A category with this name already exists' });
  const category = { id: `c-${Date.now()}`, name, scope: 'general', resellerId: null, order: categoryList(store).length };
  mutateStore((s) => { s.categories = [...(s.categories || []), category]; return s; });
  res.status(201).json(category);
});
// Private category — owner creates it FOR one reseller. Only that reseller can list products in it,
// but customers see it on the storefront like any other category.
app.post('/api/admin/resellers/:id/categories', requireAuth, requireRole('owner'), (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Category name is required' });
  const store = readStore();
  const reseller = store.resellers.find((r) => r.id === req.params.id);
  if (!reseller) return res.status(404).json({ error: 'Seller not found' });
  if (categoryList(store).some((c) => c.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: 'A category with this name already exists' });
  const category = { id: `c-${Date.now()}`, name, scope: 'private', resellerId: reseller.id, order: categoryList(store).length };
  mutateStore((s) => { s.categories = [...(s.categories || []), category]; return s; });
  res.status(201).json(category);
});
// Owner controls display order (top-to-bottom on the storefront) for every category, general or private.
app.patch('/api/admin/categories/reorder', requireAuth, requireRole('owner'), (req, res) => {
  const order = Array.isArray(req.body.order) ? req.body.order : [];
  let result;
  mutateStore((store) => {
    const byId = Object.fromEntries((store.categories || []).map((c) => [c.id, c]));
    const ordered = order.map((id) => byId[id]).filter(Boolean);
    const remaining = (store.categories || []).filter((c) => !order.includes(c.id));
    store.categories = [...ordered, ...remaining].map((c, i) => ({ ...c, order: i }));
    result = store.categories;
    return store;
  });
  res.json(result);
});
// Owner has full authority to delete ANY category — general or a reseller's private one.
app.delete('/api/admin/categories/:id', requireAuth, requireRole('owner'), (req, res) => {
  mutateStore((store) => { store.categories = (store.categories || []).filter((c) => c.id !== req.params.id); store.subcategories = (store.subcategories || []).filter((x) => x.categoryId !== req.params.id); return store; });
  res.json({ ok: true });
});
// ---- Category rename + Subcategories (owner-only). Sellers can only PICK from these. ----
app.patch('/api/admin/categories/:id', requireAuth, requireRole('owner'), (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Category name is required' });
  const before = readStore();
  const cat = (before.categories || []).find((c) => c.id === req.params.id);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  if (categoryList(before).some((c) => c.id !== cat.id && c.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: 'A category with this name already exists' });
  const oldName = cat.name;
  mutateStore((store) => {
    store.categories.find((c) => c.id === cat.id).name = name;
    store.products.forEach((p) => { if (p.category === oldName) p.category = name; });
    store.resellers.forEach((r) => (r.listings || []).forEach((l) => { if (l.category === oldName) l.category = name; }));
    return store;
  });
  res.json({ id: cat.id, name });
});
// ---- Product-form rules API ----
// Public (sellers + storefront need it): rules keyed by category name, or "Category::Subcategory" name.
app.get('/api/form-config', (_req, res) => {
  const store = readStore(); const all = store.formConfigs || {}; const out = {};
  const cats = (store.categories || []).filter((c) => c && typeof c === 'object');
  for (const c of cats) if (all[c.id]) out[c.name] = sanitizeFormConfig(all[c.id]);
  for (const x of store.subcategories || []) { const parent = cats.find((c) => c.id === x.categoryId); if (parent && all[x.id]) out[`${parent.name}::${x.name}`] = sanitizeFormConfig(all[x.id]); }
  res.json(out);
});
// Owner editor: rules keyed by category / subcategory id.
app.get('/api/admin/form-config', requireAuth, requireRole('owner'), (_req, res) => { const all = readStore().formConfigs || {}; res.json(Object.fromEntries(Object.entries(all).map(([id, cfg]) => [id, sanitizeFormConfig(cfg)]))); });
app.put('/api/admin/form-config/:id', requireAuth, requireRole('owner'), (req, res) => {
  const before = readStore(); const id = req.params.id;
  const known = (before.categories || []).some((c) => c && c.id === id) || (before.subcategories || []).some((x) => x.id === id);
  if (!known) return res.status(404).json({ error: 'Category or subcategory not found' });
  let saved = null;
  mutateStore((store) => { store.formConfigs = store.formConfigs || {}; if (req.body.config === null) { delete store.formConfigs[id]; } else { saved = sanitizeFormConfig(req.body.config); store.formConfigs[id] = saved; } return store; });
  res.json(saved || { reset: true });
});
app.get('/api/admin/subcategories', requireAuth, requireRole('owner'), (_req, res) => res.json(subcategoryList(readStore())));
app.post('/api/admin/categories/:id/subcategories', requireAuth, requireRole('owner'), (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Subcategory name is required' });
  const before = readStore();
  if (!(before.categories || []).some((c) => c.id === req.params.id)) return res.status(404).json({ error: 'Category not found' });
  const siblings = (before.subcategories || []).filter((x) => x.categoryId === req.params.id);
  if (siblings.some((x) => x.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: 'This category already has a subcategory with that name' });
  const sub = { id: `s-${Date.now()}`, name, categoryId: req.params.id, order: siblings.length };
  mutateStore((store) => { store.subcategories = [...(store.subcategories || []), sub]; return store; });
  res.status(201).json(sub);
});
app.patch('/api/admin/subcategories/:id', requireAuth, requireRole('owner'), (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Subcategory name is required' });
  const before = readStore();
  const sub = (before.subcategories || []).find((x) => x.id === req.params.id);
  if (!sub) return res.status(404).json({ error: 'Subcategory not found' });
  if ((before.subcategories || []).some((x) => x.id !== sub.id && x.categoryId === sub.categoryId && x.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: 'This category already has a subcategory with that name' });
  const parent = before.categories.find((c) => c.id === sub.categoryId)?.name;
  const oldName = sub.name;
  mutateStore((store) => {
    store.subcategories.find((x) => x.id === sub.id).name = name;
    store.products.forEach((p) => { if (p.category === parent && p.subcategory === oldName) p.subcategory = name; });
    store.resellers.forEach((r) => (r.listings || []).forEach((l) => { if (l.category === parent && l.subcategory === oldName) l.subcategory = name; }));
    return store;
  });
  res.json({ ...sub, name });
});
app.delete('/api/admin/subcategories/:id', requireAuth, requireRole('owner'), (req, res) => {
  const before = readStore();
  const sub = (before.subcategories || []).find((x) => x.id === req.params.id);
  if (!sub) return res.status(404).json({ error: 'Subcategory not found' });
  const parent = before.categories.find((c) => c.id === sub.categoryId)?.name;
  mutateStore((store) => {
    store.subcategories = (store.subcategories || []).filter((x) => x.id !== sub.id);
    store.products.forEach((p) => { if (p.category === parent && p.subcategory === sub.name) p.subcategory = undefined; });
    store.resellers.forEach((r) => (r.listings || []).forEach((l) => { if (l.category === parent && l.subcategory === sub.name) l.subcategory = undefined; }));
    return store;
  });
  res.json({ ok: true });
});
app.post('/api/admin/products', requireAuth, requireRole('owner'), (req, res) => {
  const input = req.body;
  // Owner can only use GENERAL categories for their own catalog — never a reseller's private category.
  if (!generalCategoryNames(readStore()).includes(input.category)) return res.status(400).json({ error: 'Create this general category in Owner Studio before assigning a product' });
  if (input.subcategory && !isValidSubcategory(readStore(), input.category, input.subcategory)) return res.status(400).json({ error: 'Pick a subcategory that belongs to this category' });
  let built, attrs; const cfg = formConfigFor(readStore(), input.category, input.subcategory); try { built = buildVariants(input.colorBlocks, cfg); attrs = buildAttributes(input.attributes, cfg); } catch (err) { return res.status(400).json({ error: err.message }); }
  const featuredPosition = input.featuredPosition ? Math.min(5, Math.max(1, Number(input.featuredPosition))) : null;
  const product = { ...input, id: input.id || `p-${Date.now()}`, slug: input.slug || String(input.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'), images: built.images.length ? built.images : ['/zeeor-placeholder.jpg'], imagePublicIds: built.imagePublicIds, sizes: built.sizes, colors: built.colors, inventory: built.inventory, galleryByColor: built.galleryByColor, imagePublicIdsByColor: built.imagePublicIdsByColor, discount: input.salePrice ? Math.round((1 - Number(input.salePrice) / Number(input.price)) * 100) : 0, featuredPosition, flags: { ...(input.flags || { new: true, bestseller: false }), sale: Boolean(input.salePrice), featured: featuredPosition != null }, published: input.published !== false, attributes: attrs, hasSizes: cfg.fields.sizes.show !== false, hasColors: cfg.fields.colors.show !== false };
  mutateStore((store) => { const index = store.products.findIndex((p) => p.id === product.id); index >= 0 ? store.products.splice(index, 1, product) : store.products.push(product); return store; });
  res.json(product);
});
app.patch('/api/admin/products/:id', requireAuth, requireRole('owner'), (req, res) => { let changed; if (req.body.category && !generalCategoryNames(readStore()).includes(req.body.category)) return res.status(400).json({ error: 'Category must be a general category created by the owner' }); { const s0 = readStore(); const cur = s0.products.find((p) => p.id === req.params.id); if (req.body.subcategory && !isValidSubcategory(s0, req.body.category || cur?.category, String(req.body.subcategory))) return res.status(400).json({ error: 'Pick a subcategory that belongs to this category' }); } mutateStore((store) => { changed = store.products.find((p) => p.id === req.params.id); if (changed) { if (req.body.price !== undefined) changed.price = Number(req.body.price); if (req.body.salePrice !== undefined) changed.salePrice = req.body.salePrice === '' ? null : Number(req.body.salePrice); if (req.body.salePrice !== undefined) changed.flags = { ...(changed.flags || {}), sale: Boolean(req.body.salePrice) }; if (req.body.category) { if (req.body.category !== changed.category && req.body.subcategory === undefined) changed.subcategory = undefined; changed.category = req.body.category; } if (req.body.subcategory !== undefined) changed.subcategory = String(req.body.subcategory || '').trim() || undefined; if (req.body.name !== undefined && String(req.body.name).trim()) changed.name = String(req.body.name).trim(); if (req.body.description !== undefined) changed.description = String(req.body.description).trim(); if (req.body.shortDescription !== undefined) changed.shortDescription = String(req.body.shortDescription).trim(); return store; } return store; }); changed ? res.json(changed) : res.status(404).json({ error: 'Product not found' }); });
// Owner sets where a product ranks in the homepage "featured" row — 1 to 5, front-to-back. Clearing it un-features the product.
app.patch('/api/admin/products/:id/position', requireAuth, requireRole('owner'), (req, res) => {
  const raw = req.body.featuredPosition;
  const featuredPosition = raw === '' || raw === null || raw === undefined ? null : Math.min(5, Math.max(1, Number(raw)));
  let changed;
  mutateStore((store) => { changed = store.products.find((p) => p.id === req.params.id); if (changed) { changed.featuredPosition = featuredPosition; changed.flags = { ...(changed.flags || {}), featured: featuredPosition != null }; } return store; });
  changed ? res.json(changed) : res.status(404).json({ error: 'Product not found' });
});
app.patch('/api/admin/products/:id/inventory', requireAuth, requireRole('owner'), (req, res) => { let changed; const inventory = req.body.inventory; if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) return res.status(400).json({ error: 'Inventory must be an object keyed by color-size' }); mutateStore((store) => { changed = store.products.find((p) => p.id === req.params.id); if (changed) changed.inventory = Object.fromEntries(Object.entries(inventory).map(([key, value]) => [key, Math.max(0, Number(value) || 0)])); return store; }); changed ? res.json(changed) : res.status(404).json({ error: 'Product not found' }); });
app.delete('/api/admin/products/:id', requireAuth, requireRole('owner'), async (req, res) => { const product = readStore().products.find((p) => p.id === req.params.id); try { await Promise.all((product?.imagePublicIds || []).map((publicId) => deleteImage(publicId))); mutateStore((store) => { store.products = store.products.filter((p) => p.id !== req.params.id); return store; }); res.json({ ok: true }); } catch (error) { res.status(502).json({ error: error.message }); } });
app.delete('/api/admin/products/:id/images/:index', requireAuth, requireRole('owner'), async (req, res) => { const store = readStore(); const product = store.products.find((p) => p.id === req.params.id); const index = Number(req.params.index); try { await deleteImage(product?.imagePublicIds?.[index]); mutateStore((next) => { const current = next.products.find((p) => p.id === req.params.id); if (current) { current.images = (current.images || []).filter((_url, imageIndex) => imageIndex !== index); current.imagePublicIds = (current.imagePublicIds || []).filter((_id, imageIndex) => imageIndex !== index); } return next; }); res.json({ ok: true }); } catch (error) { res.status(502).json({ error: error.message }); } });
// Owner can permanently delete any order. It disappears from the database, the owner's Orders/Overview,
// every seller's order list, and the "New order ..." notifications sellers got for it. Stock is NOT restored:
// stock is reduced when an order is placed, and sold-out products are auto-removed, so there is nothing safe to give back.
app.delete('/api/admin/orders/:id', requireAuth, requireRole('owner'), (req, res) => {
  let found = false;
  mutateStore((store) => {
    const before = store.orders.length;
    store.orders = store.orders.filter((o) => o.id !== req.params.id);
    found = store.orders.length < before;
    if (found) store.notifications = (store.notifications || []).filter((n) => !String(n.message || '').includes(`New order ${req.params.id} `));
    return store;
  });
  found ? res.json({ ok: true }) : res.status(404).json({ error: 'Order not found' });
});
app.patch('/api/admin/orders/:id', requireAuth, requireRole('owner'), (req, res) => { let changed; mutateStore((store) => { changed = store.orders.find((o) => o.id === req.params.id); if (changed) changed.status = req.body.status; return store; }); changed ? res.json(changed) : res.status(404).json({ error: 'Order not found' }); });
app.patch('/api/admin/cms', requireAuth, requireRole('owner'), (req, res) => { let cms; if (req.body.heroImage && !(String(req.body.heroImage).startsWith('/') || String(req.body.heroImage).includes('res.cloudinary.com'))) return res.status(400).json({ error: 'Hero images must be local or hosted on Cloudinary' }); mutateStore((store) => { store.cms = { ...store.cms, ...req.body }; cms = store.cms; return store; }); res.json(cms); });
app.get('/api/admin/resellers', requireAuth, requireRole('owner'), (_req, res) => res.json(readStore().resellers.map(({ passwordHash, ...r }) => r)));
app.post('/api/admin/resellers', requireAuth, requireRole('owner'), (req, res) => { const username = String(req.body.username || '').trim(); const password = String(req.body.password || ''); const whatsapp = String(req.body.whatsapp || '').replace(/[^0-9]/g, ''); if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–64 letters, numbers, dots, underscores, or hyphens' }); if (password.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters' }); if (!whatsapp || whatsapp.length < 10) return res.status(400).json({ error: 'Enter a valid WhatsApp number with country code, e.g. 923001234567' }); if (readStore().resellers.some((entry) => entry.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: 'Username already exists' }); const reseller = { id: `r-${Date.now()}`, username, displayName: req.body.displayName || username, whatsapp, passwordHash: hashPassword(password), active: true, listings: [], createdAt: new Date().toISOString() }; mutateStore((store) => { store.resellers.push(reseller); return store; }); const { passwordHash, ...safe } = reseller; res.status(201).json(safe); });
app.patch('/api/admin/resellers/:id', requireAuth, requireRole('owner'), (req, res) => { let changed; mutateStore((store) => { changed = store.resellers.find((entry) => entry.id === req.params.id); if (changed && req.body.active !== undefined) changed.active = Boolean(req.body.active); return store; }); changed ? res.json({ id: changed.id, username: changed.username, displayName: changed.displayName, active: changed.active !== false }) : res.status(404).json({ error: 'Seller not found' }); });
// Permanently removes a seller and everything that belongs to them: account, all listings, every photo (also on Cloudinary),
// their private categories + subcategories (and any form rules on them), comments on their products and their notifications.
// Customer orders are kept on purpose — they are the shop's sales records — but the seller can no longer log in or see them.
app.delete('/api/admin/resellers/:id', requireAuth, requireRole('owner'), async (req, res) => {
  const id = req.params.id; const before = readStore(); const seller = before.resellers.find((r) => r.id === id);
  if (!seller) return res.status(404).json({ error: 'Seller not found' });
  const publicIds = new Set(); const listingIds = new Set(); const listings = seller.listings || [];
  for (const l of listings) {
    listingIds.add(l.id);
    (l.imagePublicIds || []).forEach((x) => x && publicIds.add(x));
    Object.values(l.imagePublicIdsByColor || {}).flat().forEach((x) => x && publicIds.add(x));
    (l.colorBlocks || []).forEach((b) => (b.imagePublicIds || []).forEach((x) => x && publicIds.add(x)));
  }
  const removedCategoryIds = new Set((before.categories || []).filter((c) => c && c.resellerId === id).map((c) => c.id));
  const removedSubIds = new Set((before.subcategories || []).filter((x) => removedCategoryIds.has(x.categoryId)).map((x) => x.id));
  mutateStore((store) => {
    store.resellers = store.resellers.filter((r) => r.id !== id);
    store.categories = (store.categories || []).filter((c) => !(c && c.resellerId === id));
    store.subcategories = (store.subcategories || []).filter((x) => !removedCategoryIds.has(x.categoryId));
    if (store.formConfigs) for (const key of [...removedCategoryIds, ...removedSubIds]) delete store.formConfigs[key];
    store.comments = (store.comments || []).filter((c) => !listingIds.has(c.productId));
    store.notifications = (store.notifications || []).filter((n) => n.resellerId !== id).map((n) => Array.isArray(n.readBy) ? { ...n, readBy: n.readBy.filter((x) => x !== id) } : n);
    return store;
  });
  const results = await Promise.allSettled([...publicIds].map((pid) => deleteImage(pid)));
  const failed = results.filter((r) => r.status === 'rejected').length;
  res.json({ ok: true, listingsRemoved: listings.length, imagesRemoved: results.length - failed, imagesFailed: failed });
});
app.get('/api/admin/resellers/:id/listings', requireAuth, requireRole('owner'), (req, res) => { const reseller = readStore().resellers.find((r) => r.id === req.params.id); reseller ? res.json(reseller.listings || []) : res.status(404).json({ error: 'Seller not found' }); });
app.patch('/api/admin/resellers/:id/listings/:listingId', requireAuth, requireRole('owner'), (req, res) => { let changed; mutateStore((store) => { const reseller = store.resellers.find((r) => r.id === req.params.id); changed = reseller?.listings.find((l) => l.id === req.params.listingId); if (changed) { if (req.body.price !== undefined) changed.price = Number(req.body.price); if (req.body.salePrice !== undefined) changed.salePrice = req.body.salePrice === '' ? null : Number(req.body.salePrice); if (req.body.title !== undefined) changed.title = String(req.body.title); if (req.body.category !== undefined) { if (String(req.body.category) !== changed.category && req.body.subcategory === undefined) changed.subcategory = undefined; changed.category = String(req.body.category); } if (req.body.subcategory !== undefined) changed.subcategory = String(req.body.subcategory || '').trim() || undefined; if (req.body.description !== undefined) changed.description = String(req.body.description).trim() || undefined; if (req.body.active !== undefined) changed.active = Boolean(req.body.active); } return store; }); changed ? res.json(changed) : res.status(404).json({ error: 'Listing not found' }); });
app.delete('/api/admin/resellers/:id/listings/:listingId', requireAuth, requireRole('owner'), (req, res) => { let found = false; let imagePublicIds = []; mutateStore((store) => { const reseller = store.resellers.find((r) => r.id === req.params.id); if (!reseller) return store; const listing = reseller.listings.find((l) => l.id === req.params.listingId); if (listing) { found = true; imagePublicIds = listing.imagePublicIds || []; reseller.listings = reseller.listings.filter((l) => l.id !== req.params.listingId); } return store; }); if (!found) return res.status(404).json({ error: 'Listing not found' }); Promise.allSettled(imagePublicIds.map((id) => deleteImage(id))).catch(() => {}); res.json({ ok: true }); });
// General categories + this reseller's own private categories only — never another reseller's private ones.
app.get('/api/reseller/categories', requireAuth, requireRole('reseller'), (req, res) => res.json(resellerCategoryNames(readStore(), req.auth.sub)));
app.get('/api/reseller/listings', requireAuth, requireRole('reseller'), (req, res) => res.json(readStore().resellers.find((r) => r.id === req.auth.sub)?.listings || []));
app.post('/api/reseller/listings', requireAuth, requireRole('reseller'), (req, res) => { const input = req.body; const allowed = resellerCategoryNames(readStore(), req.auth.sub); if (!allowed.includes(input.category)) return res.status(400).json({ error: 'Choose a category created by the owner, or your own private category' }); if (input.subcategory && !isValidSubcategory(readStore(), input.category, input.subcategory)) return res.status(400).json({ error: 'Pick a subcategory that belongs to this category' }); let built, attrs; const cfg = formConfigFor(readStore(), input.category, input.subcategory); try { built = buildVariants(input.colorBlocks, cfg); attrs = buildAttributes(input.attributes, cfg); } catch (err) { return res.status(400).json({ error: err.message }); } const listing = { id: `l-${Date.now()}`, ...input, description: String(input.description || '').trim() || undefined, subcategory: String(input.subcategory || '').trim() || undefined, sizes: built.sizes, colors: built.colors, inventory: built.inventory, galleryByColor: built.galleryByColor, imagePublicIdsByColor: built.imagePublicIdsByColor, images: built.images, imagePublicIds: built.imagePublicIds, active: true, createdAt: new Date().toISOString(), attributes: attrs, hasSizes: cfg.fields.sizes.show !== false, hasColors: cfg.fields.colors.show !== false }; mutateStore((store) => { const owner = store.resellers.find((r) => r.id === req.auth.sub); if (owner) owner.listings.unshift(listing); return store; }); res.status(201).json(listing); });
app.patch('/api/reseller/listings/:id', requireAuth, requireRole('reseller'), (req, res) => {
  const before = readStore();
  const current = before.resellers.find((r) => r.id === req.auth.sub)?.listings.find((l) => l.id === req.params.id);
  if (!current) return res.status(404).json({ error: 'Listing not found' });
  const b = req.body;
  const category = b.category !== undefined ? String(b.category) : current.category;
  if (b.category !== undefined && !resellerCategoryNames(before, req.auth.sub).includes(category)) return res.status(400).json({ error: 'Choose a category created by the owner, or your own private category' });
  const sub = b.subcategory !== undefined ? String(b.subcategory || '').trim() : (category !== current.category ? '' : current.subcategory || '');
  if (sub && !isValidSubcategory(before, category, sub)) return res.status(400).json({ error: 'Pick a subcategory that belongs to this category' });
  let updated;
  mutateStore((store) => {
    const listing = store.resellers.find((r) => r.id === req.auth.sub)?.listings.find((l) => l.id === req.params.id);
    if (listing) {
      if (b.title !== undefined && String(b.title).trim()) listing.title = String(b.title).trim();
      if (b.description !== undefined) listing.description = String(b.description).trim() || undefined;
      listing.category = category;
      listing.subcategory = sub || undefined;
      updated = listing;
    }
    return store;
  });
  res.json(updated);
});
app.delete('/api/reseller/listings/:id', requireAuth, requireRole('reseller'), async (req, res) => { const store = readStore(); const owner = store.resellers.find((r) => r.id === req.auth.sub); const listing = owner?.listings.find((l) => l.id === req.params.id); try { await Promise.all((listing?.imagePublicIds || []).map((publicId) => deleteImage(publicId))); mutateStore((next) => { const currentOwner = next.resellers.find((r) => r.id === req.auth.sub); if (currentOwner) currentOwner.listings = currentOwner.listings.filter((l) => l.id !== req.params.id); return next; }); res.json({ ok: true }); } catch (error) { res.status(502).json({ error: error.message }); } });
app.delete('/api/reseller/listings/:id/images/:index', requireAuth, requireRole('reseller'), async (req, res) => { const store = readStore(); const owner = store.resellers.find((r) => r.id === req.auth.sub); const listing = owner?.listings.find((l) => l.id === req.params.id); const index = Number(req.params.index); try { await deleteImage(listing?.imagePublicIds?.[index]); mutateStore((next) => { const currentOwner = next.resellers.find((r) => r.id === req.auth.sub); const current = currentOwner?.listings.find((l) => l.id === req.params.id); if (current) { current.images = (current.images || []).filter((_url, imageIndex) => imageIndex !== index); current.imagePublicIds = (current.imagePublicIds || []).filter((_id, imageIndex) => imageIndex !== index); } return next; }); res.json({ ok: true }); } catch (error) { res.status(502).json({ error: error.message }); } });
app.post('/api/upload', requireAuth, requireRole('owner', 'reseller'), upload.array('images', 5), async (req, res) => { try { const results = await Promise.all((req.files || []).map((file) => uploadImage(file.buffer))); res.json(results); } catch (error) { res.status(502).json({ error: error.message }); } });

app.use(createHomeSeo({ readStore, visibleCategoryNames, distIndexPath: path.join(root, '..', 'dist', 'index.html') }));
if (process.env.NODE_ENV === 'production') app.use(express.static(path.join(root, '..', 'dist')));
// SEO layer — sitemap.xml, robots.txt, and crawlable /products/:slug, /stores,
// /stores/:username, /about-zeeor and /:categorySlug pages. Every route here
// either serves brand-new content or calls next() so nothing already above
// or below it changes behaviour.
app.use(createSeoRouter({ readStore, catalogItems, publicProduct, visibleCategoryNames }));
app.get('*', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(root, '..', 'index.html')));
const port = Number(process.env.PORT || 4000);
app.listen(port, '0.0.0.0', () => console.log(`ZEEOR API listening on ${port}`));
