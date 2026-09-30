// Clean, table-based HTML emails (inline CSS so Gmail / Outlook / phone mail apps all render them the same).
// Every value that comes from a customer or seller goes through esc() — nothing user-typed is ever inserted as raw HTML.
import { siteUrl } from './mailer.js';

const C = { forest: '#102c24', moss: '#274d3d', gold: '#cbbd91', cream: '#f7f4ec', page: '#efece3', ink: '#0b1714', muted: '#73807a', line: '#e4dfcf' };
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
export const money = (value) => `Rs ${Math.round(Number(value) || 0).toLocaleString('en-US')}`;
const when = (iso) => { try { return new Date(iso || Date.now()).toLocaleString('en-GB', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' }); } catch { return String(iso || ''); } };
// Only http(s) links; "/uploads/x.jpg" becomes absolute. Anything else (javascript:, data:) is dropped.
export function absoluteUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (value.startsWith('/')) return `${siteUrl()}${value}`;
  return /^https?:\/\//i.test(value) ? value : '';
}
const variantText = (item) => [item.color && item.color !== 'Default' ? item.color : '', item.size && item.size !== 'One Size' ? item.size : ''].filter(Boolean).join(' / ');

function layout({ preheader, badge, title, intro, body, button, footerNote }) {
  const btn = button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 4px"><tr><td bgcolor="${C.forest}" style="border-radius:2px"><a href="${esc(button.href)}" style="display:inline-block;padding:14px 26px;font:700 12px ${SANS};letter-spacing:.12em;text-transform:uppercase;color:${C.cream};text-decoration:none">${esc(button.label)}</a></td></tr></table>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.page}">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.page}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:4px;overflow:hidden">
<tr><td bgcolor="${C.forest}" align="center" style="padding:30px 24px 26px">
<div style="font:700 26px ${SERIF};letter-spacing:.32em;color:${C.cream}">ZEEOR</div>
<div style="margin-top:14px;font:700 11px ${SANS};letter-spacing:.16em;text-transform:uppercase;color:${C.gold}">${esc(badge)}</div>
</td></tr>
<tr><td style="padding:34px 32px 30px;font:400 15px/1.6 ${SANS};color:${C.ink}">
<h1 style="margin:0 0 8px;font:700 26px/1.2 ${SERIF};color:${C.forest}">${esc(title)}</h1>
<p style="margin:0 0 24px;color:${C.muted}">${esc(intro)}</p>
${body}${btn}
</td></tr>
<tr><td bgcolor="${C.cream}" align="center" style="padding:18px 24px;font:400 12px/1.6 ${SANS};color:${C.muted}">${esc(footerNote || 'Automatic notification from zeeor.shop')}</td></tr>
</table></td></tr></table></body></html>`;
}

const sectionTitle = (text) => `<div style="margin:26px 0 8px;font:700 11px ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${C.moss}">${esc(text)}</div>`;
// rows: [[label, value]] — values are escaped here; pass { html } for pre-built markup.
function kvTable(rows) {
  const tr = rows.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([label, value]) => `<tr><td valign="top" style="padding:9px 12px 9px 0;width:38%;border-bottom:1px solid ${C.line};font:600 13px ${SANS};color:${C.muted}">${esc(label)}</td><td valign="top" style="padding:9px 0;border-bottom:1px solid ${C.line};font:500 14px ${SANS};color:${C.ink}">${value && value.html !== undefined ? value.html : esc(value)}</td></tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed">${tr}</table>`;
}
function itemsTable(items, { showSeller = false } = {}) {
  const head = `<tr><td style="padding:8px 0;border-bottom:2px solid ${C.forest};font:700 11px ${SANS};letter-spacing:.1em;text-transform:uppercase;color:${C.forest}">Item</td><td align="center" style="padding:8px 6px;border-bottom:2px solid ${C.forest};font:700 11px ${SANS};letter-spacing:.1em;text-transform:uppercase;color:${C.forest}">Qty</td><td align="right" style="padding:8px 0;border-bottom:2px solid ${C.forest};font:700 11px ${SANS};letter-spacing:.1em;text-transform:uppercase;color:${C.forest}">Amount</td></tr>`;
  const rows = items.map((item) => {
    const variant = variantText(item);
    const sub = [variant, showSeller ? `Sold by ${item.soldBy}` : ''].filter(Boolean).join(' · ');
    return `<tr><td valign="top" style="padding:12px 8px 12px 0;border-bottom:1px solid ${C.line};font:600 14px ${SANS};color:${C.ink}">${esc(item.name)}${sub ? `<div style="margin-top:3px;font:400 12px ${SANS};color:${C.muted}">${esc(sub)}</div>` : ''}<div style="margin-top:3px;font:400 12px ${SANS};color:${C.muted}">${esc(money(item.unitPrice))} each</div></td><td align="center" valign="top" style="padding:12px 6px;border-bottom:1px solid ${C.line};font:600 14px ${SANS}">${esc(item.quantity)}</td><td align="right" valign="top" style="padding:12px 0;border-bottom:1px solid ${C.line};font:700 14px ${SANS};white-space:nowrap">${esc(money(item.unitPrice * item.quantity))}</td></tr>`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${head}${rows}</table>`;
}
function totalsTable(lines) {
  const rows = lines.map(([label, value, strong]) => `<tr><td style="padding:${strong ? '12px' : '5px'} 0 ${strong ? '0' : '5px'};font:${strong ? '700 16px' : '400 14px'} ${SANS};color:${strong ? C.forest : C.muted}">${esc(label)}</td><td align="right" style="padding:${strong ? '12px' : '5px'} 0 ${strong ? '0' : '5px'};font:${strong ? '700 20px' : '600 14px'} ${strong ? SERIF : SANS};color:${strong ? C.forest : C.ink}">${esc(value)}</td></tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px">${rows}</table>`;
}
const customerRows = (c, { withEmail }) => [['Name', c.name], ['Phone', c.phone], ...(withEmail ? [['Email', c.email]] : []), ['Address', [c.address, c.city, c.province, c.postal].filter(Boolean).join(', ')], ['Notes', c.notes]];
const paymentLabel = (order) => (!order.payment || order.payment === 'cod' ? 'Cash on delivery' : String(order.payment));

// ---------------------------------------------------------------- Trigger 1: new product uploaded by a seller (-> all owners)
export function newListingEmail({ listing, seller }) {
  const title = listing.title || listing.name || 'Untitled product';
  const image = absoluteUrl(listing.images?.[0]);
  const link = `${siteUrl()}/#product/${encodeURIComponent(listing.id)}`;
  const priceHtml = listing.salePrice && Number(listing.salePrice) < Number(listing.price)
    ? `<strong>${esc(money(listing.salePrice))}</strong> <span style="color:${C.muted};text-decoration:line-through">${esc(money(listing.price))}</span>`
    : `<strong>${esc(money(listing.price))}</strong>`;
  const category = [listing.category, listing.subcategory].filter(Boolean).join(' › ');
  const status = listing.active === false ? 'Hidden — not visible to customers' : 'Live on the store (published automatically)';
  const photo = image ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px"><tr><td align="center" bgcolor="${C.cream}" style="padding:14px"><a href="${esc(image)}"><img src="${esc(image)}" alt="${esc(title)}" width="240" style="display:block;width:240px;max-width:100%;height:auto;border:0"></a></td></tr></table>` : '';
  const body = `${photo}
${sectionTitle('Product')}
${kvTable([['Title', title], ['Price', { html: priceHtml }], ['Category', category], ['Approval status', status], ['Image link', image ? { html: `<a href="${esc(image)}" style="color:${C.moss}">${esc(image.length > 60 ? `${image.slice(0, 57)}…` : image)}</a>` } : 'No image'], ['Uploaded', when(listing.createdAt)]])}
${sectionTitle('Seller')}
${kvTable([['Seller name', seller.displayName || seller.username], ['Business email / ID', seller.email ? `${seller.email}  (ID: ${seller.id})` : `Not set  (ID: ${seller.id})`], ['Username', `@${seller.username}`], ['WhatsApp', seller.whatsapp]])}`;
  const html = layout({ preheader: `${seller.displayName || seller.username} listed “${title}” — ${money(listing.salePrice || listing.price)}`, badge: 'New product from a seller', title: 'A seller just added a product', intro: `${seller.displayName || seller.username} uploaded a new listing to ZEEOR.`, body, button: { label: 'View product', href: link } });
  const text = [`New product from a seller`, ``, `Title: ${title}`, `Price: ${money(listing.salePrice || listing.price)}${listing.salePrice && Number(listing.salePrice) < Number(listing.price) ? ` (was ${money(listing.price)})` : ''}`, `Category: ${category || '-'}`, `Approval status: ${status}`, `Image: ${image || '-'}`, ``, `Seller: ${seller.displayName || seller.username} (@${seller.username})`, `Business email / ID: ${seller.email || 'not set'} / ${seller.id}`, ``, `View: ${link}`].join('\n');
  return { subject: `New product: ${title} — by ${seller.displayName || seller.username}`, html, text };
}

// ---------------------------------------------------------------- Trigger 2a: full order (-> all owners)
export function ownerOrderEmail({ order }) {
  const c = order.customer || {};
  const items = order.items.map((item) => ({ ...item }));
  const sellers = [...new Set(items.map((i) => i.soldBy))];
  const totals = [['Subtotal', money(order.subtotal)], ...(order.discount > 0 ? [['Discount', `- ${money(order.discount)}`]] : []), ['Delivery', order.shipping ? money(order.shipping) : 'Free'], ['Total', money(order.total), true]];
  const body = `${sectionTitle('Order')}
${kvTable([['Order number', order.id], ['Placed', when(order.createdAt)], ['Payment', paymentLabel(order)], ['Status', order.status || 'Pending'], ['Sellers involved', sellers.join(', ')]])}
${sectionTitle('Items')}
${itemsTable(items, { showSeller: true })}
${totalsTable(totals)}
${sectionTitle('Customer & delivery')}
${kvTable(customerRows(c, { withEmail: true }))}`;
  const html = layout({ preheader: `${order.id} — ${money(order.total)} from ${c.name || 'a customer'}`, badge: `Order ${order.id}`, title: 'New order received', intro: `${c.name || 'A customer'} placed an order for ${money(order.total)}.`, body, button: { label: 'Open Owner Studio', href: `${siteUrl()}/#owner` } });
  const text = [`New order ${order.id} — ${money(order.total)}`, `Placed: ${when(order.createdAt)}`, `Payment: ${paymentLabel(order)}`, ``, ...items.map((i) => `- ${i.name}${variantText(i) ? ` (${variantText(i)})` : ''} x${i.quantity} = ${money(i.unitPrice * i.quantity)}  [${i.soldBy}]`), ``, `Subtotal ${money(order.subtotal)}${order.discount > 0 ? `, discount -${money(order.discount)}` : ''}, delivery ${order.shipping ? money(order.shipping) : 'free'}, TOTAL ${money(order.total)}`, ``, `Customer: ${c.name || ''}, ${c.phone || ''}, ${c.email || ''}`, `Address: ${[c.address, c.city, c.province, c.postal].filter(Boolean).join(', ')}`, c.notes ? `Notes: ${c.notes}` : ''].filter((l) => l !== undefined).join('\n');
  return { subject: `New order ${order.id} — ${money(order.total)} (${c.name || 'customer'})`, html, text };
}

// ---------------------------------------------------------------- Trigger 2b: filtered order (-> only the seller whose products were ordered)
// `items` are ONLY this seller's lines. Other sellers' products and the order-wide totals are never included.
export function sellerOrderEmail({ order, seller, items }) {
  const c = order.customer || {};
  const yourTotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const units = items.reduce((sum, i) => sum + Number(i.quantity), 0);
  const body = `${sectionTitle('Order')}
${kvTable([['Order number', order.id], ['Placed', when(order.createdAt)], ['Payment', paymentLabel(order)]])}
${sectionTitle('Your products in this order')}
${itemsTable(items)}
${totalsTable([['Your items total', money(yourTotal), true]])}
${sectionTitle('Deliver to')}
${kvTable(customerRows(c, { withEmail: false }))}
<p style="margin:22px 0 0;font:400 12px/1.6 ${SANS};color:${C.muted}">This email lists only your products. Please prepare the order and keep the ZEEOR team updated.</p>`;
  const html = layout({ preheader: `${units} item${units === 1 ? '' : 's'} ordered — ${money(yourTotal)} (${order.id})`, badge: `Order ${order.id}`, title: 'You have a new order', intro: `Hi ${seller.displayName || seller.username}, a customer just ordered ${units} item${units === 1 ? '' : 's'} from you.`, body, button: { label: 'Open seller panel', href: `${siteUrl()}/#reseller` } });
  const text = [`New order ${order.id} for ${seller.displayName || seller.username}`, `Placed: ${when(order.createdAt)}`, ``, ...items.map((i) => `- ${i.name}${variantText(i) ? ` (${variantText(i)})` : ''} x${i.quantity} = ${money(i.unitPrice * i.quantity)}`), ``, `Your items total: ${money(yourTotal)}`, ``, `Deliver to: ${c.name || ''}, ${c.phone || ''}`, `${[c.address, c.city, c.province, c.postal].filter(Boolean).join(', ')}`, c.notes ? `Notes: ${c.notes}` : ''].join('\n');
  return { subject: `New order ${order.id} — ${units} item${units === 1 ? '' : 's'} (${money(yourTotal)})`, html, text };
}
