// SEO helper module — pure additive layer.
// Nothing here touches store data, auth, orders, or any existing route logic.
// It only builds meta tags / JSON-LD strings and injects them into an HTML shell.

export const BRAND = 'ZEEOR';
export const SLOGAN = 'WEAR WITHOUT LIMITS';

export const esc = (str) =>
  String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const slugify = (str) =>
  String(str || '')
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const siteUrlFrom = (req) => process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;

const money = (value) => `Rs ${Number(value || 0).toLocaleString('en-PK')}`;

// ---------------------------------------------------------------------------
// JSON-LD schema builders — every field below is either a hard-coded brand
// fact given by the store owner, or pulled live from data/store.json. Nothing
// is invented (no fake ratings, no fake review counts, no placeholder social
// links) — that avoids a Google Search Console manual action for spammy
// structured data.
// ---------------------------------------------------------------------------

export function organizationSchema(siteUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${siteUrl}/#organization`,
    name: BRAND,
    alternateName: 'ZEEOR Fashion Store',
    url: siteUrl,
    slogan: SLOGAN,
    logo: {
      '@type': 'ImageObject',
      url: `${siteUrl}/zeeor-logo.png`,
      width: 1080,
      height: 1080
    },
    image: `${siteUrl}/zeeor-logo.png`,
    description:
      'ZEEOR is a Pakistani multi-vendor fashion marketplace — local shop owners open their own store on zeeor.shop and sell alongside the main ZEEOR catalog.',
    foundingLocation: { '@type': 'Place', name: 'Pakistan' },
    areaServed: { '@type': 'Country', name: 'Pakistan' },
    hasMerchantReturnPolicy: merchantReturnPolicySchema(siteUrl)
  };
}

export function websiteSchema(siteUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${siteUrl}/#website`,
    url: siteUrl,
    name: BRAND,
    description: `${BRAND} — ${SLOGAN.charAt(0)}${SLOGAN.slice(1).toLowerCase()}. Shop online across Pakistan.`,
    publisher: { '@id': `${siteUrl}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${siteUrl}/?q={search_term_string}` },
      'query-input': 'required name=search_term_string'
    }
  };
}

export function siteNavigationSchema(siteUrl, categoryNames) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SiteNavigationElement',
    name: categoryNames,
    url: categoryNames.map((name) => `${siteUrl}/${slugify(name)}`)
  };
}

export function breadcrumbSchema(siteUrl, items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url
    }))
  };
}

// Product schema for one catalog item (owner product OR reseller listing —
// both already carry the same normalized shape by the time this is called).
export function productSchema(siteUrl, product, canonicalUrl) {
  const price = Number(product.salePrice || product.price || 0);
  const inStock = Object.values(product.inventory || product.availability || {}).some((v) => Number(v) > 0);
  const images = (product.images?.length ? product.images : []).slice(0, 6);
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${canonicalUrl}#product`,
    name: product.name,
    description: product.shortDescription || product.description || `${product.name} — ${BRAND}, ${SLOGAN.toLowerCase()}.`,
    image: images.length ? images : undefined,
    sku: product.sku || product.id,
    brand: { '@type': 'Brand', name: BRAND },
    category: product.category,
    url: canonicalUrl,
    offers: {
      '@type': 'Offer',
      url: canonicalUrl,
      priceCurrency: 'PKR',
      price: price || undefined,
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: product.source === 'reseller'
        ? { '@type': 'Organization', name: product.sellerName || 'ZEEOR Partner' }
        : { '@id': `${siteUrl}/#organization` }
    }
  };
  // No aggregateRating / review block: the app stores free-text comments, not
  // star ratings, so a fabricated ratingValue would violate Google's
  // structured-data policy on reviews. Add it later only once real star
  // ratings exist.
  return schema;
}

export function storeSchema(siteUrl, reseller, canonicalUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Store',
    '@id': `${canonicalUrl}#store`,
    name: reseller.displayName || reseller.username,
    url: canonicalUrl,
    image: `${siteUrl}/zeeor-logo.png`,
    branch: { '@id': `${siteUrl}/#organization` },
    areaServed: { '@type': 'Country', name: 'Pakistan' },
    parentOrganization: { '@id': `${siteUrl}/#organization` }
  };
}

export function itemListSchema(canonicalUrl, name, urls) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    url: canonicalUrl,
    itemListElement: urls.map((u, i) => ({ '@type': 'ListItem', position: i + 1, url: u.url, name: u.name }))
  };
}

export function collectionPageSchema(siteUrl, canonicalUrl, categoryName) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${canonicalUrl}#collection`,
    name: `${categoryName} — ${BRAND}`,
    url: canonicalUrl,
    isPartOf: { '@id': `${siteUrl}/#website` }
  };
}

export function aboutPageSchema(siteUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    '@id': `${siteUrl}/about-zeeor#aboutpage`,
    url: `${siteUrl}/about-zeeor`,
    name: `About ${BRAND}`,
    mainEntity: {
      '@type': 'Organization',
      '@id': `${siteUrl}/#organization`,
      name: BRAND,
      slogan: SLOGAN,
      description:
        'ZEEOR was founded by two Pakistani student entrepreneurs as a multi-vendor fashion marketplace: local sellers open their own shop on zeeor.shop and reach customers across Pakistan alongside the main ZEEOR catalog.',
      logo: `${siteUrl}/zeeor-logo.png`,
      foundingLocation: { '@type': 'Place', name: 'Pakistan' }
    }
  };
}

// Documented facts only — 14-day unworn/tags-attached returns, as stated on
// the app's own Returns page. No returnFees/who-pays-shipping claim is made
// since that isn't published anywhere in the app yet.
export function merchantReturnPolicySchema(siteUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'MerchantReturnPolicy',
    applicableCountry: 'PK',
    returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
    merchantReturnDays: 14,
    returnMethod: 'https://schema.org/ReturnByMail',
    itemCondition: 'https://schema.org/NewCondition'
  };
}

// ---------------------------------------------------------------------------
// Head injector — takes the built index.html and layers page-specific meta +
// JSON-LD on top, without touching anything else in <head> or <body>.
// ---------------------------------------------------------------------------
export function injectSeo(html, { title, description, canonical, ogImage, ogType = 'website', jsonLd = [], robots = 'index, follow' }) {
  let out = html;
  out = out.replace(/<title>[\s\S]*?<\/title>/, '');
  out = out.replace(/<meta\s+name="description"[^>]*>/i, '');
  out = out.replace(/<meta\s+property="og:title"[^>]*>/i, '');
  out = out.replace(/<meta\s+property="og:description"[^>]*>/i, '');
  out = out.replace(/<meta\s+property="og:image"[^>]*>/i, '');
  out = out.replace(/<meta\s+property="og:type"[^>]*>/i, '');
  out = out.replace(/<meta\s+property="og:url"[^>]*>/i, '');
  out = out.replace(/<link\s+rel="canonical"[^>]*>/i, '');
  out = out.replace(/<meta\s+name="robots"[^>]*>/i, '');

  const jsonLdBlocks = jsonLd
    .filter(Boolean)
    .map((obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`)
    .join('\n');

  const injected = `<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<meta name="robots" content="${esc(robots)}" />
<link rel="canonical" href="${esc(canonical)}" />
<meta property="og:site_name" content="${esc(BRAND)}" />
<meta property="og:type" content="${esc(ogType)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(canonical)}" />
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}" />` : ''}
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
${ogImage ? `<meta name="twitter:image" content="${esc(ogImage)}" />` : ''}
${jsonLdBlocks}
</head>`;

  out = out.replace('</head>', injected);
  return out;
}

export { money };
