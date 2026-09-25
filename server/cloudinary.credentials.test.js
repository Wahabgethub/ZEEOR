import { describe, expect, it } from 'vitest';

describe('Cloudinary server credentials', () => {
  it('authenticate against Cloudinary resource API without exposing credentials', async () => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    expect(cloudName).toBeTruthy();
    expect(apiKey).toBeTruthy();
    expect(apiSecret).toBeTruthy();
    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload?max_results=1`, { headers: { Authorization: `Basic ${auth}` } });
    expect(response.ok).toBe(true);
    const body = await response.json();
    expect(body).toHaveProperty('resources');
  }, 15000);
});
