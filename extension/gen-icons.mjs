// gen-icons.mjs — deterministic Night-style PNG icons (16/48/128), no deps.
// Painter's-algorithm pixel shader over a 0..31 logical grid, scaled up,
// encoded to real PNGs via zlib. Run: node gen-icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, 'icons');

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];
const GRAY = [141, 141, 141];
const COGNAC = [3, 149, 91];
const RGBA = (c, a = 255) => [...c, a];

function inRect(x, x0, y0, x1, y1) {
  return x[0] >= x0 && x[0] <= x1 && x[1] >= y0 && x[1] <= y1;
}

function shade(x, y) {
  const p = [x, y];
  // black backdrop + outlined card
  if (!inRect(p, 5.5, 6.5, 25.5, 26.5)) return RGBA(BLACK);
  // white card border
  const f = [7.5, 8.5, 23.5, 24.5];
  const outer = inRect(p, f[0] - 1, f[1] - 1, f[2] + 1, f[3] + 1);
  const inner = inRect(p, f[0] + 1, f[1] + 1, f[2] - 1, f[3] - 1);
  if (outer && !inner) return RGBA(WHITE);
  // gray inner hairline frame
  if (inRect(p, f[0], f[1], f[2], f[3]) && !inRect(p, f[0] + 0.5, f[1] + 0.5, f[2] - 0.5, f[3] - 0.5)) return RGBA(GRAY);
  // white band (mag stripe)
  if (inRect(p, 8, 13.5, 23, 16)) return RGBA(WHITE);
  // cognac stamp square (the only color)
  if (inRect(p, 18.5, 19.5, 22.5, 23)) return RGBA(COGNAC);
  return RGBA(BLACK);
}

function raster(logical) {
  // super-sample 2x for anti-aliasing feel
  const px = Buffer.alloc(logical * logical * 4);
  for (let y = 0; y < logical; y++) {
    for (let x = 0; x < logical; x++) {
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (const sy of [0.25, 0.75]) {
        for (const sx of [0.25, 0.75]) {
          const c = shade(x + sx, y + sy);
          acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += c[3];
          n++;
        }
      }
      const i = (y * logical + x) * 4;
      px[i] = Math.round(acc[0] / n);
      px[i + 1] = Math.round(acc[1] / n);
      px[i + 2] = Math.round(acc[2] / n);
      px[i + 3] = Math.round(acc[3] / n);
    }
  }
  return px;
}

// --- minimal PNG encoder ---
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(raw, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // filter 0 per scanline
  const stride = size * 4;
  const scanlines = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    scanlines[y * (stride + 1)] = 0;
    raw.copy(scanlines, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const size of [16, 48, 128]) {
  const png = encodePNG(raster(size), size);
  writeFileSync(join(OUT, `icon${size}.png`), png);
  console.log(`icon${size}.png  ${png.length} bytes`);
}
console.log('done');