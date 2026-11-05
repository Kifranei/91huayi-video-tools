const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'icons');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => a + (b - a) * t;

function inRoundRect(x, y, inset, radius) {
  const x0 = inset;
  const y0 = inset;
  const x1 = 1 - inset;
  const y1 = 1 - inset;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const dx = Math.max(x0 + radius - x, 0, x - (x1 - radius));
  const dy = Math.max(y0 + radius - y, 0, y - (y1 - radius));
  return Math.hypot(dx, dy) <= radius;
}

function inTriangle(x, y, a, b, c) {
  const sign = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = sign([x, y], a, b);
  const d2 = sign([x, y], b, c);
  const d3 = sign([x, y], c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

const TRI = [
  [0.37, 0.27],
  [0.37, 0.73],
  [0.75, 0.5],
];

function sample(x, y) {
  if (!inRoundRect(x, y, 0.02, 0.23)) return [0, 0, 0, 0];
  const t = (x + y) / 2;
  let r = lerp(0x4a, 0x8a, t);
  let g = lerp(0x7b, 0x5c, t);
  let b = lerp(0xff, 0xff, t);
  if (inTriangle(x, y, ...TRI)) {
    r = 255;
    g = 255;
    b = 255;
  }
  return [r, g, b, 255];
}

function render(size, ss = 4) {
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const [sr, sg, sb, sa] = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          const alpha = sa / 255;
          r += sr * alpha;
          g += sg * alpha;
          b += sb * alpha;
          a += sa;
        }
      }
      const n = ss * ss;
      const alpha = a / n / 255;
      const i = (py * size + px) * 4;
      buf[i] = alpha ? Math.round(r / n / alpha) : 0;
      buf[i + 1] = alpha ? Math.round(g / n / alpha) : 0;
      buf[i + 2] = alpha ? Math.round(b / n / alpha) : 0;
      buf[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePNG(size, size, buf);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = path.join(OUT, `icon${size}.png`);
  fs.writeFileSync(file, render(size, size <= 32 ? 6 : 4));
  console.log('wrote', file);
}
