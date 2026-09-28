import express from 'express';
import fs from 'node:fs';
import {
  BRAND, SLOGAN, esc, slugify, siteUrlFrom, money,
  organizationSchema, siteNavigationSchema, breadcrumbSchema,
  productSchema, storeSchema, itemListSchema, collectionPageSchema,
  aboutPageSchema, injectSeo
} from './seo.js';

// productSlug: main-catalog products already carry a slug from admin creation.
// Reseller listings never got one (see server/index.js buildVariants), so we
// derive a stable one here for SEO URLs / the sitemap without touching the
// listing objects themselves.
const productSlug = (p) => p.slug || `${slugify(p.title || p.name)}-${String(p.id).slice(-6)}`;

// Owner Studio category names are stored exactly as typed (e.g. "WOMENS"), so
// titles/schemas display them in normal case; URLs and lookups keep the raw name.
const titleCase = (str) => String(str || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const PAGE_STYLE = `body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#0b1714;color:#f2efe6}
.wrap{max-width:960px;margin:0 auto;padding:32px 20px 80px}
a{color:#cbbd91}
.hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px}
.hdr img{height:34px}
.hdr a{text-decoration:none;color:#f2efe6;font-size:12px;letter-spacing:.1em;text-transform:uppercase;border:1px solid #cbbd91;padding:9px 16px;border-radius:2px}
h1{font-size:26px;margin:0 0 6px}
.kicker{color:#cbbd91;font-size:12px;letter-spacing:.12em;text-transform:uppercase}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:18px;margin-top:26px}
.card{display:block;background:#122420;border-radius:4px;overflow:hidden;text-decoration:none;color:#f2efe6}
.card img{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;background:#1b332c}
.card .body{padding:10px 12px}
.card h3{font-size:13px;margin:0 0 4px;font-weight:600}
.card p{margin:0;font-size:12px;color:#cbbd91}
.empty{margin-top:30px;color:#9fae9f}`;

function shell({ siteUrl, bodyTitle, bodyKicker, bodyHtml }) {
  return `<div class="wrap">
<div class="hdr"><a href="${esc(siteUrl)}/"><img src="/zeeor-logo.png" alt="${esc(BRAND)}" /></a><a href="${esc(siteUrl)}/#shop">Shop on ZEEOR ↗</a></div>
<span class="kicker">${esc(bodyKicker)}</span>
<h1>${esc(bodyTitle)}</h1>
${bodyHtml}
</div>`;
}

function cardHtml(url, image, name, priceLabel) {
  return `<a class="card" href="${esc(url)}"><img src="${esc(image)}" alt="${esc(name)}" loading="lazy" />
<div class="body"><h3>${esc(name)}</h3><p>${esc(priceLabel)}</p></div></a>`;
}

/**
 * @param {object} deps
 * @param {() => object} deps.readStore
 * @param {(store: object) => object[]} deps.catalogItems  - products + active reseller listings, normalized
 * @param {(product: object) => object} deps.publicProduct
 * @param {(store: object) => string[]} deps.visibleCategoryNames
 */
export function createSeoRouter(deps) {
  const { readStore, catalogItems, publicProduct, visibleCategoryNames } = deps;
  const router = express.Router();

  // ---- robots.txt -----------------------------------------------------
  router.get('/robots.txt', (req, res) => {
    const siteUrl = siteUrlFrom(req);
    res.type('text/plain').send(
      `User-agent: *
Allow: /
Disallow: /api/
Disallow: /owner
Disallow: /reseller
Disallow: /login
Disallow: /cart
Disallow: /checkout
Disallow: /account

Sitemap: ${siteUrl}/sitemap.xml
`
    );
  });

  // ---- sitemap.xml — every live product, category and vendor shop -----
  router.get('/sitemap.xml', (req, res) => {
    const siteUrl = siteUrlFrom(req);
    const store = readStore();
    const items = catalogItems(store).filter((p) => p.published !== false);
    const categories = visibleCategoryNames(store);
    const activeResellers = (store.resellers || []).filter((r) => r.active !== false);

    const urls = [
      { loc: `${siteUrl}/`, priority: '1.0', changefreq: 'daily' },
      { loc: `${siteUrl}/stores`, priority: '0.7', changefreq: 'daily' },
      ...categories.map((name) => ({ loc: `${siteUrl}/${slugify(name)}`, priority: '0.8', changefreq: 'daily' })),
      ...items.map((p) => ({ loc: `${siteUrl}/products/${productSlug(p)}`, priority: '0.6', changefreq: 'weekly' })),
      ...activeResellers.map((r) => ({ loc: `${siteUrl}/stores/${r.username}`, priority: '0.6', changefreq: 'weekly' }))
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>`;
    res.type('application/xml').send(xml);
  });

  // ---- /products/:slug — crawlable product page, then hands real users
  // into the working SPA at #product/:id (same pattern the app already
  // uses at /share/:id, extended with full Product/Offer JSON-LD). --------
  router.get('/products/:slug', (req, res) => {
    const store = readStore();
    const product = catalogItems(store).find((p) => p.slug === req.params.slug || p.id === req.params.slug || productSlug(p) === req.params.slug);
    if (!product) return res.status(404).end();
    const pub = publicProduct(product);
    const siteUrl = siteUrlFrom(req);
    const canonical = `${siteUrl}/products/${productSlug(pub)}`;
    const appUrl = `${siteUrl}/#product/${pub.id}`;
    const image = pub.images?.[0] || `${siteUrl}/zeeor-editorial.jpg`;
    const price = money(pub.salePrice || pub.price);
    const title = `${pub.name} — ${BRAND}`;
    const description = pub.shortDescription || `${price} · ${pub.category || 'Shop'} on ${BRAND} — ${SLOGAN.toLowerCase()}.`;

    const jsonLd = [
      productSchema(siteUrl, pub, canonical),
      breadcrumbSchema(siteUrl, [
        { name: 'Home', url: `${siteUrl}/` },
        { name: pub.category || 'Shop', url: `${siteUrl}/${slugify(pub.category || '')}` },
        { name: pub.name, url: canonical }
      ])
    ];

    const head = `<!doctype html><html lang="en"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>${PAGE_STYLE}</style></head>`;
    let html = injectSeo(`${head}<body></body></html>`, { title, description, canonical, ogImage: image, ogType: 'product', jsonLd });
    const body = shell({
      siteUrl, bodyKicker: pub.category || 'ZEEOR', bodyTitle: pub.name,
      bodyHtml: `<img src="${esc(image)}" alt="${esc(pub.name)}" style="width:100%;max-width:420px;border-radius:4px;margin:20px 0" /><p>${esc(price)}</p><p>${esc(pub.description || '')}</p><a href="${esc(appUrl)}" style="display:inline-block;background:#274d3d;color:#f2efe6;padding:13px 26px;text-decoration:none;text-transform:uppercase;letter-spacing:.08em;font-size:12px;border-radius:2px">Shop now ↗</a><script>location.replace(${JSON.stringify(appUrl)});</script>`
    });
    html = html.replace('<body></body>', `<body>${body}</body>`);
    res.set('Content-Type', 'text/html').send(html);
  });

  // ---- /stores — vendor directory --------------------------------------
  router.get('/stores', (req, res) => {
    const siteUrl = siteUrlFrom(req);
    const store = readStore();
    const resellers = (store.resellers || []).filter((r) => r.active !== false);
    const canonical = `${siteUrl}/stores`;
    const title = `Sellers on ${BRAND} — Local Shops Across Pakistan`;
    const description = `Browse independent local sellers on ${BRAND}'s multi-vendor marketplace — every shop on zeeor.shop/stores/vendor-name.`;
    const jsonLd = [
      itemListSchema(canonical, 'ZEEOR Sellers', resellers.map((r) => ({ url: `${siteUrl}/stores/${r.username}`, name: r.displayName || r.username }))),
      breadcrumbSchema(siteUrl, [{ name: 'Home', url: `${siteUrl}/` }, { name: 'Stores', url: canonical }])
    ];
    const head = `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><style>${PAGE_STYLE}</style></head>`;
    let html = injectSeo(`${head}<body></body></html>`, { title, description, canonical, jsonLd });
    const cards = resellers.length
      ? `<div class="grid">${resellers.map((r) => `<a class="card" href="${esc(siteUrl)}/stores/${esc(r.username)}"><div class="body"><h3>${esc(r.displayName || r.username)}</h3><p>${(r.listings || []).length} listings</p></div></a>`).join('')}</div>`
      : `<p class="empty">No active sellers yet.</p>`;
    const body = shell({ siteUrl, bodyKicker: 'ZEEOR MARKETPLACE', bodyTitle: 'Sellers on ZEEOR', bodyHtml: cards });
    html = html.replace('<body></body>', `<body>${body}</body>`);
    res.set('Content-Type', 'text/html').send(html);
  });

  // ---- /stores/:username — one vendor's storefront ----------------------
  router.get('/stores/:username', (req, res) => {
    const siteUrl = siteUrlFrom(req);
    const store = readStore();
    const reseller = (store.resellers || []).find((r) => r.username === req.params.username && r.active !== false);
    if (!reseller) return res.status(404).end();
    const canonical = `${siteUrl}/stores/${reseller.username}`;
    const listings = (reseller.listings || []).filter((l) => l.active !== false);
    const title = `${reseller.displayName || reseller.username} — Seller on ${BRAND}`;
    const description = `Shop ${listings.length} listing${listings.length === 1 ? '' : 's'} from ${reseller.displayName || reseller.username}, an independent seller on ${BRAND}'s Pakistan-wide marketplace.`;
    const jsonLd = [
      storeSchema(siteUrl, reseller, canonical),
      itemListSchema(canonical, `${reseller.displayName || reseller.username} — Listings`, listings.map((l) => ({ url: `${siteUrl}/products/${productSlug(l)}`, name: l.title }))),
      breadcrumbSchema(siteUrl, [{ name: 'Home', url: `${siteUrl}/` }, { name: 'Stores', url: `${siteUrl}/stores` }, { name: reseller.displayName || reseller.username, url: canonical }])
    ];
    const head = `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><style>${PAGE_STYLE}</style></head>`;
    let html = injectSeo(`${head}<body></body></html>`, { title, description, canonical, jsonLd });
    const cards = listings.length
      ? `<div class="grid">${listings.map((l) => cardHtml(`${siteUrl}/products/${productSlug(l)}`, l.images?.[0] || `${siteUrl}/zeeor-editorial.jpg`, l.title, money(l.salePrice || l.price))).join('')}</div>`
      : `<p class="empty">This seller has no active listings right now.</p>`;
    const body = shell({ siteUrl, bodyKicker: 'ZEEOR SELLER', bodyTitle: reseller.displayName || reseller.username, bodyHtml: cards });
    html = html.replace('<body></body>', `<body>${body}</body>`);
    res.set('Content-Type', 'text/html').send(html);
  });

  // ---- /about-zeeor — founder-story / Organization page for the
  // Knowledge Graph. Purely additive; the SPA's own #about page is
  // untouched. -----------------------------------------------------------
  router.get('/about-zeeor', (req, res) => {
    const siteUrl = siteUrlFrom(req);
    const canonical = `${siteUrl}/about-zeeor`;
    const title = `About ${BRAND} — A Marketplace Built by Two University Students`;
    const description = `${BRAND} was founded by two Pakistani university students. Local sellers open their own shops here and sell everyday wear and daily-use items across Pakistan.`;
    const jsonLd = [organizationSchema(siteUrl), aboutPageSchema(siteUrl), breadcrumbSchema(siteUrl, [{ name: 'Home', url: `${siteUrl}/` }, { name: 'About', url: canonical }])];
    const head = `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><style>${PAGE_STYLE}</style></head>`;
    let html = injectSeo(`${head}<body></body></html>`, { title, description, canonical, jsonLd });
    const body = shell({
      siteUrl, bodyKicker: 'THE STORY', bodyTitle: `About ${BRAND}`,
      bodyHtml: `<p>ZEEOR is a Pakistani online marketplace, founded by two university students. Local sellers open their own shops on zeeor.shop and sell everyday clothing and daily-use items, so customers can find daily wear from many sellers in one place.</p><a href="${esc(siteUrl)}/#about" style="display:inline-block;background:#274d3d;color:#f2efe6;padding:13px 26px;text-decoration:none;text-transform:uppercase;letter-spacing:.08em;font-size:12px;border-radius:2px">Read on ZEEOR ↗</a>`
    });
    html = html.replace('<body></body>', `<body>${body}</body>`);
    res.set('Content-Type', 'text/html').send(html);
  });

  // ---- /:categorySlug — only fires for a slug that matches a real, live
  // category name (e.g. /women, /men, or any new category the owner adds
  // later in Owner Studio). Anything else calls next() so every existing
  // route (/cart, /login, /owner, /about, static files, etc.) behaves
  // exactly as before. ------------------------------------------------
  router.get('/:categorySlug', (req, res, next) => {
    const store = readStore();
    const categories = visibleCategoryNames(store);
    const match = categories.find((name) => slugify(name) === req.params.categorySlug);
    if (!match) return next();

    const siteUrl = siteUrlFrom(req);
    const canonical = `${siteUrl}/${slugify(match)}`;
    const appUrl = `${siteUrl}/#shop/${encodeURIComponent(match)}`;
    const items = catalogItems(store).filter((p) => p.published !== false && p.category === match);
    const label = titleCase(match);
    const title = `${label} — Shop Online in Pakistan | ${BRAND}`;
    const description = `Shop ${label} online across Pakistan on ${BRAND} — ${items.length} piece${items.length === 1 ? '' : 's'} available, cash on delivery, ${SLOGAN.toLowerCase()}.`;
    const jsonLd = [
      collectionPageSchema(siteUrl, canonical, label),
      itemListSchema(canonical, `${label} — ${BRAND}`, items.slice(0, 50).map((p) => ({ url: `${siteUrl}/products/${productSlug(p)}`, name: p.name }))),
      breadcrumbSchema(siteUrl, [{ name: 'Home', url: `${siteUrl}/` }, { name: label, url: canonical }])
    ];
    const head = `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><style>${PAGE_STYLE}</style></head>`;
    let html = injectSeo(`${head}<body></body></html>`, { title, description, canonical, jsonLd });
    const cards = items.length
      ? `<div class="grid">${items.map((p) => cardHtml(`${siteUrl}/products/${productSlug(p)}`, p.images?.[0] || `${siteUrl}/zeeor-editorial.jpg`, p.name, money(p.salePrice || p.price))).join('')}</div>`
      : `<p class="empty">New pieces are on the way.</p>`;
    const body = shell({
      siteUrl, bodyKicker: 'ZEEOR CATEGORY', bodyTitle: label,
      bodyHtml: `${cards}<p style="margin-top:26px"><a href="${esc(appUrl)}" style="color:#cbbd91">Continue in the ${esc(BRAND)} app ↗</a></p><script>location.replace(${JSON.stringify(appUrl)});</script>`
    });
    html = html.replace('<body></body>', `<body>${body}</body>`);
    res.set('Content-Type', 'text/html').send(html);
  });

  return router;
}


/**
 * Homepage only. express.static would otherwise serve dist/index.html as-is,
 * so this runs BEFORE it: it swaps the static SiteNavigationElement block for
 * one built from the live category list (new categories appear automatically).
 * Any problem at all -> next(), i.e. the homepage is served exactly as before.
 */
export function createHomeSeo({ readStore, visibleCategoryNames, distIndexPath }) {
  let cache = { mtime: 0, html: '' };
  return (req, res, next) => {
    if (req.method !== 'GET' || req.path !== '/') return next();
    try {
      const stat = fs.statSync(distIndexPath);
      if (stat.mtimeMs !== cache.mtime) cache = { mtime: stat.mtimeMs, html: fs.readFileSync(distIndexPath, 'utf8') };
      const siteUrl = siteUrlFrom(req);
      const names = [...visibleCategoryNames(readStore()).map(titleCase), 'Stores'];
      const nav = `<script type="application/ld+json">${JSON.stringify(siteNavigationSchema(siteUrl, names))}</script>`;
      const html = cache.html
        .replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, (m, body) => (body.includes('SiteNavigationElement') ? '' : m))
        .replace('</head>', `${nav}\n</head>`);
      res.set('Content-Type', 'text/html; charset=utf-8').set('Cache-Control', 'no-cache').send(html);
    } catch {
      next();
    }
  };
}
