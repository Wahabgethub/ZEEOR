import fs from 'node:fs/promises';
import { uploadImage, deleteImage } from '../server/imageStorage.js';

const api = 'http://localhost:4000';
const fixture = await fs.readFile(new URL('../public/zeeor-logo.png', import.meta.url));
const uploaded = await uploadImage(fixture, { folder: 'zeeor/e2e-verification' });
if (!uploaded.url || !uploaded.publicId || uploaded.provider !== 'cloudinary') throw new Error('Cloudinary upload response was incomplete');

try {
  const loginResponse = await fetch(`${api}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: process.env.OWNER_USERNAME || 'admin', password: process.env.OWNER_PASSWORD || 'ZeeorAdmin!2026' }) });
  if (!loginResponse.ok) throw new Error(`Owner login failed: ${loginResponse.status}`);
  const { token } = await loginResponse.json();
  const form = new FormData();
  form.append('images', new Blob([fixture], { type: 'image/png' }), 'zeeor-logo.png');
  const uploadResponse = await fetch(`${api}/api/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  if (!uploadResponse.ok) throw new Error(`Authenticated upload failed: ${uploadResponse.status} ${await uploadResponse.text()}`);
  const [apiUpload] = await uploadResponse.json();
  if (!apiUpload?.url || !apiUpload?.publicId) throw new Error('Authenticated upload response was incomplete');
  const cmsResponse = await fetch(`${api}/api/admin/cms`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ heroImage: apiUpload.url }) });
  if (!cmsResponse.ok) throw new Error(`Cloudinary CMS hero update failed: ${cmsResponse.status}`);
  const restoreResponse = await fetch(`${api}/api/admin/cms`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ heroImage: '/zeeor-hero.jpg' }) });
  if (!restoreResponse.ok) throw new Error(`CMS hero restore failed: ${restoreResponse.status}`);
  await deleteImage(apiUpload.publicId);
  console.log(JSON.stringify({ upload: 'pass', apiUpload: 'pass', cmsHero: 'pass', apiDelete: 'pass', publicId: apiUpload.publicId }));
} finally {
  await deleteImage(uploaded.publicId);
}
