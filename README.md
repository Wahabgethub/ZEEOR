# ZEEOR — Wear Without Limits

A portable full-stack premium fashion commerce starter built with React, Vite, Express, and a JSON data store. It includes a customer storefront, cart, wishlist, checkout, owner studio, reseller login, isolated reseller listings, Cloudinary-ready image uploads, and responsive PWA metadata for Linux, Windows, Android, and iOS browsers.

## Requirements

- Node.js 18+
- npm or pnpm
- A writable `data/` directory
- Cloudinary credentials for production image uploads

## Local setup

```bash
cp .env.example .env
# update OWNER_PASSWORD, JWT_SECRET, and Cloudinary variables
npm install
npm run dev
```

Open `http://localhost:5173`. The API runs on `http://localhost:4000`.

## Production

```bash
npm install
npm run build
NODE_ENV=production npm start
```

The Express server serves the built `dist/` directory. Put it behind Nginx or a load balancer on AWS EC2/Hostinger and terminate TLS there. For a database migration later, replace `server/db.js`; the route contracts and the Cloudinary adapter stay isolated.

## Accounts

The development owner credentials are taken from `OWNER_USERNAME` and `OWNER_PASSWORD`. The owner can create reseller accounts in Owner Studio. Reseller records and listings are scoped by `resellerId` on every server operation so one reseller cannot read or mutate another reseller's content.

## Image storage

All upload code lives in `server/imageStorage.js`. It uses Cloudinary when `IMAGE_STORAGE_PROVIDER=cloudinary` and returns a provider-neutral `{ url, publicId }` result. Swap the provider implementation in that one file if you later move to ImageKit. Never put provider secrets in frontend code.

## Scope notes

The app ships as a functional commerce foundation with seeded product data, catalog search/filtering, inventory by size and color, cart/wishlist persistence, coupon validation, checkout/order creation, owner product/order/CMS views, reseller isolation, and responsive editorial UI. Payment gateways, email delivery, 2FA, courier APIs, and a SQL adapter can be enabled by extending the existing server modules without changing the storefront contract.


## Verification

The included Vitest suite covers authentication and customer-facing inventory redaction; the production bundle is generated with `npm run build`.


## Security and account isolation

The server is self-hosted Express code and does not depend on a hosted runtime, builder database, builder auth, or builder file storage. Owner login defaults are `admin` / `ZeeorAdmin!2026`; change both through environment variables before production. This build starts with one isolated reseller account: username `zeeor-partner`, password `ZeeorPartner#2026`. The owner can create more accounts later from Owner Studio.

Every reseller API query uses the authenticated reseller ID. A reseller can only create/delete/read their own listings and cannot edit global products, prices, categories, orders, CMS, settings, or another reseller's data. Only the owner role can manage products, categories, prices, stock, orders, homepage content, and reseller accounts.

## Images and uploads

Seeded catalog images are local files. New admin/reseller uploads are accepted only through the authenticated `/api/upload` endpoint and are sent to Cloudinary through `server/imageStorage.js`. If a Cloudinary image is unavailable on a downloaded localhost copy, the browser falls back to the supplied local ZEEOR editorial image instead of showing a broken page. Keep the Cloudinary secrets only on the server. Per-image and whole-listing/product delete controls remove both the local record and the Cloudinary asset.


## Final commerce rules

Owner Studio has unlimited reseller account creation, owner-only category creation, product assignment into those categories, and owner-only regular/sale price editing. Sale prices render with the original regular price struck through on cards, product detail, cart, admin catalog, and reseller listings. Customer category links are driven by the owner category list and open filtered collections.

Each product or reseller listing stores its 1–5 images in one grouped array. Customers see that array as one horizontal swipeable gallery with thumbnails and dots. Admin and reseller upload forms use one multi-file selection, and each uploaded image has an individual delete control. Cloudinary public IDs are retained so deletion can remove the remote asset as well as the local record.

For AWS, Express serves both `/api/*` and the built frontend from one origin. The browser uses relative API paths in production; `vite.config.js` proxies `/api` to port 4000 only during local development.


## Verified Cloudinary flow

Cloudinary credentials are configured as server-only environment variables. The authenticated upload endpoint, direct provider adapter, CMS hero update and restore, per-image deletion, and whole-product/listing gallery deletion have been exercised against the live Cloudinary API. The frontend bundle contains no Cloudinary credentials. Run `npm test` for the six-test suite and `node scripts/verify-cloudinary-e2e.mjs` for the end-to-end upload/delete check.

## Owner Studio quick guide

In **Homepage CMS**, edit the eyebrow, headline, and intro copy, then choose one hero image file and press **Publish changes**. The file is uploaded to Cloudinary by the server and the homepage updates; no image URL needs to be pasted manually.

In **Catalog authority**, enter the product name, short description, full product description, regular price, optional sale price, owner-created category, and grouped images. The **Stock by colour and size** field uses simple JSON keys such as `{"Black-S":5,"Black-M":3}`: this means five black Small items and three black Medium items. Customers only receive safe availability information, while the owner sees and edits the complete stock JSON.

In **Reseller accounts**, the **Deactivate** button immediately hides that reseller's listings and their Cloudinary images from the customer catalog without deleting them. **Activate** makes the listings visible again. Deleting an image or an entire listing permanently removes the corresponding Cloudinary assets.

All storefront prices are displayed in **PKR / Rs**.
