// Generates extension/media/icon.png (256x256) — pure Node, no image libraries.
// Design: blue gradient rounded square, white phone with a chat bubble, green ✓ badge.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const W = 256;
const H = 256;
const SS = 3; // 3x3 supersampling for smooth edges

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
function inRoundRect(x, y, cx, cy, w, h, r) {
  const dx = Math.max(Math.abs(x - cx) - (w / 2 - r), 0);
  const dy = Math.max(Math.abs(y - cy) - (h / 2 - r), 0);
  return dx * dx + dy * dy <= r * r;
}
function inCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}
function distToSegment(x, y, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / (vx * vx + vy * vy)));
  const px = x1 + t * vx;
  const py = y1 + t * vy;
  return Math.hypot(x - px, y - py);
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Background gradient (diagonal): #5b8dff -> #2653b8
function bgColor(x, y) {
  const t = (x + y) / (W + H);
  return [Math.round(lerp(0x5b, 0x26, t)), Math.round(lerp(0x8d, 0x53, t)), Math.round(lerp(0xff, 0xb8, t))];
}

// Layered color decision for one sample point.
function colorAt(x, y) {
  // Canvas: rounded square
  if (!inRoundRect(x, y, 128, 128, 256, 256, 56)) return [0, 0, 0, 0];

  // Green badge with white check (bottom-right of the phone)
  if (inCircle(x, y, 190, 194, 30)) {
    const onCheck =
      distToSegment(x, y, 177, 194, 186, 203) <= 4.5 || distToSegment(x, y, 186, 203, 203, 184) <= 4.5;
    return onCheck ? [255, 255, 255, 255] : [0x2e, 0xa0, 0x43, 255];
  }

  // Phone body: white stroke (outer round-rect minus inner)
  const outer = inRoundRect(x, y, 120, 128, 118, 188, 26);
  const inner = inRoundRect(x, y, 120, 128, 96, 166, 16);
  if (outer && !inner) return [255, 255, 255, 255];

  if (inner) {
    // Chat bubble with three dots
    if (inRoundRect(x, y, 120, 116, 62, 42, 12)) {
      const [r, g, b] = bgColor(x, y);
      if (inCircle(x, y, 104, 116, 5) || inCircle(x, y, 120, 116, 5) || inCircle(x, y, 136, 116, 5)) {
        return [r, g, b, 255];
      }
      return [255, 255, 255, 255];
    }
    // Home indicator
    if (inRoundRect(x, y, 120, 196, 34, 6, 3)) return [255, 255, 255, 255];
    const [r, g, b] = bgColor(x, y);
    return [r, g, b, 255];
  }

  const [r, g, b] = bgColor(x, y);
  return [r, g, b, 255];
}

// ---------------------------------------------------------------------------
// Render with supersampling
// ---------------------------------------------------------------------------
const px = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = colorAt(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        r += c[0] * (c[3] / 255);
        g += c[1] * (c[3] / 255);
        b += c[2] * (c[3] / 255);
        a += c[3];
      }
    }
    const n = SS * SS;
    const alpha = a / n;
    const i = (y * W + x) * 4;
    // un-premultiply
    const k = alpha > 0 ? 255 / alpha : 0;
    px[i] = Math.min(255, Math.round((r / n) * k));
    px[i + 1] = Math.min(255, Math.round((g / n) * k));
    px[i + 2] = Math.min(255, Math.round((b / n) * k));
    px[i + 3] = Math.round(alpha);
  }
}

// ---------------------------------------------------------------------------
// PNG encoding (IHDR + IDAT + IEND)
// ---------------------------------------------------------------------------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0; // filter: none
  px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'extension', 'media', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes)`);
