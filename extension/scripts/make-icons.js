// Generates icons/icon{16,32,48,128}.png with no dependencies.
// Run: node scripts/make-icons.js
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [16, 32, 48, 128];
const SS = 6; // supersampling per axis

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

// The mark, in a 32 x 32 design space (the same numbers as the inline SVG in the pages):
// a rounded tile with a blue to teal gradient, a meter ring whose white progress arc ends in a small bead,
// and a play triangle in the middle. Sizes 16 and 32 get a slightly heavier ring so it stays readable.
const GRAD_A = [0x2a, 0x78, 0xd6];
const GRAD_B = [0x0e, 0x8a, 0x8f];
const clamp01 = (v) => Math.max(0, Math.min(1, v));

function inRoundRect(x, y, size, r) {
  const dx = Math.abs(x - size / 2) - (size / 2 - r);
  const dy = Math.abs(y - size / 2) - (size / 2 - r);
  if (dx <= 0 || dy <= 0) return Math.abs(x - size / 2) <= size / 2 && Math.abs(y - size / 2) <= size / 2;
  return dx * dx + dy * dy <= r * r;
}

function distSeg(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const t = clamp01(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy));
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

function pointInTriangle(px, py, a, b, c) {
  const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const p = [px, py];
  const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** How much white (0..1) the mark puts at a point of the 32 x 32 design space. */
function markWhite(u, v, heavy, tiny) {
  const R = tiny ? 10.2 : 9.2;
  const W = tiny ? 4 : heavy ? 3.5 : 3; // ring width
  const half = W / 2;
  const d = Math.hypot(u - 16, v - 16);
  const band = Math.abs(d - R) <= half;
  let a = 0;
  if (band) a = tiny ? 0.3 : 0.28; // the faint track
  // progress arc: from 12 o'clock clockwise through 270 degrees, round caps, bead at the end
  let theta = Math.atan2(u - 16, -(v - 16)); // clockwise from the top
  if (theta < 0) theta += Math.PI * 2;
  if (band && theta <= Math.PI * 1.5) a = 1;
  if (Math.hypot(u - 16, v - (16 - R)) <= half) a = 1; // start cap
  if (Math.hypot(u - (16 - R), v - 16) <= (tiny ? 3.4 : heavy ? 3.1 : 2.7)) a = 1; // end bead
  // play triangle with softly rounded corners (a triangle grown by a small radius)
  const A = tiny ? [12.9, 11.2] : [13.7, 12.6], B = tiny ? [12.9, 20.8] : [13.7, 19.4], Cc = tiny ? [20.4, 16] : [19.3, 16];
  const grow = tiny ? 0.5 : heavy ? 1 : 0.7;
  const inside = pointInTriangle(u, v, A, B, Cc);
  const dist = inside ? 0 : Math.min(distSeg(u, v, A[0], A[1], B[0], B[1]), distSeg(u, v, B[0], B[1], Cc[0], Cc[1]), distSeg(u, v, Cc[0], Cc[1], A[0], A[1]));
  if (dist <= grow) a = 1;
  return a;
}

function render(size) {
  const out = Buffer.alloc(size * size * 4);
  const heavy = size <= 32;
  const tiny = size <= 16;
  const k = 32 / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, cov = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (px + (sx + 0.5) / SS) * k; // 0..32
          const v = (py + (sy + 0.5) / SS) * k;
          if (!inRoundRect(u, v, 32, 9)) continue;
          const t = clamp01(((u - 2) + (v - 2)) / 56);
          const w = markWhite(u, v, heavy, tiny);
          r += (GRAD_A[0] + (GRAD_B[0] - GRAD_A[0]) * t) * (1 - w) + 255 * w;
          g += (GRAD_A[1] + (GRAD_B[1] - GRAD_A[1]) * t) * (1 - w) + 255 * w;
          b += (GRAD_A[2] + (GRAD_B[2] - GRAD_A[2]) * t) * (1 - w) + 255 * w;
          cov += 1;
        }
      }
      const i = (py * size + px) * 4;
      out[i] = cov ? Math.round(r / cov) : 0;
      out[i + 1] = cov ? Math.round(g / cov) : 0;
      out[i + 2] = cov ? Math.round(b / cov) : 0;
      out[i + 3] = Math.round((cov / (SS * SS)) * 255);
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
