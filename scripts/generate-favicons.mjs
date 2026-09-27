// Generates the full favicon set Google's favicon crawler and mobile
// home-screens expect, from the existing public/zeeor-logo.png.
// One-time (re-run whenever the logo changes).
//
//   npm install canvas
//   node scripts/generate-favicons.mjs
//
// Output lands in public/ so `npm run build` copies it straight into dist/.

import { createCanvas, loadImage } from 'canvas';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, '..', 'public');
const sourceLogo = path.join(publicDir, 'zeeor-logo.png');

const sizes = [16, 32, 48, 96, 144, 192, 512];
const appleTouchSize = 180;

async function run() {
  if (!fs.existsSync(sourceLogo)) {
    console.error(`✗ Source logo not found at ${sourceLogo}`);
    process.exit(1);
  }
  const image = await loadImage(sourceLogo);

  const renderSquare = (size) => {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    // Emerald background so transparent corners never render as a white box
    // in browser tabs / dark home-screens.
    ctx.fillStyle = '#0A2417';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(image, 0, 0, size, size);
    return canvas.toBuffer('image/png');
  };

  for (const size of sizes) {
    const buffer = renderSquare(size);
    const outPath = path.join(publicDir, `favicon-${size}x${size}.png`);
    fs.writeFileSync(outPath, buffer);
    console.log(`✓ ${path.relative(process.cwd(), outPath)}`);
  }

  const appleBuffer = renderSquare(appleTouchSize);
  fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), appleBuffer);
  console.log('✓ public/apple-touch-icon.png');

  // android-chrome-512x512.png is what manifest.json points to for PWA installs
  fs.writeFileSync(path.join(publicDir, 'android-chrome-512x512.png'), renderSquare(512));
  console.log('✓ public/android-chrome-512x512.png');
  fs.writeFileSync(path.join(publicDir, 'android-chrome-192x192.png'), renderSquare(192));
  console.log('✓ public/android-chrome-192x192.png');

  console.log('\n✅ Favicon set generated. Run `npm run build` to ship it.');
}

run().catch((err) => {
  console.error('✗ Favicon generation failed:', err.message);
  process.exit(1);
});
