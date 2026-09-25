import crypto from 'node:crypto';

function cloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) throw new Error('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET on the server.');
  return { cloudName, apiKey, apiSecret };
}

export async function uploadImage(buffer, { folder = 'zeeor' } = {}) {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`).digest('hex');
  const form = new FormData();
  form.append('file', new Blob([buffer])); form.append('api_key', apiKey); form.append('timestamp', String(timestamp)); form.append('folder', folder); form.append('signature', signature);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`Cloudinary upload failed with ${response.status}`);
  const data = await response.json();
  return { url: data.secure_url, publicId: data.public_id, provider: 'cloudinary' };
}

export async function deleteImage(publicId) {
  if (!publicId) return;
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHash('sha1').update(`public_id=${publicId}&timestamp=${timestamp}${apiSecret}`).digest('hex');
  const form = new URLSearchParams({ public_id: publicId, api_key: apiKey, timestamp: String(timestamp), signature });
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
  if (!response.ok) throw new Error(`Cloudinary delete failed with ${response.status}`);
}
