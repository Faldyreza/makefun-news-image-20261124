// news-image-20261124 v9 — "THE WORLD", Tuesday 24 November 2026.
// Fresh build: software rasteriser + vector stroke font, written from scratch.
// No network at run time. Deterministic: two runs produce byte-identical output.
// Node 22 stdlib only.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import * as crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Canvas: 1024x1024 final, rendered at SS=2 supersampling then box-downsampled.
// ---------------------------------------------------------------------------
const W = 1024;
const H = 1024;
const SS = 2;
const BW = W * SS;
const BH = H * SS;

const buf = new Uint8Array(BW * BH * 3);

function rgb(r: number, g: number, b: number): [number, number, number] {
  return [r, g, b];
}
const PAPER = rgb(247, 243, 232);
const INK = rgb(26, 26, 26);
const INK_SOFT = rgb(74, 70, 60);
const RED = rgb(168, 44, 32);
const SEA = rgb(38, 105, 138);
const SEA_DARK = rgb(24, 78, 106);
const SEA_LIGHT = rgb(120, 172, 196);
const SKY = rgb(214, 228, 233);
const SAND = rgb(216, 200, 158);
const SAND_DARK = rgb(196, 178, 132);
const GREY_MID = rgb(138, 138, 134);
const GREY_LIGHT = rgb(168, 168, 162);
const GREY_DARK = rgb(111, 111, 108);
const GOLD = rgb(214, 164, 60);
const ORANGE = rgb(232, 122, 32);
const YELLOW = rgb(246, 196, 64);
const GREEN = rgb(34, 128, 74);
const NAVY = rgb(28, 52, 96);
const STEEL = rgb(88, 102, 118);
const WHITE = rgb(255, 255, 255);
const DARK_HULL = rgb(30, 38, 48);
const TAN_STRIPE = rgb(214, 188, 138);

function setPx(x: number, y: number, c: [number, number, number]): void {
  if (x < 0 || y < 0 || x >= BW || y >= BH) return;
  const i = (y * BW + x) * 3;
  buf[i] = c[0];
  buf[i + 1] = c[1];
  buf[i + 2] = c[2];
}

// Filled disc (used for thick strokes and dots).
function disc(cx: number, cy: number, r: number, c: [number, number, number]): void {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(BW - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(BH - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) setPx(x, y, c);
    }
  }
}

// Thick line segment: stamps discs along the segment.
function line(x0: number, y0: number, x1: number, y1: number, w: number, c: [number, number, number]): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / (w * 0.4)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(x0 + dx * t, y0 + dy * t, w / 2, c);
  }
}

// Polyline through points.
function polyline(pts: [number, number][], w: number, c: [number, number, number]): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, c);
  }
}

// Filled polygon (even-odd scanline fill).
function fillPoly(pts: [number, number][], c: [number, number, number]): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(BH - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a[1] <= y + 0.5 && b[1] > y + 0.5) || (b[1] <= y + 0.5 && a[1] > y + 0.5)) {
        const t = (y + 0.5 - a[1]) / (b[1] - a[1]);
        xs.push(a[0] + t * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.floor(xs[k]));
      const xb = Math.min(BW - 1, Math.ceil(xs[k + 1]));
      for (let x = xa; x <= xb; x++) setPx(x, y, c);
    }
  }
}

function fillRect(x: number, y: number, w: number, h: number, c: [number, number, number]): void {
  fillPoly(
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    c,
  );
}

// Filled ellipse (axis-aligned), via polygon approximation.
function ellipsePts(cx: number, cy: number, rx: number, ry: number, n: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}
function fillEllipse(cx: number, cy: number, rx: number, ry: number, c: [number, number, number]): void {
  fillPoly(ellipsePts(cx, cy, rx, ry, 40), c);
}
function strokeEllipse(cx: number, cy: number, rx: number, ry: number, w: number, c: [number, number, number]): void {
  const pts = ellipsePts(cx, cy, rx, ry, 40);
  pts.push(pts[0]);
  polyline(pts, w, c);
}

// Quadratic bezier sampled polyline (for wisps and coastline curves).
function quadCurve(p0: [number, number], p1: [number, number], p2: [number, number], n: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ]);
  }
  return pts;
}

// ---------------------------------------------------------------------------
// PNG encoder (deterministic: fixed zlib level, filter 0 rows).
// ---------------------------------------------------------------------------
function crc32(data: Buffer): number {
  let table = (crc32 as unknown as { t?: Int32Array }).t;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    (crc32 as unknown as { t: Int32Array }).t = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, "ascii");
  data.copy(out, 8);
  const crc = crc32(Buffer.concat([Buffer.from(type, "ascii"), data]));
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

function encodePNG(w: number, h: number, px: Uint8Array): Buffer {
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    px.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 6 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Box-downsample SSxSS -> final image.
function downsample(): Uint8Array {
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * BW + (x * SS + dx)) * 3;
          r += buf[i];
          g += buf[i + 1];
          b += buf[i + 2];
        }
      }
      const o = (y * W + x) * 3;
      const n = SS * SS;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Vector stroke font (own design).
// Grid: cell 7 units wide; cap height 10 units (y 0..10, baseline y=10);
// x-height letters live at y 3..10; descenders reach y 13.
// A stroke is a list of [x, y] points in grid units.
// ---------------------------------------------------------------------------
type Stroke = [number, number][];
type Glyph = Stroke[];

function ellStroke(cx: number, cy: number, rx: number, ry: number, n = 16): Stroke {
  const pts: Stroke = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

const FONT_UPPER: Record<string, Glyph> = {
  // A: two legs + crossbar + bottom serif ticks.
  A: [
    [[0.6, 10], [3.5, 0], [6.4, 10]],
    [[1.9, 6.6], [5.1, 6.6]],
    [[0.1, 10], [1.2, 10]],
    [[5.8, 10], [6.9, 10]],
  ],
  B: [
    [[1.1, 0], [1.1, 10]],
    [[1.1, 0], [4.8, 0], [6.1, 2.2], [4.9, 4.9], [1.1, 4.9]],
    [[1.1, 4.9], [5.1, 4.9], [6.4, 7.3], [5, 10], [1.1, 10]],
    [[0.6, 10], [1.7, 10]],
  ],
  C: [
    [[6.1, 1.6], [4.6, 0.2], [2.1, 0.6], [0.8, 3], [0.8, 7], [2.1, 9.4], [4.6, 9.8], [6.1, 8.4]],
  ],
  D: [
    [[1.1, 0], [1.1, 10]],
    [[1.1, 0], [4.4, 0], [6.4, 2.6], [6.4, 7.4], [4.4, 10], [1.1, 10]],
    [[0.6, 10], [1.7, 10]],
  ],
  E: [
    [[1.1, 0], [1.1, 10]],
    [[1.1, 0], [6.1, 0]],
    [[1.1, 5], [4.6, 5]],
    [[1.1, 10], [6.1, 10]],
    [[0.6, 10], [1.7, 10]],
  ],
  F: [
    [[1.1, 0], [1.1, 10]],
    [[1.1, 0], [6.1, 0]],
    [[1.1, 5], [4.6, 5]],
    [[0.6, 10], [1.7, 10]],
  ],
  G: [
    [[6.1, 1.6], [4.6, 0.2], [2.1, 0.6], [0.8, 3], [0.8, 7], [2.1, 9.4], [4.6, 9.8], [6, 8.6]],
    [[4.2, 5], [6.3, 5], [6.3, 7.6], [5.2, 9.4]],
  ],
  H: [
    [[1.1, 0], [1.1, 10]],
    [[5.9, 0], [5.9, 10]],
    [[1.1, 5], [5.9, 5]],
    [[0.6, 10], [1.7, 10]],
    [[5.3, 10], [6.4, 10]],
  ],
  I: [
    [[3.5, 0], [3.5, 10]],
    [[1.6, 0], [5.4, 0]],
    [[1.6, 10], [5.4, 10]],
  ],
  J: [
    [[5.2, 0], [5.2, 7.6], [4.2, 9.8], [2.2, 10], [1, 8.6]],
    [[3.2, 0], [6.6, 0]],
  ],
  K: [
    [[1.1, 0], [1.1, 10]],
    [[5.8, 0], [1.7, 5.4]],
    [[3.1, 4.6], [6.2, 10]],
    [[0.6, 10], [1.7, 10]],
  ],
  L: [
    [[1.1, 0], [1.1, 10]],
    [[1.1, 10], [6.1, 10]],
    [[0.6, 10], [1.7, 10]],
  ],
  M: [
    [[1, 10], [1, 0], [3.5, 6.8], [6, 0], [6, 10]],
    [[0.5, 10], [1.6, 10]],
    [[5.4, 10], [6.5, 10]],
  ],
  N: [
    [[1, 10], [1, 0], [6, 10], [6, 0]],
    [[0.5, 10], [1.6, 10]],
    [[5.4, 10], [6.5, 10]],
  ],
  // O: smooth 16-point ellipse — v9 fix (v8's O read octagonal).
  O: [ellStroke(3.5, 5, 3.1, 5)],
  P: [
    [[1.1, 0], [1.1, 10]],
    [[1.1, 0], [4.9, 0], [6.3, 2.1], [5, 5], [1.1, 5]],
    [[0.6, 10], [1.7, 10]],
  ],
  Q: [
    ellStroke(3.5, 5, 3.1, 5),
    [[4.4, 7.6], [6.6, 10.8]],
  ],
  R: [
    [[1.1, 0], [1.1, 10]],
    [[1.1, 0], [4.9, 0], [6.3, 2.1], [5, 5], [1.1, 5]],
    [[3.6, 5], [6.4, 10]],
    [[0.6, 10], [1.7, 10]],
  ],
  S: [
    [[6, 1.9], [4.6, 0.3], [2.1, 0.5], [0.8, 2.5], [1.6, 4.6], [3.5, 5.2], [5.4, 6], [6.2, 7.8], [5, 9.7], [2.8, 10], [1, 9.2]],
  ],
  T: [
    [[0.6, 0], [6.4, 0]],
    [[3.5, 0], [3.5, 10]],
    [[2.8, 10], [4.2, 10]],
  ],
  U: [
    [[1.1, 0], [1.1, 7.2], [2.4, 9.8], [4.6, 9.8], [5.9, 7.2], [5.9, 0]],
  ],
  V: [
    [[0.8, 0], [3.5, 10], [6.2, 0]],
  ],
  // W: middle vertex HIGH (y 3.2) so it reads as a proper W, not two Vs;
  // top serif ticks on the outer stems — v9 fix (v8's W clumped at centre).
  W: [
    [[0.5, 0], [2, 10], [3.5, 3.2], [5, 10], [6.5, 0]],
    [[0, 0], [1, 0]],
    [[6, 0], [7, 0]],
  ],
  X: [
    [[1, 0], [6, 10]],
    [[6, 0], [1, 10]],
  ],
  Y: [
    [[1, 0], [3.5, 5], [6, 0]],
    [[3.5, 5], [3.5, 10]],
    [[2.8, 10], [4.2, 10]],
  ],
  Z: [
    [[1, 0], [6, 0]],
    [[6, 0], [1, 10]],
    [[1, 10], [6, 10]],
  ],
};

const FONT_LOWER: Record<string, Glyph> = {
  a: [
    [ellStroke(3.6, 6.6, 2.3, 3.3)],
    [[6, 3.2], [6, 10]],
    [[5.5, 10], [6.5, 10]],
  ],
  b: [
    [[1.1, 0], [1.1, 10]],
    [ellStroke(3.9, 6.7, 2.2, 3.1)],
    [[0.6, 10], [1.7, 10]],
  ],
  c: [
    [[6, 4.6], [4.6, 3.2], [2.2, 3.5], [1, 5.6], [1.8, 8.2], [3.6, 9.6], [5.6, 9.3]],
  ],
  d: [
    [ellStroke(3.1, 6.7, 2.2, 3.1)],
    [[6, 0], [6, 10]],
    [[5.5, 10], [6.5, 10]],
  ],
  e: [
    [[5.8, 6.6], [4.6, 3.5], [2.1, 3.8], [0.9, 6], [1.5, 9], [3.5, 9.8], [5.5, 9]],
    [[1.1, 6.6], [5.6, 6.6]],
  ],
  f: [
    [[5.4, 2.2], [4, 0.6], [2.6, 1.2], [2.6, 3.2]],
    [[2.6, 1.2], [2.6, 10]],
    [[1.6, 4.2], [4.6, 4.2]],
    [[2.1, 10], [3.2, 10]],
  ],
  g: [
    [ellStroke(3.5, 6.5, 2.3, 3.2)],
    [[6, 3.2], [6, 10], [5, 12.6], [3, 13], [1.8, 12]],
  ],
  h: [
    [[1.1, 0], [1.1, 10]],
    [[1.1, 6.4], [2.6, 3.2], [5, 3.4], [6, 5], [6, 10]],
    [[0.6, 10], [1.7, 10]],
  ],
  i: [
    [[3.5, 3.6], [3.5, 10]],
    [[3.5, 1.2], [3.5, 1.4]],
    [[3, 10], [4, 10]],
  ],
  j: [
    [[4.6, 3.6], [4.6, 10], [3.9, 12.6], [2.6, 13]],
    [[4.6, 1.2], [4.6, 1.4]],
  ],
  k: [
    [[1.1, 0], [1.1, 10]],
    [[5.6, 3.4], [2, 6]],
    [[3.2, 5.6], [5.9, 10]],
    [[0.6, 10], [1.7, 10]],
  ],
  l: [
    [[3.5, 0], [3.5, 10]],
    [[3, 10], [4.2, 10]],
  ],
  m: [
    [[1, 3.6], [1, 10]],
    [[1, 3.6], [2, 3], [3.5, 4.4], [3.5, 10]],
    [[3.5, 3.6], [4.5, 3], [6, 4.4], [6, 10]],
  ],
  n: [
    [[1, 3.6], [1, 10]],
    [[1, 3.6], [2.5, 3], [5, 3.4], [6, 5], [6, 10]],
  ],
  o: [ellStroke(3.5, 6.6, 2.6, 3.4)],
  p: [
    [[1.1, 3.6], [1.1, 13]],
    [ellStroke(3.9, 6.8, 2.2, 3.1)],
  ],
  q: [
    [ellStroke(3.1, 6.8, 2.2, 3.1)],
    [[6, 3.6], [6, 13]],
  ],
  r: [
    [[1.1, 3.6], [1.1, 10]],
    [[1.1, 4.2], [2.6, 3], [4.6, 3.4], [5.6, 5]],
  ],
  // s — v9 strengthened: deep lower bowl with an inward terminal flick,
  // pronounced waist and curled top hook, so it cannot read as 'c' at 300 px.
  s: [
    [[5.6, 4.1], [4.6, 2.9], [3.2, 2.8], [1.8, 3.4], [1.4, 4.6], [2.4, 5.7], [3.6, 6.1]],
    [[3.6, 6.1], [5.2, 6.6], [6.1, 8], [5.4, 9.8], [3.4, 10.3], [1.6, 9.6], [1.1, 8.4], [1.9, 8]],
  ],
  t: [
    [[3.5, 0.6], [3.5, 9.4], [4.4, 10], [5.4, 9.8]],
    [[1.8, 4], [5.2, 4]],
  ],
  u: [
    [[1, 3.6], [1, 8], [2.5, 9.8], [4.5, 9.8], [6, 8], [6, 3.6]],
  ],
  v: [
    [[0.8, 3.6], [3.5, 10], [6.2, 3.6]],
  ],
  w: [
    [[0.5, 3.6], [1.8, 10], [3.5, 5.6], [5.2, 10], [6.5, 3.6]],
  ],
  x: [
    [[1, 3.6], [6, 10]],
    [[6, 3.6], [1, 10]],
  ],
  y: [
    [[1, 3.6], [3.5, 9.6], [6, 3.6]],
    [[3.5, 9.6], [3, 12.6], [1.8, 13]],
  ],
  z: [
    [[1, 3.6], [6, 3.6]],
    [[6, 3.6], [1, 10]],
    [[1, 10], [6, 10]],
  ],
};

const FONT_DIGIT: Record<string, Glyph> = {
  "0": [ellStroke(3.5, 5, 3, 5)],
  "1": [
    [[2, 2], [3.5, 0.4]],
    [[3.5, 0.4], [3.5, 10]],
    [[2, 10], [5, 10]],
  ],
  "2": [
    [[1.5, 2.6], [3, 0.3], [5.5, 0.8], [6, 2.8], [4, 5.6], [1.5, 10], [6, 10]],
  ],
  "3": [
    [[1.5, 1.5], [3, 0], [5.5, 0.5], [6.2, 2.5], [4.5, 4.8], [3.5, 5]],
    [[3.5, 5], [5, 5.5], [6.2, 7.5], [5, 9.8], [3, 10], [1.5, 9]],
  ],
  "4": [
    [[4.8, 0], [1, 7]],
    [[1, 7], [5.8, 7]],
    [[5, 0], [5, 10]],
  ],
  "5": [
    [[6, 0], [1.5, 0], [1.5, 4.4]],
    [[1.5, 4.4], [4, 4.4], [6, 6], [5.5, 9], [3.5, 10], [1.5, 9]],
  ],
  "6": [
    [[5.5, 1.5], [3.5, 0.5], [1.5, 2.5], [1, 5.5], [1.8, 8.5], [3.5, 10], [5.5, 9], [6, 7], [5, 5], [3.5, 4.8]],
  ],
  "7": [
    [[1, 0], [6, 0]],
    [[6, 0], [2.5, 10]],
  ],
  // 8: two closed stacked loops (never a pinched single line).
  "8": [ellStroke(3.5, 2.9, 2.3, 2.7), ellStroke(3.5, 7.4, 2.7, 2.8)],
  "9": [
    [ellStroke(3.5, 3.4, 2.5, 3.1)],
    [[6, 3.4], [6, 8], [5, 10], [3.5, 10.2]],
  ],
};

const FONT_PUNCT: Record<string, Glyph> = {
  ".": [[[3.5, 9.4], [3.5, 9.6]]],
  ",": [
    [[3.5, 9.4], [3.5, 9.6]],
    [[3.5, 10], [2.8, 12.2]],
  ],
  ";": [
    [[3.5, 3.8], [3.5, 4]],
    [[3.5, 9.4], [3.5, 9.6]],
    [[3.5, 10], [2.8, 12.2]],
  ],
  ":": [
    [[3.5, 3.8], [3.5, 4]],
    [[3.5, 9.4], [3.5, 9.6]],
  ],
  "'": [[[4.6, 0.4], [3.6, 2.6]]],
  '"': [
    [[2.6, 0.4], [1.8, 2.6]],
    [[5.2, 0.4], [4.4, 2.6]],
  ],
  "%": [
    [ellStroke(2, 2.4, 1.5, 1.9)],
    [ellStroke(5, 7.6, 1.5, 1.9)],
    [[6.2, 0.4], [0.8, 9.6]],
  ],
  "+": [
    [[3.5, 2], [3.5, 8]],
    [[1, 5], [6, 5]],
  ],
  "/": [[[5.6, 0], [1.4, 10]]],
  // &: upper loop + diagonal sweep + lower tail — drawn to read as &,
  // not as a small loop (v6 weakness) or a plain 8.
  "&": [
    [[5.4, 3.4], [4.4, 1.4], [2.6, 1.2], [1.4, 2.8], [1.8, 4.8], [3.4, 5.4], [4.8, 4.6]],
    [[5.8, 1.2], [1.2, 10.2]],
    [[1.2, 10.2], [2.8, 10.6], [5.2, 9.4], [5.8, 7.4]],
  ],
  $: [
    [[6, 1.9], [4.6, 0.3], [2.1, 0.5], [0.8, 2.5], [1.6, 4.6], [3.5, 5.2], [5.4, 6], [6.2, 7.8], [5, 9.7], [2.8, 10], [1, 9.2]],
    [[3.5, -1], [3.5, 11]],
  ],
  "-": [[[1, 5], [6, 5]]],
  "·": [[[3.5, 4.4], [3.5, 4.6]]],
  "!": [
    [[3.5, 0], [3.5, 7]],
    [[3.5, 9.4], [3.5, 9.6]],
  ],
  "?": [
    [[2, 2.6], [3.5, 0.8], [5.5, 1.6], [5.5, 3.6], [4, 5.6], [3.5, 7]],
    [[3.5, 9.4], [3.5, 9.6]],
  ],
  "(": [[[5, 0], [3, 2.5], [3, 7.5], [5, 10]]],
  ")": [[[2, 0], [4, 2.5], [4, 7.5], [2, 10]]],
  "•": [[[3.5, 4.8], [3.5, 5]]],
};

function glyphFor(ch: string): Glyph | null {
  if (ch === " ") return [];
  if (ch >= "A" && ch <= "Z") return FONT_UPPER[ch];
  if (ch >= "a" && ch <= "z") return FONT_LOWER[ch];
  if (ch >= "0" && ch <= "9") return FONT_DIGIT[ch];
  return FONT_PUNCT[ch] ?? null;
}

// ---------------------------------------------------------------------------
// Text engine. size = cap height in final-page px. xs = horizontal squeeze.
// All coordinates are final-page px; the buffer is SSx, so scale by SS.
// ---------------------------------------------------------------------------
const ADV = 7; // glyph advance, grid units
const SPACE_ADV = 3.6;

function textWidth(s: string, size: number, xs: number): number {
  const u = size / 10;
  let w = 0;
  for (const ch of s) {
    w += (ch === " " ? SPACE_ADV : ADV) * u * xs;
  }
  return w;
}

// Greedy word wrap into lines no wider than maxW; returns lines.
function wrapText(s: string, size: number, xs: number, maxW: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur === "" ? w : cur + " " + w;
    if (textWidth(trial, size, xs) <= maxW || cur === "") {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

// Balance a long string across exactly n lines by trying splits at word gaps.
function wrapBalanced(s: string, size: number, xs: number, maxW: number, n: number): string[] {
  const words = s.split(" ");
  if (n <= 1 || words.length <= n) return wrapText(s, size, xs, maxW);
  // Dynamic search: choose split points minimising the widest line.
  let best: string[] | null = null;
  let bestW = Infinity;
  const rec = (start: number, left: number, acc: string[]): void => {
    if (left === 1) {
      const line = words.slice(start).join(" ");
      if (textWidth(line, size, xs) > maxW) return;
      const cand = [...acc, line];
      const w = Math.max(...cand.map((l) => textWidth(l, size, xs)));
      if (w < bestW) {
        bestW = w;
        best = cand;
      }
      return;
    }
    for (let end = start + 1; end <= words.length - (left - 1); end++) {
      const line = words.slice(start, end).join(" ");
      if (textWidth(line, size, xs) > maxW) break;
      rec(end, left - 1, [...acc, line]);
    }
  };
  rec(0, n, []);
  return best ?? wrapText(s, size, xs, maxW);
}

function drawGlyph(ch: string, x: number, y: number, size: number, xs: number, c: [number, number, number]): void {
  const g = glyphFor(ch);
  if (!g || g.length === 0) return;
  const u = (size / 10) * SS;
  const sw = Math.max(SS * 1.5, 1.55 * u);
  for (const st of g) {
    const pts: [number, number][] = st.map(([gx, gy]) => [ (x + gx * xs * (size / 10)) * SS, (y + gy * (size / 10)) * SS ]);
    if (pts.length === 1) {
      disc(pts[0][0], pts[0][1], sw * 0.62, c);
    } else {
      polyline(pts, sw, c);
    }
  }
}

// Draw text starting at (x, y) — y is the cap top. Returns width drawn.
function drawText(s: string, x: number, y: number, size: number, xs: number, c: [number, number, number]): number {
  const u = size / 10;
  let cx = x;
  for (const ch of s) {
    if (ch !== " ") drawGlyph(ch, cx, y, size, xs, c);
    cx += (ch === " " ? SPACE_ADV : ADV) * u * xs;
  }
  return cx - x;
}

function drawTextCentered(s: string, cx: number, y: number, size: number, xs: number, c: [number, number, number]): void {
  const w = textWidth(s, size, xs);
  drawText(s, cx - w / 2, y, size, xs, c);
}

function drawTextRight(s: string, xRight: number, y: number, size: number, xs: number, c: [number, number, number]): void {
  drawText(s, xRight - textWidth(s, size, xs), y, size, xs, c);
}

// Draw a wrapped block; returns the y after the last line.
function drawBlock(s: string, x: number, y: number, size: number, xs: number, maxW: number, lh: number, c: [number, number, number], lines?: number): number {
  const ls = lines !== undefined ? wrapBalanced(s, size, xs, maxW, lines) : wrapText(s, size, xs, maxW);
  let cy = y;
  for (const l of ls) {
    drawText(l, x, cy, size, xs, c);
    cy += lh;
  }
  return cy;
}

function rule(x0: number, x1: number, y: number, w: number, c: [number, number, number]): void {
  line(x0 * SS, y * SS, x1 * SS, y * SS, w * SS, c);
}

// ---------------------------------------------------------------------------
// Page layout (1024x1024). Content x 30..994.
// ---------------------------------------------------------------------------
const MX = 30;
const RX = 994;
const CW = RX - MX; // 964

// A tanker: deck at (x, deckY), length len. Bow points right.
function drawTanker(x: number, deckY: number, len: number, burning: boolean): void {
  const S = SS;
  const hullH = 26;
  const hull: [number, number][] = [
    [x, deckY + 4],
    [x + len - 20, deckY + 4],
    [x + len, deckY + 12],
    [x + len - 12, deckY + hullH],
    [x, deckY + hullH],
  ].map(([px, py]) => [px * S, py * S] as [number, number]);
  fillPoly(hull, DARK_HULL);
  // tan stripe along the hull
  const stripe: [number, number][] = [
    [x + 2, deckY + 12],
    [x + len - 16, deckY + 12],
    [x + len - 13, deckY + 17],
    [x + 2, deckY + 17],
  ].map(([px, py]) => [px * S, py * S] as [number, number]);
  fillPoly(stripe, TAN_STRIPE);
  // deck containers
  fillRect((x + 8) * S, (deckY - 8) * S, (len * 0.45) * S, 8 * S, STEEL);
  fillRect((x + len * 0.55) * S, (deckY - 6) * S, (len * 0.2) * S, 6 * S, rgb(120, 128, 138));
  // red funnel
  fillRect((x + len * 0.32) * S, (deckY - 22) * S, 10 * S, 14 * S, RED);
  // white bridge tower near the bow
  fillRect((x + len - 34) * S, (deckY - 26) * S, 14 * S, 26 * S, WHITE);
  fillRect((x + len - 34) * S, (deckY - 26) * S, 14 * S, 4 * S, NAVY);
  // wake
  line((x - 26) * S, (deckY + hullH + 4) * S, (x + 8) * S, (deckY + hullH + 4) * S, 1.6 * S, SEA_LIGHT);
  line((x + len * 0.3) * S, (deckY + hullH + 9) * S, (x + len * 0.7) * S, (deckY + hullH + 9) * S, 1.6 * S, SEA_LIGHT);
  if (burning) {
    // flames at the bow: layered teardrops, clearly visible, clear of the plume.
    const fx = x + len - 8;
    const fy = deckY - 2;
    fillPoly(
      [
        [fx - 12, fy],
        [fx - 4, fy - 22],
        [fx + 2, fy - 8],
        [fx + 10, fy - 18],
        [fx + 12, fy],
      ].map(([px, py]) => [px * S, py * S] as [number, number]),
      ORANGE,
    );
    fillPoly(
      [
        [fx - 6, fy],
        [fx - 1, fy - 13],
        [fx + 5, fy - 5],
        [fx + 7, fy],
      ].map(([px, py]) => [px * S, py * S] as [number, number]),
      YELLOW,
    );
    // small deck fire mid-ship
    fillPoly(
      [
        [x + len * 0.5 - 7, deckY],
        [x + len * 0.5, deckY - 12],
        [x + len * 0.5 + 7, deckY],
      ].map(([px, py]) => [px * S, py * S] as [number, number]),
      ORANGE,
    );
  }
}

// Sea mine: spiky circle.
function drawMine(cx: number, cy: number, r: number): void {
  const S = SS;
  disc(cx * S, cy * S, r * S, INK);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    line(
      (cx + Math.cos(a) * r * 0.7) * S,
      (cy + Math.sin(a) * r * 0.7) * S,
      (cx + Math.cos(a) * (r + 5)) * S,
      (cy + Math.sin(a) * (r + 5)) * S,
      2.2 * S,
      INK,
    );
  }
  disc(cx * S, cy * S, r * 0.45 * S, rgb(70, 70, 70));
}

// Plume — v9 natural: strongly varied puff sizes, heavy overlap so the
// silhouette is irregular (never a row of equal circles), soft wash behind,
// and thin curling wisps that rise clear of the flames.
function drawPlume(bx: number, by: number): void {
  const S = SS;
  // soft wash behind the whole plume
  fillEllipse((bx - 52) * S, (by - 46) * S, 74 * S, 52 * S, rgb(196, 196, 190));
  // puffs: [dx, dy, rx, ry, tone] — jittered, varied, overlapping
  const puffs: [number, number, number, number, [number, number, number]][] = [
    [-6, -8, 26, 20, GREY_MID],
    [-34, -20, 20, 15, GREY_LIGHT],
    [16, -22, 22, 17, GREY_DARK],
    [-58, -34, 17, 13, GREY_MID],
    [-18, -38, 24, 18, GREY_LIGHT],
    [6, -44, 18, 14, GREY_MID],
    [-78, -52, 14, 11, GREY_LIGHT],
    [-44, -56, 19, 14, GREY_DARK],
    [-8, -62, 15, 12, GREY_LIGHT],
    [-96, -66, 12, 9, GREY_MID],
    [-62, -76, 13, 10, GREY_LIGHT],
    [-28, -82, 11, 9, GREY_MID],
    [-84, -88, 9, 7, GREY_DARK],
    [-50, -96, 10, 8, GREY_LIGHT],
    [-14, -92, 8, 7, GREY_MID],
  ];
  for (const [dx, dy, rx, ry, tone] of puffs) {
    fillEllipse((bx + dx) * S, (by + dy) * S, rx * S, ry * S, tone);
  }
  // wisps: thin curls rising and drifting left, clearly visible
  const wisps: [[number, number], [number, number], [number, number]][] = [
    [[bx - 30, by - 60], [bx - 66, by - 96], [bx - 108, by - 108]],
    [[bx + 8, by - 52], [bx - 18, by - 92], [bx - 58, by - 118]],
    [[bx - 58, by - 40], [bx - 96, by - 66], [bx - 128, by - 74]],
    [[bx - 12, by - 78], [bx - 40, by - 112], [bx - 30, by - 132]],
    [[bx + 20, by - 30], [bx + 2, by - 66], [bx - 26, by - 84]],
  ];
  for (const [p0, p1, p2] of wisps) {
    const pts = quadCurve(
      [p0[0] * S, p0[1] * S],
      [p1[0] * S, p1[1] * S],
      [p2[0] * S, p2[1] * S],
      16,
    );
    polyline(pts, 2.4 * S, GREY_DARK);
  }
}

function drawLead(): void {
  const S = SS;
  // sky
  fillRect(MX * S, 204 * S, CW * S, 88 * S, SKY);
  // land strips: Iran (left) and Oman (right)
  fillPoly(
    [
      [MX, 204],
      [232, 204],
      [192, 292],
      [MX, 292],
    ].map(([px, py]) => [px * S, py * S] as [number, number]),
    SAND,
  );
  fillPoly(
    [
      [762, 204],
      [RX, 204],
      [RX, 292],
      [812, 292],
    ].map(([px, py]) => [px * S, py * S] as [number, number]),
    SAND,
  );
  drawText("IRAN", 48, 222, 16, 0.85, INK);
  drawText("OMAN", 922, 222, 16, 0.85, INK);
  // jet silhouette + label
  const jx = 836;
  const jy = 238;
  fillPoly(
    [
      [jx, jy],
      [jx + 34, jy + 6],
      [jx, jy + 12],
      [jx + 8, jy + 6],
    ].map(([px, py]) => [px * S, py * S] as [number, number]),
    INK,
  );
  fillPoly(
    [
      [jx + 12, jy + 2],
      [jx + 22, jy - 6],
      [jx + 26, jy + 2],
    ].map(([px, py]) => [px * S, py * S] as [number, number]),
    INK,
  );
  drawTextRight("U.S. AIR ESCORT", 960, 262, 13, 0.8, INK_SOFT);
  // sea
  fillRect(MX * S, 292 * S, CW * S, 148 * S, SEA);
  line(MX * S, 292 * S, RX * S, 292 * S, 2 * S, SEA_DARK);
  // wave lines
  const waves: [number, number, number][] = [
    [120, 372, 150],
    [330, 396, 120],
    [560, 368, 170],
    [820, 392, 130],
    [210, 420, 110],
    [700, 424, 150],
  ];
  for (const [wx, wy, wl] of waves) {
    line(wx * S, wy * S, (wx + wl) * S, wy * S, 1.6 * S, SEA_LIGHT);
  }
  // tankers
  drawTanker(100, 330, 220, false);
  drawTanker(380, 330, 230, true);
  drawTanker(650, 330, 200, false);
  // plume over the middle tanker, rising up-left, clear of the bow flames
  drawPlume(498, 322);
  // mines
  drawMine(300, 404, 9);
  drawMine(648, 414, 9);
  drawMine(792, 400, 9);
  drawMine(884, 418, 9);
  // strait pill
  fillRect(420 * S, 408 * S, 184 * S, 24 * S, WHITE);
  drawTextCentered("STRAIT OF HORMUZ", 512, 412, 15, 0.85, INK);
}

// Masthead + dateline + headline + lead facts.
function drawHeader(): void {
  drawTextCentered("THE WORLD", 512, 16, 92, 1.0, INK);
  rule(MX, RX, 118, 2, INK);
  drawText("TUESDAY, 24 NOVEMBER 2026", MX, 124, 17, 0.85, INK);
  drawTextRight("IN ONE IMAGE", RX, 124, 17, 0.85, INK);
  rule(MX, RX, 146, 1.4, INK);
  drawTextCentered("MINES IN THE STRAIT OF HORMUZ", 512, 154, 46, 0.9, INK);
  drawLead();
  drawBlock("IRGC says three tankers hit by sea mines in the Strait of Hormuz.", MX, 450, 20, 0.72, CW, 26, INK);
  drawBlock("Tankers burning under U.S. air escort; claim not independently verified.", MX, 476, 20, 0.72, CW, 26, INK);
  drawBlock("Qatar mediates in Washington; U.S. sanctions Iran shadow banking, $14.7bn.", MX, 502, 20, 0.72, CW, 26, INK);
}

// ---------------------------------------------------------------------------
// Secondary stories (3 columns, x 30 / 356 / 682, width 312).
// ---------------------------------------------------------------------------
const COLS = [30, 356, 682];
const COLW = 312;

function drawNvidiaPanel(x: number): void {
  const S = SS;
  // chip
  fillRect((x + 16) * S, 596 * S, 120 * S, 64 * S, NAVY);
  for (let i = 0; i < 4; i++) {
    line((x + 2) * S, (606 + i * 14) * S, (x + 16) * S, (606 + i * 14) * S, 2.4 * S, STEEL);
    line((x + 136) * S, (606 + i * 14) * S, (x + 150) * S, (606 + i * 14) * S, 2.4 * S, STEEL);
  }
  drawTextCentered("NVDA", x + 76, 612, 28, 0.85, WHITE);
  // chart: axes + rising line
  line((x + 164) * S, 664 * S, (x + 164) * S, 592 * S, 2 * S, INK_SOFT);
  line((x + 164) * S, 664 * S, (x + 300) * S, 664 * S, 2 * S, INK_SOFT);
  polyline(
    [
      [x + 170, 652],
      [x + 205, 640],
      [x + 240, 646],
      [x + 272, 614],
      [x + 298, 596],
    ].map(([px, py]) => [px * S, py * S] as [number, number]),
    3.2 * S,
    GREEN,
  );
  drawText("+33%", x + 196, 576, 28, 0.9, GREEN);
}

function drawLibyaPanel(x: number): void {
  const S = SS;
  // sea band
  fillRect(x * S, 574 * S, COLW * S, 110 * S, SEA);
  line(x * S, 574 * S, (x + COLW) * S, 574 * S, 2 * S, SEA_DARK);
  line((x + 20) * S, 596 * S, (x + 120) * S, 596 * S, 1.4 * S, SEA_LIGHT);
  line((x + 180) * S, 668 * S, (x + 290) * S, 668 * S, 1.4 * S, SEA_LIGHT);
  // corvette: 292 px hull at the panel's physical limit, 3-band shading
  const hx = x + 10;
  const deckY = 622;
  const hull: [number, number][] = [
    [hx, deckY + 4],
    [hx + 272, deckY + 4],
    [hx + 292, deckY + 12],
    [hx + 280, deckY + 26],
    [hx, deckY + 26],
  ].map(([px, py]) => [px * S, py * S] as [number, number]);
  fillPoly(hull, DARK_HULL);
  // hull bands: mid grey + light sheer line
  fillPoly(
    [
      [hx + 2, deckY + 10],
      [hx + 278, deckY + 10],
      [hx + 282, deckY + 15],
      [hx + 2, deckY + 15],
    ].map(([px, py]) => [px * S, py * S] as [number, number]),
    rgb(74, 84, 96),
  );
  fillPoly(
    [
      [hx + 2, deckY + 18],
      [hx + 284, deckY + 18],
      [hx + 284, deckY + 21],
      [hx + 2, deckY + 21],
    ].map(([px, py]) => [px * S, py * S] as [number, number]),
    rgb(150, 158, 168),
  );
  // superstructure + funnel with gold cap + mast + radar
  fillRect((hx + 96) * S, (deckY - 14) * S, 64 * S, 14 * S, rgb(226, 226, 220));
  fillRect((hx + 176) * S, (deckY - 20) * S, 16 * S, 20 * S, rgb(200, 200, 192));
  fillRect((hx + 176) * S, (deckY - 24) * S, 16 * S, 4 * S, GOLD);
  line((hx + 210) * S, (deckY - 14) * S, (hx + 210) * S, (deckY - 34) * S, 2.4 * S, INK);
  disc((hx + 210) * S, (deckY - 36) * S, 4 * S, INK);
  // turret
  fillRect((hx + 36) * S, (deckY - 8) * S, 26 * S, 8 * S, rgb(90, 98, 110));
  // reflection streak under the waterline
  line((hx + 30) * S, (deckY + 31) * S, (hx + 240) * S, (deckY + 31) * S, 1.6 * S, SEA_LIGHT);
  // small smoke plume above the stern
  fillEllipse((hx + 60) * S, (deckY - 30) * S, 20 * S, 13 * S, GREY_MID);
  fillEllipse((hx + 44) * S, (deckY - 44) * S, 13 * S, 9 * S, GREY_LIGHT);
  fillEllipse((hx + 76) * S, (deckY - 46) * S, 11 * S, 8 * S, GREY_DARK);
  const wisp = quadCurve(
    [hx + 52, deckY - 46].map((v) => v * S) as [number, number],
    [hx + 30, deckY - 66].map((v) => v * S) as [number, number],
    [hx + 12, deckY - 70].map((v) => v * S) as [number, number],
    12,
  );
  polyline(wisp, 2 * S, GREY_DARK);
  // sea drone (52 px) + dotted path
  const dx = x + 240;
  const dy = 668;
  fillPoly(
    [
      [dx, dy],
      [dx + 52, dy],
      [dx + 46, dy + 8],
      [dx + 6, dy + 8],
    ].map(([px, py]) => [px * S, py * S] as [number, number]),
    INK,
  );
  fillRect((dx + 20) * S, (dy - 6) * S, 12 * S, 6 * S, INK);
  for (let i = 0; i < 7; i++) {
    disc((dx - 14 - i * 16) * S, (dy + 4) * S, 1.8 * S, WHITE);
  }
}

function drawEstoniaPanel(x: number): void {
  const S = SS;
  // schematic mini map
  fillRect((x + 14) * S, 578 * S, 200 * S, 64 * S, WHITE);
  line((x + 14) * S, 578 * S, (x + 214) * S, 578 * S, 2 * S, INK);
  line((x + 14) * S, 642 * S, (x + 214) * S, 642 * S, 2 * S, INK);
  line((x + 14) * S, 578 * S, (x + 14) * S, 642 * S, 2 * S, INK);
  line((x + 214) * S, 578 * S, (x + 214) * S, 642 * S, 2 * S, INK);
  // coastline curve
  const coast = quadCurve(
    [x + 14, 628].map((v) => v * S) as [number, number],
    [x + 110, 606].map((v) => v * S) as [number, number],
    [x + 214, 618].map((v) => v * S) as [number, number],
    20,
  );
  polyline(coast, 2.2 * S, SEA);
  // dashed red border
  for (let i = 0; i < 9; i++) {
    const bx = x + 24 + i * 20;
    line(bx * S, 590 * S, (bx + 12) * S, 592 * S, 2.4 * S, RED);
  }
  // Tallinn dot + label
  disc((x + 128) * S, 612 * S, 4 * S, RED);
  drawText("TALLINN", x + 138, 604, 12, 0.8, INK);
  // 1 DEC tag
  fillRect((x + 92) * S, 622 * S, 46 * S, 16 * S, RED);
  drawText("1 DEC", x + 98, 625, 12, 0.85, WHITE);
  // barrier: striped bar + pole + warning triangle
  for (let i = 0; i < 8; i++) {
    fillRect((x + 8 + i * 38) * S, 650 * S, 19 * S, 10 * S, i % 2 === 0 ? RED : WHITE);
  }
  line((x + 8) * S, 650 * S, (x + 312) * S, 650 * S, 1.6 * S, INK);
  line((x + 8) * S, 660 * S, (x + 312) * S, 660 * S, 1.6 * S, INK);
  // pole
  line((x + 296) * S, 640 * S, (x + 296) * S, 682 * S, 3 * S, INK);
  // warning triangle
  fillPoly(
    [
      [x + 282, 640],
      [x + 296, 616],
      [x + 310, 640],
    ].map(([px, py]) => [px * S, py * S] as [number, number]),
    YELLOW,
  );
  line((x + 282) * S, 640 * S, (x + 296) * S, 616 * S, 2 * S, INK);
  line((x + 296) * S, 616 * S, (x + 310) * S, 640 * S, 2 * S, INK);
  line((x + 282) * S, 640 * S, (x + 310) * S, 640 * S, 2 * S, INK);
  drawText("!", x + 293, 622, 14, 0.8, INK);
  // labels strip
  fillRect(x * S, 664 * S, COLW * S, 20 * S, rgb(212, 210, 202));
  drawText("ESTONIA", x + 10, 668, 15, 0.85, INK);
  drawTextRight("RUSSIA", x + COLW - 10, 668, 15, 0.85, INK);
}

function drawSecondary(): void {
  rule(MX, RX, 540, 2, INK);
  drawText("TECHNOLOGY", COLS[0], 548, 17, 0.85, RED);
  drawText("LIBYA", COLS[1], 548, 17, 0.85, RED);
  drawText("ESTONIA", COLS[2], 548, 17, 0.85, RED);
  drawNvidiaPanel(COLS[0]);
  drawLibyaPanel(COLS[1]);
  drawEstoniaPanel(COLS[2]);
  // headlines (2 lines each)
  drawBlock("HUANG RETURNS AS NVIDIA CEO", COLS[0], 690, 24, 0.88, COLW, 27, INK, 2);
  drawBlock("SEA DRONES SINK RUSSIAN CORVETTE", COLS[1], 690, 24, 0.88, COLW, 27, INK, 2);
  drawBlock("RUSSIA WARNS ESTONIA OVER BORDER CLOSURE", COLS[2], 690, 24, 0.88, COLW, 27, INK, 2);
  // facts (2 lines each; Libya keeps "corvette", Estonia keeps "Tallinn")
  drawBlock("Huang returns 11 days after exit; shares +33%, Nasdaq +6%, S&P +4%.", COLS[0], 750, 16, 0.68, COLW, 23, INK, 2);
  drawBlock("Seven drones sank corvette Merkury off Benghazi; MV Angara hit, Ka-27 destroyed.", COLS[1], 750, 16, 0.68, COLW, 23, INK, 2);
  drawBlock("Tallinn shuts border 1 Dec; Moscow: 'on the verge of triggering open war'.", COLS[2], 750, 16, 0.68, COLW, 23, INK, 2);
}

// ---------------------------------------------------------------------------
// IN BRIEF + credit.
// ---------------------------------------------------------------------------
function drawBrief(label: string, text: string, x: number, y: number, maxW: number): void {
  const size = 15;
  const xs = 0.72;
  const lh = 19;
  const labelW = textWidth(label + " ", size, xs);
  // first line fits into the space after the label; the rest uses full width
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  let first = true;
  for (const w of words) {
    const avail = first ? maxW - labelW : maxW;
    const trial = cur === "" ? w : cur + " " + w;
    if (textWidth(trial, size, xs) <= avail || cur === "") {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
      first = false;
    }
  }
  if (cur !== "") lines.push(cur);
  let cy = y;
  lines.forEach((l, i) => {
    if (i === 0) {
      drawText(label + " ", x, cy, size, xs, RED);
      drawText(l, x + labelW, cy, size, xs, INK);
    } else {
      drawText(l, x, cy, size, xs, INK);
    }
    cy += lh;
  });
}

function drawFooter(): void {
  rule(MX, RX, 812, 2, INK);
  drawText("IN BRIEF", MX, 820, 19, 0.85, INK);
  const bw = 470;
  drawBrief("GAZA —", "Israeli strikes kill at least 3, including UNRWA worker in Jabalia.", MX, 848, bw);
  drawBrief("MEGASPEED —", "U.S. blacklists seven firms in Nvidia spy case.", MX, 890, bw);
  drawBrief("S. KOREA —", "Russian aircraft enter air defence zone; jets scrambled.", MX, 932, bw);
  drawBrief("INDONESIA —", "26 body bags identified, 28 still missing after Banten candy factory fire.", 524, 848, bw);
  drawBrief("ZELENSKY —", "Urges four-party Russia-U.S.-Europe talks 'as soon as possible'.", 524, 890, bw);
  drawBrief("BANGLADESH —", "Mass typhoid vaccination of 50 million children begins.", 524, 932, bw);
  drawTextCentered("Sources: Reuters · The Times · Le Monde · AFP · UN News · TRENDS MENA", 512, 986, 13, 0.8, INK_SOFT);
}

// ---------------------------------------------------------------------------
// Dossier (full facts + sources; same facts as v1–v8, 24 Nov 2026).
// ---------------------------------------------------------------------------
const DOSSIER = {
  title: "THE WORLD — Tuesday, 24 November 2026",
  competition: "news-image-20261124",
  edition: "v9",
  lead: {
    headline: "MINES IN THE STRAIT OF HORMUZ",
    facts: [
      "IRGC says three tankers hit by sea mines in the Strait of Hormuz, burning, while sailing under U.S. air escort; the claim is not independently verified.",
      "Tankers burning under U.S. air escort; claim not independently verified.",
      "Qatar's prime minister met VP Vance and Secretary Rubio in Washington to mediate; Qatar says the region could not withstand another escalation.",
      "U.S. Treasury sanctioned 22 firms and 8 people linked to Iranian shadow banking, $14.7bn in suspicious transactions; JMIC threat level severe.",
    ],
    sources: ["TRENDS MENA, 2026-11-24T03:37:47Z", "Dubai Standard", "AJVC sitrep, 24 Nov 02:31 UTC", "Reuters"],
  },
  secondary: [
    {
      kicker: "TECHNOLOGY",
      headline: "HUANG RETURNS AS NVIDIA CEO",
      fact: "Nvidia's board reinstated Jensen Huang as CEO 11 days after he stepped down; shares rose 33% in early trading, Nasdaq +6%, S&P 500 +4%.",
      sources: ["Reuters", "CNN", "WSJ"],
    },
    {
      kicker: "LIBYA",
      headline: "SEA DRONES SINK RUSSIAN CORVETTE",
      fact: "Ukrainian sea drones sank the Russian corvette Merkury off Benghazi and hit the cargo ship MV Angara; a Ka-27 helicopter was also destroyed. UNSMIL called for an independent investigation.",
      sources: ["The Times", "Le Monde", "AFP", "UN News"],
    },
    {
      kicker: "ESTONIA",
      headline: "RUSSIA WARNS ESTONIA OVER BORDER CLOSURE",
      fact: "Russia's foreign ministry said Estonia's actions are on the verge of triggering open war after Tallinn announced it will close its land border from 1 December for at least six months.",
      sources: ["Reuters"],
    },
  ],
  briefs: [
    { label: "GAZA", fact: "Israeli strikes killed at least 3 people, including UNRWA worker Adel al-Helo at a well in Jabalia.", source: "Reuters, 23 Nov" },
    { label: "INDONESIA", fact: "26 body bags identified, 28 still missing after the Banten candy factory fire.", source: "ThedailyID, 24 Nov" },
    { label: "MEGASPEED", fact: "The U.S. blacklisted seven firms in the Nvidia spy case.", source: "First reported 24 Nov 00:52 UTC" },
    { label: "ZELENSKY", fact: "Zelensky urged four-party Russia-U.S.-Europe talks as soon as possible.", source: "24 Nov 00:30 UTC" },
    { label: "S. KOREA", fact: "A Russian aircraft entered the air defence zone; jets were scrambled.", source: "24 Nov 01:04 UTC" },
    { label: "BANGLADESH", fact: "Mass typhoid vaccination of 50 million children began.", source: "24 Nov" },
  ],
  honesty_note:
    "Lead story (Hormuz) first reported 24 Nov UTC. Secondary stories (Nvidia, Libya, Estonia, Gaza) first reported Monday 23 Nov US time but dominated the morning news cycle of 24 Nov. Briefs Megaspeed, Zelensky, South Korea are 24 Nov UTC.",
};

function main(): void {
  const outDir = process.argv[2] ?? "/output";
  // paper
  for (let i = 0; i < BW * BH * 3; i += 3) {
    buf[i] = PAPER[0];
    buf[i + 1] = PAPER[1];
    buf[i + 2] = PAPER[2];
  }
  drawHeader();
  drawSecondary();
  drawFooter();
  const px = downsample();
  const png = encodePNG(W, H, px);
  const sha = crypto.createHash("sha256").update(png).digest("hex");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "entry.png"), png);
  const dossier = { ...DOSSIER, entry_png_sha256: sha, width: W, height: H };
  fs.writeFileSync(path.join(outDir, "dossier.json"), JSON.stringify(dossier, null, 2) + "\n");
  console.log(`wrote ${path.join(outDir, "entry.png")} sha256=${sha} bytes=${png.length}`);
}

main();
