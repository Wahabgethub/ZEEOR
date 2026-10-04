import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageUploadError, uploadImage } from './imageStorage.js';

const ok = () => new Response(JSON.stringify({ secure_url: 'https://res.cloudinary.com/x/a.jpg', public_id: 'zeeor/a' }), { status: 200 });
const fail = (status, body = {}) => new Response(JSON.stringify(body), { status });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
process.env.CLOUDINARY_CLOUD_NAME = 'demo'; process.env.CLOUDINARY_API_KEY = 'k'; process.env.CLOUDINARY_API_SECRET = 's';

describe('uploadImage', () => {
  it('retries temporary failures and then succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(fail(503)).mockResolvedValueOnce(fail(502)).mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetchMock);
    const result = await uploadImage(Buffer.from('x'));
    expect(result).toEqual({ url: 'https://res.cloudinary.com/x/a.jpg', publicId: 'zeeor/a', provider: 'cloudinary' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('fails straight away, with the reason, when the photo itself is rejected', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fail(400, { error: { message: 'Invalid image file' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(uploadImage(Buffer.from('x'))).rejects.toMatchObject({ status: 400, retryable: false, message: expect.stringContaining('Invalid image file') });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not retry wrong keys and says who must fix it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fail(401, { error: { message: 'Invalid api_key' } }));
    vi.stubGlobal('fetch', fetchMock);
    const error = await uploadImage(Buffer.from('x')).catch((e) => e);
    expect(error).toBeInstanceOf(ImageUploadError); expect(error.retryable).toBe(false); expect(error.message).toMatch(/owner/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('turns a network error into a retryable message', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);
    const error = await uploadImage(Buffer.from('x'), { attempts: 2 }).catch((e) => e);
    expect(error.retryable).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
