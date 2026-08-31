// Generate TheHighWRLD app icons from the existing square brand image.
// Outputs PWA + desktop/mobile sizes and a maskable variant (safe-zone padded).
import sharp from 'file:///C:/Users/duval/node_modules/sharp/dist/index.cjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'Juice-WRLD.png');
const OUT = path.join(__dirname, '..', 'icons');
const BG = '#0a0e1a'; // dark theme-complement background for maskable

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const square = (size, out) =>
    sharp(SRC).resize(size, size, { fit: 'cover' }).png().toFile(out);

  // Standard (non-maskable) icons.
  await square(192, path.join(OUT, 'icon-192.png'));
  await square(512, path.join(OUT, 'icon-512.png'));
  await square(48, path.join(OUT, 'icon-48.png'));
  await square(72, path.join(OUT, 'icon-72.png'));
  await square(96, path.join(OUT, 'icon-96.png'));
  await square(144, path.join(OUT, 'icon-144.png'));
  await square(180, path.join(OUT, 'apple-touch-icon.png'));
  await square(32, path.join(OUT, 'favicon-32.png'));
  await square(16, path.join(OUT, 'favicon-16.png'));

  // Maskable icons: centered brand image scaled ~56% on a filled dark canvas so
  // the OS mask (safe-zone = inner 80% circle) never clips the artwork.
  async function maskable(size, out) {
    const contentW = Math.round(size * 0.56);
    await sharp({
      create: { width: size, height: size, channels: 3, background: BG },
    })
      .composite([{ input: await sharp(SRC).resize(contentW, contentW, { fit: 'cover' }).png().toBuffer(), gravity: 'center' }])
      .png()
      .toFile(out);
  }
  await maskable(192, path.join(OUT, 'icon-maskable-192.png'));
  await maskable(512, path.join(OUT, 'icon-maskable-512.png'));

  // A 512 PNG with full-bleed artwork (primary manifest icon).
  await sharp(SRC).resize(512, 512, { fit: 'cover' }).png().toFile(path.join(OUT, 'icon-512-fullbleed.png'));

  console.log('Icons generated in', OUT);
  for (const f of fs.readdirSync(OUT)) console.log(' -', f);
})();
