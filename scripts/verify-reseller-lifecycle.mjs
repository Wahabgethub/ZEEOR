import fs from 'node:fs/promises';

const api = 'http://localhost:4000';
const json = (value) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
async function login(username, password) { const response = await fetch(`${api}/api/auth/login`, { method: 'POST', ...json({ username, password }) }); if (!response.ok) throw new Error(`login failed ${response.status}`); return response.json(); }
async function request(path, options = {}) { const response = await fetch(`${api}${path}`, options); const text = await response.text(); let body; try { body = JSON.parse(text); } catch { body = text; } if (!response.ok) throw new Error(`${path} ${response.status}: ${text}`); return body; }
const owner = await login('admin', 'ZeeorAdmin!2026');
const reseller = await login('zeeor-partner', 'ZeeorPartner#2026');
const image = await fs.readFile(new URL('../public/zeeor-logo.png', import.meta.url));
const form = new FormData(); form.append('images', new Blob([image], { type: 'image/png' }), 'zeeor-logo.png');
const upload = (await request('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${reseller.token}` }, body: form }))[0];
const listing = await request('/api/reseller/listings', { method: 'POST', headers: { Authorization: `Bearer ${reseller.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Lifecycle Verification Piece', category: 'Hoodies', price: 2500, salePrice: 2200, images: [upload.url], imagePublicIds: [upload.publicId], delivery: 'Nationwide delivery' }) });
try {
  const visible = await request('/api/products');
  if (!visible.products.some((product) => product.id === listing.id)) throw new Error('active reseller listing is not visible');
  await request(`/api/admin/resellers/${reseller.user.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ active: false }) });
  const hidden = await request('/api/products');
  if (hidden.products.some((product) => product.id === listing.id)) throw new Error('deactivated reseller listing is still visible');
  await request(`/api/admin/resellers/${reseller.user.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ active: true }) });
  const visibleAgain = await request('/api/products');
  if (!visibleAgain.products.some((product) => product.id === listing.id)) throw new Error('reactivated reseller listing did not return');
  await request(`/api/reseller/listings/${listing.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${reseller.token}` } });
  const removed = await request('/api/products');
  if (removed.products.some((product) => product.id === listing.id)) throw new Error('deleted reseller listing is still visible');
  console.log(JSON.stringify({ reseller: reseller.user.username, activeVisible: true, deactivatedHidden: true, reactivatedVisible: true, listingDeleted: true, cloudinaryPublicId: upload.publicId }));
} finally {
  await fetch(`${api}/api/admin/resellers/${reseller.user.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ active: true }) });
  await fetch(`${api}/api/reseller/listings/${listing.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${reseller.token}` } });
}
