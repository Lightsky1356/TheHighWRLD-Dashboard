import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const sharp = (await import('file:///C:/Users/duval/node_modules/sharp/dist/index.cjs')).default;
const src = 'icons/icon-512-fullbleed.png';

const icoSizes = [256, 128, 64, 48, 32, 16];
const buffers = [];
for (const sz of icoSizes) {
  buffers.push(await sharp(src).resize(sz, sz).png().toBuffer());
}

await sharp(src).resize(512, 512).png().toFile('apps/desktop/resources/icon.png');
console.log('icon.png written');

function buildIco(imgs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(imgs.length, 4);

  const dirs = Buffer.alloc(16 * imgs.length);
  let offset = 6 + 16 * imgs.length;
  const payload = [];

  for (let i = 0; i < imgs.length; i++) {
    const b = imgs[i];
    // PNG IHDR: width at bytes 16-19, height at 20-23 (big-endian)
    const w = b.readUInt32BE(16);
    const h = b.readUInt32BE(20);
    const d = Buffer.alloc(16);
    d.writeUInt8(w >= 256 ? 0 : w, 0);
    d.writeUInt8(h >= 256 ? 0 : h, 1);
    d.writeUInt8(0, 2);
    d.writeUInt8(0, 3);
    d.writeUInt16LE(1, 4);
    d.writeUInt16LE(32, 6);
    d.writeUInt32LE(b.length, 8);
    d.writeUInt32LE(offset, 12);
    d.copy(dirs, i * 16, 0, 16);
    offset += b.length;
    payload.push(b);
  }

  return Buffer.concat([header, dirs, ...payload]);
}

const icoBuf = buildIco(buffers);
writeFileSync('apps/desktop/resources/icon.ico', icoBuf);
console.log(`icon.ico written ${icoBuf.length} bytes`);