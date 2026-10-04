import crypto from 'node:crypto';

// Photos never touch this server's disk: they arrive in memory (multer) and are forwarded straight to Cloudinary.
// Errors carry a plain-language reason so sellers can see WHY an upload failed instead of a generic "failed".
export class ImageUploadError extends Error {
  constructor(message, { status = 502, retryable = false } = {}) { super(message); this.name = 'ImageUploadError'; this.status = status; this.retryable = retryable; }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const apiBase = () => String(process.env.CLOUDINARY_API_BASE || 'https://api.cloudinary.com').replace(/\/+$/, '');

function cloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) throw new ImageUploadError('Photo storage is not set up on the server yet (Cloudinary keys are missing) — please tell the owner.', { status: 500 });
  return { cloudName, apiKey, apiSecret };
}

async function cloudinaryError(response) {
  let detail = '';
  try { detail = (await response.json())?.error?.message || ''; } catch { /* body was not JSON */ }
  const code = response.status;
  if (code === 401 || code === 403) return new ImageUploadError('Photo storage login failed (Cloudinary rejected the keys) — please tell the owner.', { status: 500 });
  if (code === 420 || code === 429) return new ImageUploadError('Photo storage is busy right now — please try again in a minute.', { status: 503, retryable: true });
  if (code >= 500) return new ImageUploadError('Photo storage had a temporary problem — please try again.', { status: 502, retryable: true });
  return new ImageUploadError(`The photo was rejected${detail ? `: ${detail}` : ` (error ${code})`}. Try a different photo (JPG or PNG).`, { status: 400 });
}

async function uploadOnce(buffer, folder) {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`).digest('hex');
  const form = new FormData();
  form.append('file', new Blob([buffer])); form.append('api_key', apiKey); form.append('timestamp', String(timestamp)); form.append('folder', folder); form.append('signature', signature);
  let response;
  try { response = await fetch(`${apiBase()}/v1_1/${cloudName}/image/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) }); }
  catch (error) { throw new ImageUploadError(error?.name === 'TimeoutError' ? 'Photo storage took too long to answer — please try again.' : 'The server could not reach photo storage — please try again.', { status: 504, retryable: true }); }
  if (!response.ok) throw await cloudinaryError(response);
  const data = await response.json();
  return { url: data.secure_url, publicId: data.public_id, provider: 'cloudinary' };
}

// Retries temporary problems (network, timeouts, 5xx, rate limits) automatically; a bad photo or bad keys fail straight away.
export async function uploadImage(buffer, { folder = 'zeeor', attempts = 3 } = {}) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await uploadOnce(buffer, folder); }
    catch (error) { last = error; if (!error.retryable || attempt === attempts) break; await sleep(500 * attempt * attempt); }
  }
  throw last;
}

export async function deleteImage(publicId) {
  if (!publicId) return;
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHash('sha1').update(`public_id=${publicId}&timestamp=${timestamp}${apiSecret}`).digest('hex');
  const form = new URLSearchParams({ public_id: publicId, api_key: apiKey, timestamp: String(timestamp), signature });
  const response = await fetch(`${apiBase()}/v1_1/${cloudName}/image/destroy`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
  if (!response.ok) throw new Error(`Cloudinary delete failed with ${response.status}`);
}
