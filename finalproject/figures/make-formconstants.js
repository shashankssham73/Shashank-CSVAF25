#!/usr/bin/env node
'use strict';
/*
 * Generates the representative figure: Kluver's four form constants, all produced
 * by the SAME generator -- a plain sinusoidal grating in log-polar (cortical)
 * coordinates -- differing only in the stripe orientation (k1, k2).
 *
 * This is the core claim of the project rendered as an image:
 *   screen (r, theta)  ->  cortex (log r, theta)
 * A straight grating in cortex is a ring, a ray, or a spiral on screen.
 *
 *   node figures/make-formconstants.js
 *
 * Zero dependencies: writes the PNG by hand using Node's built-in zlib.
 */
const fs = require('fs');
const zlib = require('zlib');

const PANEL = 420, GRID = 2, SIZE = PANEL * GRID;

// --- minimal PNG writer -------------------------------------------------
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c; }
  return t;
})();
const crc32 = buf => { let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0; };

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function writePNG(path, w, h, rgb) {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;                       // filter: none
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;  // 8-bit RGB
  fs.writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// --- cosine palette (Inigo Quilez) --------------------------------------
const pal = (t, a, b, c, d) => [
  a[0] + b[0] * Math.cos(6.28318 * (c[0] * t + d[0])),
  a[1] + b[1] * Math.cos(6.28318 * (c[1] * t + d[1])),
  a[2] + b[2] * Math.cos(6.28318 * (c[2] * t + d[2])),
];

// --- the four form constants, as (k1, k2) stripe orientations -----------
// k1 = cycles per unit log-radius, k2 = angular wave number (MUST be an integer
// or the grating tears at theta = +/-pi).
const PANELS = [
  { name: 'II  tunnel / funnel',   k1: 9.0,  k2: 0,  hex: false },
  { name: 'I   rays / fan',        k1: 0.0,  k2: 16, hex: false },
  { name: 'II  spiral',            k1: 7.0,  k2: 11, hex: false },
  { name: 'III lattice / honeycomb', k1: 6.0, k2: 10, hex: true },
];

const img = Buffer.alloc(SIZE * SIZE * 3);

for (let pi = 0; pi < PANELS.length; pi++) {
  const P = PANELS[pi];
  const ox = (pi % GRID) * PANEL, oy = Math.floor(pi / GRID) * PANEL;

  for (let y = 0; y < PANEL; y++) {
    for (let x = 0; x < PANEL; x++) {
      // screen -> normalized [-1,1]
      const px = (x / PANEL - 0.5) * 2, py = (y / PANEL - 0.5) * 2;
      const r = Math.hypot(px, py), a = Math.atan2(py, px);

      // ---- THE TRANSFORM: screen -> cortical (log-polar) coordinates ----
      const u = Math.log(r + 1e-3), v = a;

      // a plain grating in (u, v)
      let s;
      if (!P.hex) {
        s = Math.sin(P.k1 * u + P.k2 * v);
      } else {
        // three gratings at 60 degrees = hexagonal lattice in cortex
        s = 0;
        for (let i = 0; i < 3; i++) {
          const th = (i * Math.PI) / 3;
          s += Math.sin(P.k1 * (u * Math.cos(th)) + P.k2 * v * Math.sin(th) + th);
        }
        s /= 3;
      }

      // contrast + soft edges; fade the foveal singularity and the corners
      s = Math.tanh(s * 2.2) * 0.5 + 0.5;
      const fade = Math.min(1, Math.max(0, (r - 0.045) * 9)) *
                   Math.min(1, Math.max(0, (1.02 - r) * 4.5));
      s *= fade;

      const c = pal(s * 0.85 + pi * 0.11,
                    [0.42, 0.36, 0.40], [0.45, 0.40, 0.42],
                    [1.0, 1.0, 1.0], [0.00, 0.18, 0.42]);

      const o = ((oy + y) * SIZE + (ox + x)) * 3;
      for (let k = 0; k < 3; k++) {
        img[o + k] = Math.max(0, Math.min(255, Math.round(c[k] * 255 * (0.12 + 0.88 * fade))));
      }
    }
  }
}

// thin divider lines between panels
for (let i = 0; i < SIZE; i++) {
  for (const p of [PANEL - 1, PANEL]) {
    let o = (i * SIZE + p) * 3;            img[o] = img[o+1] = img[o+2] = 10;
    o = (p * SIZE + i) * 3;                img[o] = img[o+1] = img[o+2] = 10;
  }
}

writePNG(__dirname + '/form-constants.png', SIZE, SIZE, img);
console.log('wrote figures/form-constants.png  ' + SIZE + 'x' + SIZE);
for (const P of PANELS) console.log('   ' + P.name.padEnd(24) + 'k1=' + P.k1 + '  k2=' + P.k2);
