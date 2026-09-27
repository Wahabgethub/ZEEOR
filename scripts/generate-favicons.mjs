// Generates the full favicon set Google's favicon crawler and mobile
// home-screens expect, from the existing public/zeeor-logo.png.
//
// Uses `jimp` — pure JavaScript, no native compilation, no system
// libraries (cairo/pixman/pango) required. Works on any machine.
//
//   npm install jimp@0.22.12
//   node scripts/generate-favicons.mjs
//
// Output lands in public/ so `npm run build` copies it straight into dist/.

import Jimp from 'jimp';
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
  const base = await Jimp.read(sourceLogo);

  const renderSquare = async (size, outPath) => {
    const img = base.clone().cover(size, size);
    await img.writeAsync(outPath);
    console.log(`✓ ${path.relative(process.cwd(), outPath)}`);
  };

  for (const size of sizes) {
    await renderSquare(size, path.join(publicDir, `favicon-${size}x${size}.png`));
  }
  await renderSquare(appleTouchSize, path.join(publicDir, 'apple-touch-icon.png'));
  await renderSquare(512, path.join(publicDir, 'android-chrome-512x512.png'));
  await renderSquare(192, path.join(publicDir, 'android-chrome-192x192.png'));

  console.log('\n✅ Favicon set generated. Run `npm run build` to ship it.');
}

run().catch((err) => {
  console.error('✗ Favicon generation failed:', err.message);
  process.exit(1);
});
