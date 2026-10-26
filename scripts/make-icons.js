// Generates icons/icon{16,32,48,128}.png with no dependencies.
// Run: node scripts/make-icons.js
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [16, 32, 48, 128];
const SS = 4; // supersampling per axis

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function inRoundRect(x, y, cx, cy, w, h, r) {
  const dx = Math.abs(x - cx) - (w / 2 - r);
  const dy = Math.abs(y - cy) - (h / 2 - r);
  if (dx <= 0 || dy <= 0) return Math.abs(x - cx) <= w / 2 && Math.abs(y - cy) <= h / 2;
  return dx * dx + dy * dy <= r * r;
}

function inTriangle(x, y, a, b, c) {
  const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const p = [x, y];
  const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

const lerp = (a, b, t) => Math.round(a + (b - a) * t);

function render(size) {
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size; // 0..1
          const y = (py + (sy + 0.5) / SS) / size;
          if (!inRoundRect(x, y, 0.5, 0.5, 1, 1, 0.22)) continue;
          const t = (x + y) / 2; // diagonal gradient, blue to violet
          let cr = lerp(0x2a, 0x62, t), cg = lerp(0x78, 0x50, t), cb = lerp(0xd6, 0xd6, t);
          // white phone body
          if (inRoundRect(x, y, 0.5, 0.5, 0.42, 0.68, 0.09)) {
            cr = cg = cb = 255;
            // play triangle cut in the phone
            if (inTriangle(x, y, [0.44, 0.38], [0.44, 0.62], [0.6, 0.5])) {
              cr = lerp(0x2a, 0x62, 0.5); cg = lerp(0x78, 0x50, 0.5); cb = 0xd6;
            }
          }
          r += cr; g += cg; b += cb; a += 255;
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      const cover = a / 255;
      out[i] = cover ? Math.round(r / cover) : 0;
      out[i + 1] = cover ? Math.round(g / cover) : 0;
      out[i + 2] = cover ? Math.round(b / cover) : 0;
      out[i + 3] = Math.round((cover / n) * 255);
    }
  }
  return out;
}

const dir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(dir, { recursive: true });
for (const size of SIZES) {
  fs.writeFileSync(path.join(dir, `icon${size}.png`), png(size, render(size)));
  console.log('wrote icons/icon' + size + '.png');
}
