// gen-icons.mjs — deterministic clay-style PNG icons (16/48/128), no deps.
// Painter's-algorithm pixel shader over a 0..31 logical grid, scaled up,
// encoded to real PNGs via zlib. Run: node gen-icons.mjs

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, 'icons');

const INK = [61, 44, 46];
const PAPER = [254, 251, 244];
const AMBER = [245, 200, 107];
const GREEN = [159, 230, 160];
const RGBA = (c, a = 255) => [...c, a];

function rr(x, cx, cy, r) {
  const dx = x[0] - cx;
  const dy = x[1] - cy;
  return Math.sqrt(dx * dx + dy * dy) <= r;
}

function inRoundRect(x, x0, y0, x1, y1, r) {
  const minX = Math.max(x[0], x0 + r);
  const maxX = Math.min(x[0], x1 - r);
  const minY = Math.max(x[1], y0 + r);
  const maxY = Math.min(x[1], y1 - r);
  if (minX <= maxX && minY <= maxY) return true;
  // corner circles
  for (const cx of [x0 + r, x1 - r]) {
    for (const cy of [y0 + r, y1 - r]) {
      if (rr(x, cx, cy, r)) return true;
    }
  }
  return false;
}

function shade(x, y) {
  const p = [x, y];
  const card = [5.5, 6.5, 25.5, 26.5];
  const r = 7;
  // backdrop
  if (!inRoundRect(p, card[0], card[1], card[2], card[3], r)) return RGBA(INK);
  // amber header band
  if (inRoundRect(p, card[0] - 2, card[1] - 2, card[2], card[1] + 5.5, 6)) return RGBA(AMBER);
  // body paper
  if (y > card[1] + 5.5) return RGBA(PAPER);
  // shield (green scored circle with ink ring)
  const d = Math.sqrt((x - 15.5) ** 2 + (y - 18.5) ** 2);
  if (d <= 6) return RGBA(GREEN);
  return RGBA(PAPER);
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