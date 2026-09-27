# ZEEOR — Google Search Console Checklist

Run this once after the SEO batch is deployed and `zeeor.shop` is live.

## 1. Verify the property
1. Go to https://search.google.com/search-console and add `https://zeeor.shop` as a **Domain** property (covers `www` and non-`www`, http and https, automatically).
2. Verify via the DNS TXT record your registrar/host gives you (this is the most durable method — it survives a server migration, unlike an HTML file or meta tag).

## 2. Submit the sitemap
1. In Search Console: **Sitemaps** → enter `sitemap.xml` → **Submit**.
2. Confirm it's reachable first: `curl https://zeeor.shop/sitemap.xml` should return XML listing every category, product and seller store. It updates itself automatically as products/categories/sellers change — no manual re-submission needed later.

## 3. Force Google to see the new favicon
Google's favicon crawler is separate from its page crawler and can lag behind by days. To speed it up:
1. Confirm the icons actually exist in production: `curl -I https://zeeor.shop/favicon-32x32.png` and `.../apple-touch-icon.png` should both return `200`.
2. In Search Console, open **URL Inspection**, paste `https://zeeor.shop/`, and click **Request Indexing** — this also nudges the favicon crawl.
3. Google typically refreshes the favicon shown in search results within a few days to two weeks; there's no separate "force" button beyond re-requesting indexing.

## 4. Ask for sitelinks
Sitelinks (the extra category links Google sometimes shows under your homepage result) are **algorithmic — you cannot directly request them.** What actually earns them:
- Clean internal linking, which the new `/women`, `/men`, `/hoodies`, etc. pages plus the `SiteNavigationElement` JSON-LD now provide.
- Consistent traffic and dwell time to a URL over time.
- Submitting the sitemap (step 2) so Google discovers and re-crawls those category URLs regularly.
There's nothing further to "force" here — this is the honest state of how sitelinks work.

## 5. Validate the structured data
1. Run a few live URLs through https://search.google.com/test/rich-results:
   - `https://zeeor.shop/` (Organization, WebSite)
   - `https://zeeor.shop/women` (CollectionPage, ItemList, BreadcrumbList)
   - any product, e.g. `https://zeeor.shop/products/<slug>` (Product, Offer, BreadcrumbList)
   - any seller, e.g. `https://zeeor.shop/stores/<username>` (Store, ItemList)
2. Fix anything flagged as an **error** (warnings are usually fine — e.g. "missing recommended field: review" is expected since the app doesn't collect star ratings yet).

## 6. Ongoing
- Every new category the owner creates in Owner Studio automatically gets a crawlable `/category-slug` page and a `sitemap.xml` entry — nothing to redo here.
- Every new product or reseller listing is added to `sitemap.xml` on its next crawl automatically.
- If star ratings get added to the app later, extend `productSchema()` in `server/seo.js` with a real `aggregateRating` — don't add one before there's real rating data behind it, or Search Console will flag it as a manual-action risk.
