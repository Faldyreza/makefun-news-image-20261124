// news-image-20261124 v8 — "THE WORLD", Tuesday 24 November 2026.
// A program that draws one newspaper front page (1024x1024) from the day's
// verified news, using only Node 22 stdlib. No network at run time.
// Rendering: software rasteriser at 2x supersampling, box downsample, own
// PNG encoder (zlib deflate + CRC32). Own vector stroke font (10x14 grid).
// Writes /output/entry.png and /output/dossier.json, byte-identical twice.

import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";

const W = 1024, H = 1024, SS = 2, BW = W * SS, BH = H * SS;
const buf = new Uint8Array(BW * BH * 3);

// ---- palette ----
const PAPER = [248, 244, 234];
const INK = [23, 19, 12];
const MUTED = [107, 98, 82];
const RULE = [60, 52, 40];
const RED = [163, 51, 39];
const SEA = [46, 111, 142];
const SEA_DARK = [30, 82, 110];
const SEA_LIGHT = [122, 168, 190];
const SKY = [207, 224, 232];
const SKY2 = [232, 238, 240];
const SAND = [217, 201, 163];
const SAND_DARK = [190, 168, 122];
const HULL = [38, 44, 52];
const HULL_LT = [96, 104, 116];
const DECK = [210, 198, 168];
const FIRE = [232, 110, 30];
const FIRE_Y = [244, 190, 60];
const SMOKE = [120, 116, 108];
const SMOKE_LT = [168, 162, 152];
const GREEN = [31, 122, 77];
const GREEN_LT = [120, 190, 150];
const YELLOW = [232, 185, 60];
const CHIP = [24, 68, 110];
const CHIP_LT = [70, 130, 180];
const WHITE = [250, 248, 244];

function fill(c: number[]) {
  for (let i = 0; i < BW * BH; i++) {
    buf[i * 3] = c[0]; buf[i * 3 + 1] = c[1]; buf[i * 3 + 2] = c[2];
  }
}

function setPx(x: number, y: number, c: number[]) {
  if (x < 0 || y < 0 || x >= BW || y >= BH) return;
  const i = (y * BW + x) * 3;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
}

// logical coords -> supersampled block
function rect(x: number, y: number, w: number, h: number, c: number[]) {
  const x0 = Math.max(0, Math.round(x * SS)), y0 = Math.max(0, Math.round(y * SS));
  const x1 = Math.min(BW, Math.round((x + w) * SS)), y1 = Math.min(BH, Math.round((y + h) * SS));
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) setPx(xx, yy, c);
}

function disc(cx: number, cy: number, r: number, c: number[]) {
  const x0 = Math.max(0, Math.floor((cx - r) * SS)), x1 = Math.min(BW - 1, Math.ceil((cx + r) * SS));
  const y0 = Math.max(0, Math.floor((cy - r) * SS)), y1 = Math.min(BH - 1, Math.ceil((cy + r) * SS));
  const rr = r * r;
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    const dx = xx / SS - cx, dy = yy / SS - cy;
    if (dx * dx + dy * dy <= rr) setPx(xx, yy, c);
  }
}

function ellipse(cx: number, cy: number, rx: number, ry: number, c: number[]) {
  const x0 = Math.max(0, Math.floor((cx - rx) * SS)), x1 = Math.min(BW - 1, Math.ceil((cx + rx) * SS));
  const y0 = Math.max(0, Math.floor((cy - ry) * SS)), y1 = Math.min(BH - 1, Math.ceil((cy + ry) * SS));
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    const dx = (xx / SS - cx) / rx, dy = (yy / SS - cy) / ry;
    if (dx * dx + dy * dy <= 1) setPx(xx, yy, c);
  }
}

function line(x1: number, y1: number, x2: number, y2: number, w: number, c: number[]) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len * SS * 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(x1 + dx * t, y1 + dy * t, w / 2, c);
  }
}

function polyline(pts: number[][], w: number, c: number[], closed = false) {
  for (let i = 0; i < pts.length - 1; i++) line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, c);
  if (closed && pts.length > 2) line(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1], w, c);
}

// even-odd scanline polygon fill (logical coords)
function fillPoly(pts: number[][], c: number[]) {
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  const y0 = Math.max(0, Math.floor(minY * SS)), y1 = Math.min(BH - 1, Math.ceil(maxY * SS));
  for (let yy = y0; yy <= y1; yy++) {
    const y = yy / SS;
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] * SS)), x1 = Math.min(BW - 1, Math.floor(xs[k + 1] * SS));
      for (let xx = x0; xx <= x1; xx++) setPx(xx, yy, c);
    }
  }
}

function hline(x1: number, x2: number, y: number, w: number, c: number[]) {
  line(x1, y, x2, y, w, c);
}

// ---- CRC32 + PNG ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG(rgb: Uint8Array, w: number, h: number): Buffer {
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (1 + w * 3) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0)),
  ]);
}

function downsample(): Uint8Array {
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
      const i = ((y * SS + dy) * BW + x * SS + dx) * 3;
      r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
    }
    const o = (y * W + x) * 3, n = SS * SS;
    out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n);
  }
  return out;
}

// ---- vector stroke font (own design) ----
// Grid x 0..10, y 0..14. Cap top y=1, baseline y=11, x-height top y=4,
// descender bottom y=14. Each glyph: list of strokes, each a polyline.
// The lowercase s is drawn with a deep lower bowl and a firm waist so it
// cannot read as c at small sizes; 8 is two closed stacked loops.
type Pt = [number, number];
const GLYPHS: Record<string, Pt[][]> = {
  A: [[[1, 11], [5, 1], [9, 11]], [[3, 7], [7, 7]]],
  B: [[[1, 11], [1, 1], [6, 1], [9, 3], [8, 5], [6, 5], [1, 5]], [[6, 5], [9, 7], [8, 11], [6, 11], [1, 11]]],
  C: [[[9, 3], [7, 1], [3, 1], [1, 4], [1, 8], [3, 11], [7, 11], [9, 9]]],
  D: [[[1, 11], [1, 1], [7, 1], [9, 3], [9, 8], [7, 11], [1, 11]]],
  E: [[[9, 1], [1, 1], [1, 11], [9, 11]], [[1, 6], [6, 6]]],
  F: [[[1, 11], [1, 1], [9, 1]], [[1, 6], [7, 6]]],
  G: [[[9, 3], [7, 1], [3, 1], [1, 4], [1, 8], [3, 11], [7, 11], [9, 9], [9, 6], [6, 6]]],
  H: [[[1, 1], [1, 11]], [[9, 1], [9, 11]], [[1, 6], [9, 6]]],
  I: [[[5, 1], [5, 11]], [[2, 1], [8, 1]], [[2, 11], [8, 11]]],
  J: [[[8, 1], [8, 9], [6, 11], [3, 11], [2, 9]]],
  K: [[[1, 1], [1, 11]], [[9, 1], [1, 6], [9, 11]]],
  L: [[[1, 1], [1, 11], [9, 11]]],
  M: [[[1, 11], [1, 1], [5, 7], [9, 1], [9, 11]]],
  N: [[[1, 11], [1, 1], [9, 11], [9, 1]]],
  O: [[[3, 1], [7, 1], [9, 4], [9, 8], [7, 11], [3, 11], [1, 8], [1, 4], [3, 1]]],
  P: [[[1, 11], [1, 1], [7, 1], [9, 3], [8, 6], [6, 7], [1, 7]]],
  Q: [[[3, 1], [7, 1], [9, 4], [9, 8], [7, 11], [3, 11], [1, 8], [1, 4], [3, 1]], [[6, 9], [10, 13]]],
  R: [[[1, 11], [1, 1], [7, 1], [9, 3], [8, 6], [6, 7], [1, 7]], [[5, 7], [10, 11]]],
  S: [[[9, 3], [7, 1], [3, 1], [1, 3], [1, 5], [2, 7], [4, 7], [7, 7], [9, 8], [9, 10], [7, 11], [3, 11], [1, 10]]],
  T: [[[1, 1], [9, 1]], [[5, 1], [5, 11]]],
  U: [[[1, 1], [1, 9], [3, 11], [7, 11], [9, 9], [9, 1]]],
  V: [[[1, 1], [5, 11], [9, 1]]],
  W: [[[1, 1], [3, 11], [5, 5], [7, 11], [9, 1]]],
  X: [[[1, 1], [9, 11]], [[9, 1], [1, 11]]],
  Y: [[[1, 1], [5, 6], [9, 1]], [[5, 6], [5, 11]]],
  Z: [[[1, 1], [9, 1], [1, 11], [9, 11]]],
  a: [[[9, 4], [9, 11]], [[9, 7], [7, 5], [4, 5], [2, 7], [2, 9], [4, 11], [7, 11], [9, 9]]],
  b: [[[1, 1], [1, 11]], [[1, 7], [3, 5], [7, 5], [9, 7], [9, 9], [7, 11], [3, 11], [1, 9]]],
  c: [[[9, 5], [7, 4], [3, 4], [1, 6], [1, 9], [3, 11], [7, 11], [9, 10]]],
  d: [[[9, 1], [9, 11]], [[9, 7], [7, 5], [3, 5], [1, 7], [1, 9], [3, 11], [7, 11], [9, 9]]],
  e: [[[8, 5], [6, 4], [3, 4], [1, 6], [1, 9], [3, 11], [6, 11], [8, 10], [9, 8], [9, 7]], [[1, 8], [8, 8]]],
  f: [[[7, 1], [4, 1], [3, 3], [3, 11]], [[2, 5], [7, 5]]],
  g: [[[8, 5], [6, 4], [3, 4], [1, 6], [1, 9], [3, 11], [6, 11], [8, 9], [8, 7]], [[8, 9], [8, 13], [6, 14], [3, 14], [2, 13]]],
  h: [[[1, 1], [1, 11]], [[1, 7], [3, 5], [6, 4], [8, 5], [9, 7], [9, 11]]],
  i: [[[5, 5], [5, 11]], [[5, 2], [5, 2]]],
  j: [[[7, 5], [7, 12], [5, 14], [3, 14]], [[7, 2], [7, 2]]],
  k: [[[1, 1], [1, 11]], [[9, 4], [1, 8], [9, 11]]],
  l: [[[5, 1], [5, 11]], [[3, 11], [7, 11]]],
  m: [[[1, 11], [1, 5], [3, 4], [5, 5], [5, 11]], [[5, 5], [7, 4], [9, 5], [9, 11]]],
  n: [[[1, 11], [1, 5], [3, 4], [6, 4], [8, 5], [9, 7], [9, 11]]],
  o: [[[3, 4], [7, 4], [9, 6], [9, 9], [7, 11], [3, 11], [1, 9], [1, 6], [3, 4]]],
  p: [[[1, 4], [1, 14]], [[1, 7], [3, 5], [7, 5], [9, 7], [9, 9], [7, 11], [3, 11], [1, 9]]],
  q: [[[9, 4], [9, 14]], [[9, 7], [7, 5], [3, 5], [1, 7], [1, 9], [3, 11], [7, 11], [9, 9]]],
  r: [[[1, 11], [1, 5], [3, 4], [6, 4], [8, 5]]],
  s: [[[9, 5.5], [7, 4], [4, 4], [2, 5], [1, 6.5], [2, 8], [4, 8.5], [7, 8.5], [9, 9.5], [9, 10.5], [7, 12], [4, 12], [2, 11], [1, 10]]],
  t: [[[6, 1], [6, 11]], [[2, 5], [9, 5]], [[6, 10], [8, 11], [9, 11]]],
  u: [[[1, 4], [1, 9], [3, 11], [6, 11], [8, 10], [9, 8], [9, 4]]],
  v: [[[1, 4], [5, 11], [9, 4]]],
  w: [[[1, 4], [3, 11], [5, 6], [7, 11], [9, 4]]],
  x: [[[1, 4], [9, 11]], [[9, 4], [1, 11]]],
  y: [[[1, 4], [4, 9], [9, 4]], [[4, 9], [4, 13], [2, 14]]],
  z: [[[1, 4], [9, 4], [1, 11], [9, 11]]],
  "0": [[[3, 1], [7, 1], [9, 4], [9, 8], [7, 11], [3, 11], [1, 8], [1, 4], [3, 1]]],
  "1": [[[3, 2], [5, 1], [5, 11]], [[2, 11], [8, 11]]],
  "2": [[[2, 3], [4, 1], [7, 1], [9, 3], [9, 5], [5, 9], [1, 11], [9, 11]]],
  "3": [[[1, 2], [4, 1], [7, 1], [9, 3], [8, 5], [6, 6], [8, 7], [9, 9], [7, 11], [4, 11], [1, 10]]],
  "4": [[[7, 1], [1, 8], [9, 8]], [[7, 1], [7, 11]]],
  "5": [[[9, 1], [1, 1], [1, 6], [3, 6], [7, 6], [9, 8], [9, 10], [7, 11], [3, 11], [1, 10]]],
  "6": [[[9, 3], [7, 1], [3, 1], [1, 4], [1, 9], [3, 11], [7, 11], [9, 9], [9, 7], [7, 5], [4, 5], [2, 7], [1, 9]]],
  "7": [[[1, 1], [9, 1], [5, 11]]],
  "8": [[[3, 1], [7, 1], [9, 3], [9, 5], [7, 6], [3, 6], [1, 5], [1, 3], [3, 1]], [[3, 6], [7, 6], [9, 8], [9, 10], [7, 11], [3, 11], [1, 10], [1, 8], [3, 6]]],
  "9": [[[1, 9], [1, 7], [3, 5], [7, 5], [9, 7], [9, 9], [9, 10], [7, 11], [3, 11], [1, 8], [1, 4], [3, 1], [7, 1], [9, 3]]],
  ".": [[[5, 11], [5, 11]]],
  ",": [[[5, 11], [4, 13], [3, 14]]],
  "'": [[[5, 2], [4, 5]]],
  '"': [[[3, 1], [2, 4]], [[7, 1], [6, 4]]],
  "(": [[[7, 1], [4, 3], [3, 6], [4, 9], [7, 11]]],
  ")": [[[3, 1], [6, 3], [7, 6], [6, 9], [3, 11]]],
  ":": [[[5, 4], [5, 4]], [[5, 10], [5, 10]]],
  ";": [[[5, 4], [5, 4]], [[5, 10], [4, 12], [3, 13]]],
  "!": [[[5, 1], [5, 9]], [[5, 11], [5, 11]]],
  "?": [[[2, 3], [4, 1], [7, 1], [9, 3], [9, 5], [7, 6], [5, 6], [5, 8]], [[5, 11], [5, 11]]],
  "-": [[[1, 6], [9, 6]]],
  "–": [[[0, 6], [10, 6]]],
  "—": [[[0, 6], [10, 6]]],
  "&": [[[7, 2], [4, 1], [2, 3], [2, 5], [4, 7], [7, 7], [9, 8]], [[2, 11], [5, 8], [9, 2], [10, 1]], [[9, 8], [9, 11], [7, 12], [4, 12], [2, 11]]],
  "%": [[[2, 2], [4, 2], [4, 4], [2, 4]], [[6, 8], [8, 8], [8, 10], [6, 10]], [[1, 11], [9, 1]]],
  "+": [[[5, 2], [5, 10]], [[1, 6], [9, 6]]],
  "/": [[[8, 1], [2, 11]]],
  "•": [[[5, 6], [5, 6]]],
  "·": [[[5, 6], [5, 6]]],
  "$": [[[9, 3], [7, 1], [3, 1], [1, 3], [1, 5], [2, 7], [4, 7], [7, 7], [9, 8], [9, 10], [7, 11], [3, 11], [1, 10]], [[5, 0], [5, 13]]],
};

// Slab feet for the masthead / headline serif look: horizontal bars at the
// cap line and the baseline under the vertical stems of each capital.
// [x1, x2, y] in grid coords; drawn only when serif mode is on.
const FEET: Record<string, [number, number, number][]> = {
  A: [[0, 2, 11], [8, 10, 11]],
  B: [[1, 8, 11]],
  D: [[1, 8, 11]],
  E: [[1, 9, 1], [1, 9, 11]],
  F: [[1, 9, 1]],
  H: [[0, 2, 11], [8, 10, 11]],
  I: [[2, 8, 1], [2, 8, 11]],
  K: [[0, 2, 11]],
  L: [[1, 9, 11]],
  M: [[0, 2, 11], [8, 10, 11]],
  N: [[0, 2, 11], [8, 10, 11]],
  P: [[1, 8, 11]],
  R: [[1, 8, 11]],
  T: [[1, 9, 1]],
  U: [[0, 2, 11], [8, 10, 11]],
  W: [[0, 2, 11], [8, 10, 11]],
  Y: [[4, 6, 11]],
  Z: [[1, 9, 1], [1, 9, 11]],
};

// ---- text ----
interface TextOpts {
  size: number;        // cap height in px
  weight?: number;     // stroke width in px (default 0.11 * size)
  xs?: number;         // horizontal compression (default 1)
  track?: number;      // extra px between glyphs (default 0)
  color?: number[];
  serif?: boolean;     // slab feet on capitals
  align?: "left" | "center" | "right";
}

function glyphW(ch: string, size: number, xs: number): number {
  if (ch === " ") return size * 0.42 * xs;
  if (ch === "i" || ch === "l" || ch === "j" || ch === "!" || ch === "." || ch === "," || ch === ":" || ch === ";" || ch === "'" || ch === "|") return size * 0.42 * xs;
  if (ch === "m" || ch === "M" || ch === "W" || ch === "w" || ch === "%") return size * 0.98 * xs;
  return size * 0.68 * xs;
}

function textW(s: string, o: TextOpts): number {
  const xs = o.xs ?? 1, track = o.track ?? 0;
  let w = 0;
  for (const ch of s) w += glyphW(ch, o.size, xs) + track;
  return w - track;
}

function drawGlyph(ch: string, x: number, yTop: number, o: TextOpts) {
  const g = GLYPHS[ch];
  if (!g) return;
  const size = o.size, xs = o.xs ?? 1, w = o.weight ?? size * 0.11;
  const c = o.color ?? INK;
  const sc = size / 10; // grid unit -> px (cap height 10 units)
  for (const stroke of g) {
    const pts = stroke.map(([gx, gy]) => [x + gx * sc * xs, yTop + (gy - 1) * sc] as Pt);
    if (pts.length === 1) { disc(pts[0][0], pts[0][1], Math.max(w * 0.9, 1.1), c); continue; }
    polyline(pts, w, c);
  }
  if (o.serif && /[A-Z]/.test(ch)) {
    const feet = FEET[ch];
    if (feet) for (const [x1, x2, gy] of feet) {
      line(x + x1 * sc * xs, yTop + (gy - 1) * sc, x + x2 * sc * xs, yTop + (gy - 1) * sc, Math.max(w * 0.85, 1), c);
    }
  }
}

function drawText(s: string, x: number, yTop: number, o: TextOpts) {
  const xs = o.xs ?? 1, track = o.track ?? 0;
  let cx = x;
  if (o.align === "center") cx = x - textW(s, o) / 2;
  if (o.align === "right") cx = x - textW(s, o);
  for (const ch of s) {
    if (ch !== " ") drawGlyph(ch, cx, yTop, o);
    cx += glyphW(ch, o.size, xs) + track;
  }
}

// wrap plain text into lines of at most maxW px
function wrap(s: string, o: TextOpts, maxW: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const wd of words) {
    const t = cur ? cur + " " + wd : wd;
    if (textW(t, o) <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = wd; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawLines(lines: string[], x: number, yTop: number, o: TextOpts, lh: number) {
  lines.forEach((ln, i) => drawText(ln, x, yTop + i * lh, o));
}

function labelPill(text: string, cx: number, y: number, o: TextOpts, bg: number[], fg: number[]) {
  const pad = 7, h = o.size + 9;
  const w = textW(text, o) + pad * 2;
  const x0 = cx - w / 2;
  rect(x0, y, w, h, bg);
  hline(x0, x0 + w, y, 1.5, fg);
  hline(x0, x0 + w, y + h, 1.5, fg);
  drawText(text, cx, y + 4.5, { ...o, align: "center", color: fg });
}

// ---- scene helpers ----
function mine(cx: number, cy: number, r: number) {
  disc(cx, cy, r, INK);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    line(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7, cx + Math.cos(a) * r * 1.7, cy + Math.sin(a) * r * 1.7, 1.6, INK);
  }
  disc(cx - r * 0.3, cy - r * 0.3, r * 0.25, [200, 200, 195]);
}

// smoke puff cluster: irregular overlapping ellipses, drifting up-left
function smoke(cx: number, cy: number, s: number, seed: number) {
  const puffs: [number, number, number, number][] = [
    [0, 0, 1.0, 0.75], [-0.9, -0.5, 0.8, 0.6], [0.9, -0.4, 0.85, 0.65],
    [-1.7, -1.1, 0.7, 0.55], [1.6, -1.0, 0.7, 0.55], [-0.4, -1.2, 0.9, 0.7],
    [-2.4, -1.7, 0.6, 0.45], [2.3, -1.6, 0.6, 0.45], [0.3, -2.0, 0.75, 0.55],
    [-1.1, -2.2, 0.55, 0.4], [1.4, -2.3, 0.55, 0.4], [-0.2, -3.0, 0.5, 0.38],
  ];
  for (let i = 0; i < puffs.length; i++) {
    const [dx, dy, rx, ry] = puffs[i];
    const jx = ((seed * 7 + i * 13) % 5) - 2;
    ellipse(cx + dx * s + jx, cy + dy * s, rx * s, ry * s, i % 3 === 0 ? SMOKE_LT : SMOKE);
  }
  // curling wisps, clearly visible
  const wisp = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) => {
    polyline([[x0, y0], [(x0 + x1) / 2 + 4, (y0 + y1) / 2 - 3], [x1, y1]], 1.4, SMOKE_LT);
    polyline([[x1, y1], [(x1 + x2) / 2 - 4, (y1 + y2) / 2 - 3], [x2, y2]], 1.2, SMOKE_LT);
  };
  wisp(cx - 2.2 * s, cy - 2.4 * s, cx - 2.9 * s, cy - 3.4 * s, cx - 2.4 * s, cy - 4.3 * s);
  wisp(cx + 2.0 * s, cy - 2.2 * s, cx + 2.8 * s, cy - 3.2 * s, cx + 2.3 * s, cy - 4.1 * s);
  wisp(cx + 0.2 * s, cy - 3.1 * s, cx + 0.9 * s, cy - 4.0 * s, cx + 0.4 * s, cy - 4.9 * s);
}

// flame tongues on a deck point, kept clear of the smoke column
function flame(cx: number, cy: number, s: number) {
  fillPoly([[cx - 0.9 * s, cy], [cx - 0.5 * s, cy - 1.6 * s], [cx - 0.1 * s, cy - 0.7 * s], [cx + 0.3 * s, cy - 2.1 * s], [cx + 0.7 * s, cy - 0.8 * s], [cx + 1.0 * s, cy - 1.3 * s], [cx + 1.1 * s, cy]], FIRE);
  fillPoly([[cx - 0.45 * s, cy], [cx - 0.2 * s, cy - 1.1 * s], [cx + 0.15 * s, cy - 0.5 * s], [cx + 0.45 * s, cy - 1.2 * s], [cx + 0.6 * s, cy]], FIRE_Y);
}

// tanker: hull + deck + bridge; length L, hull height h
function tanker(x: number, y: number, L: number, h: number, dir: 1 | -1) {
  const x2 = x + L * dir;
  fillPoly([[x, y], [x2, y], [x2 - 8 * dir, y + h], [x + 8 * dir, y + h]], HULL);
  rect(Math.min(x, x2) + 6, y - h * 0.55, L - 12, h * 0.55, HULL_LT);
  rect(Math.min(x, x2) + 6, y + h * 0.45, L - 12, h * 0.18, DECK);
  // bridge tower
  const bx = dir === 1 ? x2 - 26 : x + 14;
  rect(bx, y - h * 1.5, 12, h * 1.5, WHITE);
  rect(bx + 2, y - h * 1.5 + 3, 8, 3, INK);
  // funnel
  const fx = dir === 1 ? x + 16 : x2 - 28;
  rect(fx, y - h * 1.1, 10, h * 1.1, RED);
  // waterline highlight
  hline(Math.min(x, x2) + 4, Math.max(x, x2) - 4, y + h + 2, 1.5, SEA_LIGHT);
}

// ---- the front page ----
const MX = 28, CW = 968; // margins

function masthead() {
  drawText("THE WORLD", 512, 16, { size: 92, weight: 7.5, xs: 1.0, track: 4, serif: true, align: "center" });
  hline(MX, MX + CW, 122, 2, RULE);
  drawText("TUESDAY, 24 NOVEMBER 2026", MX, 130, { size: 20, weight: 2.2, xs: 0.92, track: 1.5 });
  drawText("IN ONE IMAGE", MX + CW, 130, { size: 20, weight: 2.2, xs: 0.92, track: 1.5, align: "right" });
  hline(MX, MX + CW, 156, 2.5, RULE);
  hline(MX, MX + CW, 160, 1, RULE);
}

function lead() {
  // headline
  drawText("MINES IN THE STRAIT OF HORMUZ", 512, 172, { size: 40, weight: 5, xs: 0.9, serif: true, align: "center" });
  // sky + land + sea
  rect(MX, 224, CW, 40, SKY2);
  rect(MX, 264, CW, 36, SKY);
  fillPoly([[MX, 224], [210, 224], [190, 300], [MX, 300]], SAND);
  fillPoly([[996, 224], [820, 224], [840, 300], [996, 300]], SAND);
  rect(MX, 300, CW, 172, SEA);
  for (let i = 0; i < 5; i++) hline(60 + i * 190, 200 + i * 190, 330 + i * 26, 1.5, SEA_LIGHT);
  for (let i = 0; i < 4; i++) hline(120 + i * 210, 260 + i * 210, 400 + i * 18, 1.5, SEA_DARK);
  drawText("IRAN", 64, 236, { size: 16, weight: 2, xs: 0.9, color: INK });
  drawText("OMAN", 920, 236, { size: 16, weight: 2, xs: 0.9, color: INK });
  // US air escort: small jet silhouette top right
  fillPoly([[836, 252], [872, 252], [880, 256], [872, 260], [836, 260]], INK);
  fillPoly([[850, 252], [858, 242], [862, 252]], INK);
  fillPoly([[850, 260], [858, 270], [862, 260]], INK);
  drawText("U.S. AIR ESCORT", 830, 276, { size: 11, weight: 1.4, xs: 0.85, color: MUTED });
  // tankers: left intact, middle burning, right distant
  tanker(96, 336, 210, 26, 1);
  tanker(388, 352, 230, 28, 1);
  tanker(716, 322, 150, 20, -1);
  // middle tanker: flame at the bow (right end of deck), plume rising up-LEFT
  // from mid-deck so the flame stays fully visible
  flame(592, 352, 9);
  flame(560, 352, 6);
  smoke(468, 306, 9, 3);
  // mines
  mine(300, 428, 7); mine(648, 420, 6); mine(766, 440, 6); mine(884, 424, 6);
  // strait pill
  labelPill("STRAIT OF HORMUZ", 470, 446, { size: 15, weight: 2, xs: 0.9, track: 1 }, WHITE, INK);
  // lead facts (line 3 reflowed shorter than v7's 86 chars, with right margin)
  const f = { size: 19, weight: 2, xs: 0.72 };
  drawText("IRGC says three tankers hit by sea mines in the Strait of Hormuz.", MX, 486, f);
  drawText("Tankers burning under U.S. air escort; claim not independently verified.", MX, 507, f);
  drawText("Qatar mediates in Washington; U.S. sanctions Iran shadow banking, $14.7bn.", MX, 528, f);
  hline(MX, MX + CW, 556, 2, RULE);
}

function panelKicker(text: string, x: number) {
  drawText(text, x, 572, { size: 15, weight: 2.4, xs: 0.95, track: 2.5, color: RED });
  hline(x, x + 310, 594, 1.5, RULE);
}

function panelHeadline(l1: string, l2: string, x: number) {
  drawText(l1, x, 724, { size: 23, weight: 3, xs: 0.9, serif: true });
  drawText(l2, x, 751, { size: 23, weight: 3, xs: 0.9, serif: true });
}

function panelFact(text: string, x: number) {
  const o = { size: 17.5, weight: 2, xs: 0.72 };
  const lines = wrap(text, o, 310);
  drawLines(lines, x, 786, o, 21);
  return lines.length;
}

function nvidia() {
  const x = MX;
  panelKicker("TECHNOLOGY", x);
  // chip
  rect(48, 622, 116, 68, CHIP);
  for (let i = 0; i < 4; i++) {
    hline(36, 48, 634 + i * 14, 3, CHIP_LT);
    hline(164, 176, 634 + i * 14, 3, CHIP_LT);
  }
  drawText("NVDA", 106, 646, { size: 20, weight: 2.4, xs: 0.9, color: WHITE, align: "center" });
  // rising chart
  line(196, 692, 196, 612, 2, INK);
  line(196, 692, 330, 692, 2, INK);
  const pts: Pt[] = [[204, 684], [236, 660], [268, 664], [300, 636], [326, 614]];
  polyline(pts, 3, GREEN);
  for (const p of pts) disc(p[0], p[1], 2.6, GREEN);
  drawText("+33%", 232, 596, { size: 28, weight: 3.4, xs: 0.9, color: GREEN });
  panelHeadline("HUANG RETURNS AS", "NVIDIA CEO", x);
  panelFact("Huang returns 11 days after exit; shares +33%, Nasdaq +6%, S&P +4%.", x);
}

function libya() {
  const x = 357;
  panelKicker("LIBYA", x);
  rect(x, 596, 310, 120, SEA);
  for (let i = 0; i < 4; i++) hline(x + 14 + i * 70, x + 60 + i * 70, 706 - i * 4, 1.5, SEA_LIGHT);
  // smoke plume above the corvette, drifting left
  smoke(516, 648, 7, 5);
  // corvette, 292 px wide (physical limit of the 310 px panel)
  fillPoly([[366, 678], [658, 678], [650, 694], [374, 694]], HULL);
  rect(372, 672, 280, 6, DECK);
  rect(430, 660, 90, 18, HULL_LT);
  rect(500, 652, 26, 26, WHITE);
  rect(502, 656, 22, 3, INK);
  rect(560, 656, 14, 22, HULL);
  rect(560, 652, 14, 5, YELLOW);
  rect(384, 668, 22, 10, HULL_LT);
  line(406, 672, 420, 668, 2, INK);
  line(620, 678, 620, 648, 2, INK);
  disc(620, 646, 4, INK);
  hline(372, 652, 698, 1.5, SEA_LIGHT);
  hline(400, 470, 702, 1.2, SEA_LIGHT);
  hline(560, 620, 702, 1.2, SEA_LIGHT);
  // sea drone, 52 px, with dotted wake
  fillPoly([[600, 702], [652, 702], [646, 710], [606, 710]], INK);
  line(626, 702, 626, 692, 2, INK);
  disc(626, 690, 2.4, RED);
  for (let i = 0; i < 6; i++) disc(588 - i * 12, 706 + (i % 2) * 2, 1.6, SEA_LIGHT);
  panelHeadline("SEA DRONES SINK", "RUSSIAN CORVETTE", x);
  panelFact("Seven drones sank corvette Merkury off Benghazi; MV Angara hit, Ka-27 destroyed.", x);
}

function estonia() {
  const x = 686;
  panelKicker("ESTONIA", x);
  // mini schematic map fills the panel's middle area: coastline, dashed
  // border, Tallinn dot, 1 DEC tag
  rect(700, 600, 150, 74, WHITE);
  rect(700, 600, 150, 2, INK); rect(700, 672, 150, 2, INK);
  rect(700, 600, 2, 74, INK); rect(848, 600, 2, 74, INK);
  fillPoly([[700, 674], [850, 674], [850, 646], [820, 636], [770, 644], [730, 656], [700, 660]], SAND);
  polyline([[700, 660], [730, 656], [770, 644], [820, 636], [850, 646]], 2, SEA_DARK);
  for (let i = 0; i < 5; i++) line(712 + i * 26, 628, 730 + i * 26, 628, 2, RED);
  disc(782, 648, 3.4, RED);
  drawText("TALLINN", 790, 641, { size: 10, weight: 1.4, xs: 0.85 });
  rect(812, 654, 32, 14, RED);
  drawText("1 DEC", 828, 657, { size: 10, weight: 1.6, xs: 0.85, color: WHITE, align: "center" });
  // border barrier across the lower band
  rect(x, 684, 310, 32, [200, 196, 188]);
  rect(828, 660, 4, 56, INK);
  for (let i = 0; i < 6; i++) {
    const ax = 832 + i * 20, ay = 668 - i * 3;
    line(ax, ay, ax + 20, ay - 3, 5, i % 2 === 0 ? RED : WHITE);
  }
  fillPoly([[962, 654], [972, 632], [982, 654]], YELLOW);
  line(962, 654, 982, 654, 2, INK);
  drawText("!", 972, 636, { size: 14, weight: 2, align: "center" });
  drawText("ESTONIA", 700, 692, { size: 13, weight: 2, xs: 0.9 });
  drawText("RUSSIA", 852, 692, { size: 13, weight: 2, xs: 0.9 });
  panelHeadline("RUSSIA WARNS ESTONIA", "OVER BORDER CLOSURE", x);
  panelFact("Tallinn shuts border from 1 Dec; Moscow: 'on the verge of triggering open war'.", x);
}

function briefItem(x: number, y: number, label: string, text: string, maxW: number) {
  const o = { size: 17.5, weight: 2, xs: 0.72 };
  const lw = textW(label + " — ", o);
  const lines = wrap(text, o, maxW - lw);
  drawText(label, x, y, { ...o, weight: 2.8, color: RED });
  drawText("—", x + textW(label, o), y, o);
  drawText(lines[0], x + lw, y, o);
  if (lines[1]) drawText(lines[1], x, y + 20, o);
}

function briefs() {
  hline(MX, MX + CW, 834, 2, RULE);
  drawText("IN BRIEF", MX, 842, { size: 18, weight: 2.6, xs: 0.95, track: 2 });
  const items: [string, string][] = [
    ["GAZA", "Israeli strikes kill at least 3, including UNRWA worker in Jabalia."],
    ["INDONESIA", "26 body bags identified, 28 still missing after Banten candy factory fire."],
    ["MEGASPEED", "U.S. blacklists seven firms in Nvidia spy case."],
    ["ZELENSKY", "Urges four-party Russia-U.S.-Europe talks 'as soon as possible'."],
    ["S. KOREA", "Russian aircraft enter air defence zone; jets scrambled."],
    ["BANGLADESH", "Mass typhoid vaccination of 50 million children begins."],
  ];
  const ys = [872, 908, 944];
  items.forEach(([label, text], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    briefItem(col === 0 ? MX : MX + 498, ys[row], label, text, 470);
  });
  drawText("Sources: Reuters · The Times · Le Monde · AFP · UN News · TRENDS MENA", 512, 1006, { size: 13, weight: 1.6, xs: 0.85, color: MUTED, align: "center" });
}

// ---- dossier + main ----
const DOSSIER = {
  title: "THE WORLD — Tuesday, 24 November 2026",
  competition: "news-image-20261124",
  stories: [
    {
      story: "Strait of Hormuz",
      headline: "MINES IN THE STRAIT OF HORMUZ",
      facts: [
        "IRGC says three tankers hit by sea mines in the Strait of Hormuz.",
        "Tankers burning under U.S. air escort; claim not independently verified.",
        "Qatar mediates in Washington; U.S. sanctions Iran shadow banking, $14.7bn.",
        "Treasury sanctioned 22 firms and 8 people over $14.7bn in suspicious transactions; JMIC threat level severe.",
      ],
      sources: ["TRENDS MENA, published 2026-11-24T03:37:47Z", "Dubai Standard", "AJVC sitrep 24 Nov 02:31 UTC"],
    },
    {
      story: "Nvidia",
      headline: "HUANG RETURNS AS NVIDIA CEO",
      facts: ["Board restores Jensen Huang as CEO 11 days after he stepped down; shares +33%, Nasdaq +6%, S&P 500 +4%."],
      sources: ["Reuters", "CNN", "WSJ (announced Mon 23 Nov)"],
    },
    {
      story: "Libya",
      headline: "SEA DRONES SINK RUSSIAN CORVETTE",
      facts: ["Seven Ukrainian sea drones sank Russian corvette Merkury off Benghazi; cargo ship MV Angara also hit, Ka-27 helicopter destroyed; UNSMIL calls for an independent investigation."],
      sources: ["The Times", "Le Monde", "AFP / UN News (attack Sun 22 Nov; probe call Mon 23 Nov)"],
    },
    {
      story: "Estonia",
      headline: "RUSSIA WARNS ESTONIA OVER BORDER CLOSURE",
      facts: ["Tallinn to shut its land border from 1 Dec for at least 6 months; Moscow calls the move 'on the verge of triggering open war'."],
      sources: ["Reuters (Mon 23 Nov)"],
    },
    {
      story: "In brief",
      headline: "IN BRIEF",
      facts: [
        "Gaza: Israeli strikes kill at least 3, including UNRWA worker Adel al-Helo in Jabalia.",
        "Indonesia: 26 body bags identified, 28 still missing after Banten candy factory fire.",
        "Megaspeed: U.S. blacklists seven firms in Nvidia spy case.",
        "Zelensky: urges four-party Russia-U.S.-Europe talks 'as soon as possible'.",
        "South Korea: Russian aircraft enter air defence zone; jets scrambled.",
        "Bangladesh: mass typhoid vaccination of 50 million children begins.",
      ],
      sources: ["Reuters (Gaza, 23 Nov)", "ThedailyID (Indonesia, 24 Nov)", "first reported 24 Nov 00:52 / 00:30 / 01:04 UTC"],
    },
  ],
  note: "Lead story first reported 24 Nov UTC. Secondary stories first reported Mon 23 Nov US time but dominated the 24 Nov morning news cycle; briefs Megaspeed / Zelensky / South Korea first reported 24 Nov UTC.",
};

function main() {
  fill(PAPER);
  masthead();
  lead();
  nvidia();
  libya();
  estonia();
  briefs();
  const rgb = downsample();
  const png = encodePNG(rgb, W, H);
  const outDir = process.env.OUT_DIR || "/output";
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outDir + "/entry.png", png);
  const sha = createHash("sha256").update(png).digest("hex");
  const dossier = { ...DOSSIER, entry_png_sha256: sha, width: W, height: H };
  writeFileSync(outDir + "/dossier.json", JSON.stringify(dossier, null, 2) + "\n");
  console.log("entry.png", png.length, "bytes, sha256", sha);
  console.log("dossier.json written to", outDir);
}

main();
