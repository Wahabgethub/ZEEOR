import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate, ensureDefaultResellers, hashPassword, requireAuth, requireRole, signUser } from './auth.js';
import { categoryList, ensureCategoriesShape, ensureCommentsShape, generalCategoryNames, mutateStore, productTotalStock, publicComment, publicProduct, readStore, resellerCategoryNames, visibleCategoryNames } from './db.js';
import { deleteImage, uploadImage } from './imageStorage.js';
import { createSeoRouter, createHomeSeo } from './seoRoutes.js';

const app = express();
// Behind Cloudflare/nginx, req.protocol otherwise always reads 'http'. This
// makes Express trust X-Forwarded-Proto so req.protocol is correct — used
// only by the new SEO routes' fallback URL detection (server/seo.js prefers
// the SITE_URL env var; this is just a safety net).
app.set('trust proxy', true);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 5 } });
const root = path.dirname(fileURLToPath(import.meta.url));
ensureDefaultResellers();
ensureCategoriesShape();
ensureCommentsShape();
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
// Turns client-submitted colour/design blocks — each with its own photo set and per-size stock — into the full variant shape
function buildVariants(colorBlocks) {
  const blocks = Array.isArray(colorBlocks) ? colorBlocks.filter((b) => String(b?.name || '').trim()) : [];
  if (!blocks.length) throw new Error('Add at least one colour/design with photos and stock');
  if (blocks.length > 4) throw new Error('Maximum 4 colours/designs per product');
  const names = blocks.map((b) => String(b.name).trim());
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) throw new Error('Colour/design names must be unique');
  for (const b of blocks) { if (!b.images?.length) throw new Error(`Add at least one photo for "${b.name}"`); if (b.images.length > 5) throw new Error(`Maximum 5 photos per colour/design ("${b.name}")`); }
  const sizeSet = new Set();
  for (const b of blocks) Object.keys(b.stocks || {}).forEach((s) => { if (String(s).trim()) sizeSet.add(String(s).trim()); });
  const sizes = [...sizeSet];
  if (!sizes.length) throw new Error('Add at least one size with a stock quantity');
  if (sizes.length > 4) throw new Error('Maximum 4 sizes per product');
  const inventory = {}; const galleryByColor = {}; const imagePublicIdsByColor = {};
  for (const b of blocks) {
    const name = String(b.name).trim();
    galleryByColor[name] = b.images || [];
    imagePublicIdsByColor[name] = b.imagePublicIds || [];
    for (const size of sizes) inventory[`${name}-${size}`] = Math.max(0, Number(b.stocks?.[size]) || 0);
  }
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
  res.json({ products: items.map(publicProduct), categories: visibleCategoryNames(store), collections: [...new Set(items.map((p) => p.collection))] });
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
  const image = pub.images?.[0] || `${siteUrl}/zeeor-editorial.jpg`;
  const price = shareMoney(pub.salePrice || pub.price);
  const title = `${pub.name} — ZEEOR`;
  const description = `${price} · Shop now on ZEEOR — wear without limits.`;
  const productUrl = `${siteUrl}/#product/${pub.id}`;
  res.set('Content-Type', 'text/html').send(`<!doctype html><html lang="en"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta property="og:type" content="product" />
<meta property="og:site_name" content="ZEEOR" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${esc(image)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="1500" />
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
  if (!reseller) return res.status(404).json({ error: 'Reseller not found' });
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
  mutateStore((store) => { store.categories = (store.categories || []).filter((c) => c.id !== req.params.id); return store; });
  res.json({ ok: true });
});
app.post('/api/admin/products', requireAuth, requireRole('owner'), (req, res) => {
  const input = req.body;
  // Owner can only use GENERAL categories for their own catalog — never a reseller's private category.
  if (!generalCategoryNames(readStore()).includes(input.category)) return res.status(400).json({ error: 'Create this general category in Owner Studio before assigning a product' });
  let built; try { built = buildVariants(input.colorBlocks); } catch (err) { return res.status(400).json({ error: err.message }); }
  const featuredPosition = input.featuredPosition ? Math.min(5, Math.max(1, Number(input.featuredPosition))) : null;
  const product = { ...input, id: input.id || `p-${Date.now()}`, slug: input.slug || String(input.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'), images: built.images.length ? built.images : ['/zeeor-editorial.jpg'], imagePublicIds: built.imagePublicIds, sizes: built.sizes, colors: built.colors, inventory: built.inventory, galleryByColor: built.galleryByColor, imagePublicIdsByColor: built.imagePublicIdsByColor, discount: input.salePrice ? Math.round((1 - Number(input.salePrice) / Number(input.price)) * 100) : 0, featuredPosition, flags: { ...(input.flags || { new: true, bestseller: false }), sale: Boolean(input.salePrice), featured: featuredPosition != null }, published: input.published !== false };
  mutateStore((store) => { const index = store.products.findIndex((p) => p.id === product.id); index >= 0 ? store.products.splice(index, 1, product) : store.products.push(product); return store; });
  res.json(product);
});
app.patch('/api/admin/products/:id', requireAuth, requireRole('owner'), (req, res) => { let changed; if (req.body.category && !generalCategoryNames(readStore()).includes(req.body.category)) return res.status(400).json({ error: 'Category must be a general category created by the owner' }); mutateStore((store) => { changed = store.products.find((p) => p.id === req.params.id); if (changed) { if (req.body.price !== undefined) changed.price = Number(req.body.price); if (req.body.salePrice !== undefined) changed.salePrice = req.body.salePrice === '' ? null : Number(req.body.salePrice); if (req.body.salePrice !== undefined) changed.flags = { ...(changed.flags || {}), sale: Boolean(req.body.salePrice) }; if (req.body.category) changed.category = req.body.category; return store; } return store; }); changed ? res.json(changed) : res.status(404).json({ error: 'Product not found' }); });
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
app.patch('/api/admin/orders/:id', requireAuth, requireRole('owner'), (req, res) => { let changed; mutateStore((store) => { changed = store.orders.find((o) => o.id === req.params.id); if (changed) changed.status = req.body.status; return store; }); changed ? res.json(changed) : res.status(404).json({ error: 'Order not found' }); });
app.patch('/api/admin/cms', requireAuth, requireRole('owner'), (req, res) => { let cms; if (req.body.heroImage && !(String(req.body.heroImage).startsWith('/') || String(req.body.heroImage).includes('res.cloudinary.com'))) return res.status(400).json({ error: 'Hero images must be local or hosted on Cloudinary' }); mutateStore((store) => { store.cms = { ...store.cms, ...req.body }; cms = store.cms; return store; }); res.json(cms); });
app.get('/api/admin/resellers', requireAuth, requireRole('owner'), (_req, res) => res.json(readStore().resellers.map(({ passwordHash, ...r }) => r)));
app.post('/api/admin/resellers', requireAuth, requireRole('owner'), (req, res) => { const username = String(req.body.username || '').trim(); const password = String(req.body.password || ''); const whatsapp = String(req.body.whatsapp || '').replace(/[^0-9]/g, ''); if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–64 letters, numbers, dots, underscores, or hyphens' }); if (password.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters' }); if (!whatsapp || whatsapp.length < 10) return res.status(400).json({ error: 'Enter a valid WhatsApp number with country code, e.g. 923001234567' }); if (readStore().resellers.some((entry) => entry.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: 'Username already exists' }); const reseller = { id: `r-${Date.now()}`, username, displayName: req.body.displayName || username, whatsapp, passwordHash: hashPassword(password), active: true, listings: [], createdAt: new Date().toISOString() }; mutateStore((store) => { store.resellers.push(reseller); return store; }); const { passwordHash, ...safe } = reseller; res.status(201).json(safe); });
app.patch('/api/admin/resellers/:id', requireAuth, requireRole('owner'), (req, res) => { let changed; mutateStore((store) => { changed = store.resellers.find((entry) => entry.id === req.params.id); if (changed && req.body.active !== undefined) changed.active = Boolean(req.body.active); return store; }); changed ? res.json({ id: changed.id, username: changed.username, displayName: changed.displayName, active: changed.active !== false }) : res.status(404).json({ error: 'Reseller not found' }); });
app.delete('/api/admin/resellers/:id', requireAuth, requireRole('owner'), (req, res) => { mutateStore((store) => { store.resellers = store.resellers.filter((r) => r.id !== req.params.id); store.categories = (store.categories || []).filter((c) => c.resellerId !== req.params.id); return store; }); res.json({ ok: true }); });
app.get('/api/admin/resellers/:id/listings', requireAuth, requireRole('owner'), (req, res) => { const reseller = readStore().resellers.find((r) => r.id === req.params.id); reseller ? res.json(reseller.listings || []) : res.status(404).json({ error: 'Reseller not found' }); });
app.patch('/api/admin/resellers/:id/listings/:listingId', requireAuth, requireRole('owner'), (req, res) => { let changed; mutateStore((store) => { const reseller = store.resellers.find((r) => r.id === req.params.id); changed = reseller?.listings.find((l) => l.id === req.params.listingId); if (changed) { if (req.body.price !== undefined) changed.price = Number(req.body.price); if (req.body.salePrice !== undefined) changed.salePrice = req.body.salePrice === '' ? null : Number(req.body.salePrice); if (req.body.title !== undefined) changed.title = String(req.body.title); if (req.body.category !== undefined) changed.category = String(req.body.category); if (req.body.active !== undefined) changed.active = Boolean(req.body.active); } return store; }); changed ? res.json(changed) : res.status(404).json({ error: 'Listing not found' }); });
app.delete('/api/admin/resellers/:id/listings/:listingId', requireAuth, requireRole('owner'), (req, res) => { let found = false; let imagePublicIds = []; mutateStore((store) => { const reseller = store.resellers.find((r) => r.id === req.params.id); if (!reseller) return store; const listing = reseller.listings.find((l) => l.id === req.params.listingId); if (listing) { found = true; imagePublicIds = listing.imagePublicIds || []; reseller.listings = reseller.listings.filter((l) => l.id !== req.params.listingId); } return store; }); if (!found) return res.status(404).json({ error: 'Listing not found' }); Promise.allSettled(imagePublicIds.map((id) => deleteImage(id))).catch(() => {}); res.json({ ok: true }); });
// General categories + this reseller's own private categories only — never another reseller's private ones.
app.get('/api/reseller/categories', requireAuth, requireRole('reseller'), (req, res) => res.json(resellerCategoryNames(readStore(), req.auth.sub)));
app.get('/api/reseller/listings', requireAuth, requireRole('reseller'), (req, res) => res.json(readStore().resellers.find((r) => r.id === req.auth.sub)?.listings || []));
app.post('/api/reseller/listings', requireAuth, requireRole('reseller'), (req, res) => { const input = req.body; const allowed = resellerCategoryNames(readStore(), req.auth.sub); if (!allowed.includes(input.category)) return res.status(400).json({ error: 'Choose a category created by the owner, or your own private category' }); let built; try { built = buildVariants(input.colorBlocks); } catch (err) { return res.status(400).json({ error: err.message }); } const listing = { id: `l-${Date.now()}`, ...input, description: String(input.description || '').trim() || undefined, sizes: built.sizes, colors: built.colors, inventory: built.inventory, galleryByColor: built.galleryByColor, imagePublicIdsByColor: built.imagePublicIdsByColor, images: built.images, imagePublicIds: built.imagePublicIds, active: true, createdAt: new Date().toISOString() }; mutateStore((store) => { const owner = store.resellers.find((r) => r.id === req.auth.sub); if (owner) owner.listings.unshift(listing); return store; }); res.status(201).json(listing); });
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
