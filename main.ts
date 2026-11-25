// main.ts — news-image-20261124 v7 "THE WORLD"
// Fresh build, written from DESIGN.md + verified facts (run log v1). No earlier
// edition's source was read. Node 22 stdlib only. Writes /output/entry.png +
// /output/dossier.json. Fully deterministic: fixed seed, no clocks, no network.
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as zlib from "node:zlib";

// ---------------------------------------------------------------- constants
const W = 1024, H = 1024, SS = 2; // final size; 2x supersampling
const PAPER: C = [247, 242, 231];
const INK: C = [27, 27, 22];
const SOFT: C = [84, 81, 72];
const NAVY: C = [30, 58, 92];
const NAVY_L: C = [52, 96, 140];
const RED: C = [163, 51, 39];
const GREEN: C = [30, 122, 70];
const GOLD: C = [201, 162, 39];
const SKY: C = [198, 214, 221];
const SEA: C = [94, 127, 146];
const SEA_D: C = [51, 80, 95];
const SMOKE: C = [138, 138, 130];
const SMOKE_L: C = [186, 186, 174];
const FIRE: C = [232, 99, 44];
const FLAME: C = [242, 169, 59];
const SAND: C = [214, 196, 160];
const WHITE: C = [250, 248, 243];

type C = [number, number, number];

// ------------------------------------------------------- deterministic rng
let seed = 20261124;
function rnd(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

// ------------------------------------------------------------------ canvas
const buf = new Uint8Array(W * SS * H * SS * 3);
function fillAll(c: C): void {
  for (let i = 0; i < buf.length; i += 3) { buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; }
}
function setPx(x: number, y: number, c: C): void {
  if (x < 0 || y < 0 || x >= W * SS || y >= H * SS) return;
  const i = (y * W * SS + x) * 3;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
}
function disc(cx: number, cy: number, r: number, c: C): void {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    const dy = y - cy;
    const dx = Math.sqrt(Math.max(0, r2 - dy * dy));
    for (let x = Math.floor(cx - dx); x <= Math.ceil(cx + dx); x++) setPx(x, y, c);
  }
}
function line(x0: number, y0: number, x1: number, y1: number, w: number, c: C): void {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / Math.max(0.6, w * 0.35)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(x0 + dx * t, y0 + dy * t, w / 2, c);
  }
}
function fillRect(x: number, y: number, w: number, h: number, c: C): void {
  for (let yy = Math.round(y); yy < Math.round(y + h); yy++)
    for (let xx = Math.round(x); xx < Math.round(x + w); xx++) setPx(xx, yy, c);
}
function fillEllipse(cx: number, cy: number, rx: number, ry: number, c: C): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    const t = (y - cy) / ry;
    if (Math.abs(t) > 1) continue;
    const dx = rx * Math.sqrt(1 - t * t);
    for (let x = Math.floor(cx - dx); x <= Math.ceil(cx + dx); x++) setPx(x, y, c);
  }
}
function fillPoly(pts: [number, number][], c: C): void {
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) setPx(x, y, c);
  }
}
function pill(x: number, y: number, w: number, h: number, c: C): void {
  fillRect(x + h / 2, y, w - h, h, c);
  disc(x + h / 2, y + h / 2, h / 2, c);
  disc(x + w - h / 2, y + h / 2, h / 2, c);
}

// ------------------------------------------------------------- PNG encoder
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const v of b) c = CRC_TABLE[(c ^ v) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(rgb: Buffer, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0)),
  ]);
}
function downsample(): Buffer {
  const out = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
      const i = ((y * SS + dy) * W * SS + x * SS + dx) * 3;
      r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
    }
    const o = (y * W + x) * 3, n = SS * SS;
    out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n);
  }
  return out;
}

// ------------------------------------------------------------------- font
// Vector stroke font, grid 10 wide x 14 tall, cap top y=1, baseline y=11,
// descender y=14. Each glyph: advance width w, strokes s (polylines), and
// optional serif feet f (positions where a short bar is drawn in serif mode).
type Glyph = { w: number; s: number[][][]; f?: number[][] };
const FONT: Record<string, Glyph> = {
  A: { w: 10, s: [[[0, 11], [5, 1], [10, 11]], [[2.6, 7], [7.4, 7]]] },
  B: { w: 10, s: [[[1, 1], [1, 11]], [[1, 1], [6, 1], [8, 2], [8, 4], [6, 6], [1, 6]], [[1, 6], [7, 6], [9, 8], [8, 11], [6, 11], [1, 11]]], f: [[1, 1], [1, 11]] },
  C: { w: 10, s: [[[9, 3], [6, 1], [3, 1], [1, 4], [1, 8], [3, 11], [6, 11], [9, 9]]] },
  D: { w: 10, s: [[[1, 1], [1, 11]], [[1, 1], [7, 1], [9, 3], [10, 6], [9, 9], [7, 11], [1, 11]]], f: [[1, 1], [1, 11]] },
  E: { w: 10, s: [[[1, 1], [1, 11]], [[1, 1], [9, 1]], [[1, 6], [7, 6]], [[1, 11], [9, 11]]], f: [[1, 1], [1, 11]] },
  F: { w: 10, s: [[[1, 1], [1, 11]], [[1, 1], [9, 1]], [[1, 6], [7, 6]]], f: [[1, 1], [1, 11]] },
  G: { w: 10, s: [[[9, 3], [6, 1], [3, 1], [1, 4], [1, 8], [3, 11], [6, 11], [9, 9], [9, 7], [6, 7]]] },
  H: { w: 10, s: [[[1, 1], [1, 11]], [[9, 1], [9, 11]], [[1, 6], [9, 6]]], f: [[1, 1], [9, 1], [1, 11], [9, 11]] },
  I: { w: 6, s: [[[3, 1], [3, 11]], [[1, 1], [5, 1]], [[1, 11], [5, 11]]], f: [[3, 1], [3, 11]] },
  J: { w: 10, s: [[[8, 1], [8, 9], [6, 11], [3, 11], [1, 9]]] },
  K: { w: 10, s: [[[1, 1], [1, 11]], [[9, 1], [1, 6]], [[4, 6], [9, 11]]], f: [[1, 1], [1, 11]] },
  L: { w: 10, s: [[[1, 1], [1, 11]], [[1, 11], [9, 11]]], f: [[1, 1], [1, 11]] },
  M: { w: 12, s: [[[1, 11], [1, 1], [6, 8], [11, 1], [11, 11]]], f: [[1, 1], [11, 1], [1, 11], [11, 11]] },
  N: { w: 10, s: [[[1, 11], [1, 1], [9, 11], [9, 1]]], f: [[1, 1], [9, 1], [1, 11], [9, 11]] },
  O: { w: 11, s: [[[3, 1], [8, 1], [10, 3], [10, 8], [8, 11], [3, 11], [1, 8], [1, 3], [3, 1]]] },
  P: { w: 10, s: [[[1, 1], [1, 11]], [[1, 1], [7, 1], [9, 3], [8, 6], [6, 6], [1, 6]]], f: [[1, 1], [1, 11]] },
  Q: { w: 11, s: [[[3, 1], [8, 1], [10, 3], [10, 8], [8, 11], [3, 11], [1, 8], [1, 3], [3, 1]], [[7, 8], [10, 12]]] },
  R: { w: 10, s: [[[1, 1], [1, 11]], [[1, 1], [7, 1], [9, 3], [8, 6], [6, 6], [1, 6]], [[5, 6], [9, 11]]], f: [[1, 1], [1, 11]] },
  S: { w: 10, s: [[[8, 2], [6, 1], [3, 1], [1, 3], [1, 5], [3, 7], [7, 7], [9, 9], [9, 11], [7, 11], [4, 11], [2, 10]]] },
  T: { w: 10, s: [[[5, 1], [5, 11]], [[1, 1], [9, 1]]], f: [[5, 11]] },
  U: { w: 10, s: [[[1, 1], [1, 8], [3, 11], [7, 11], [9, 8], [9, 1]]] },
  V: { w: 10, s: [[[0, 1], [5, 11], [10, 1]]] },
  W: { w: 12, s: [[[0, 1], [3, 11], [6, 4], [9, 11], [12, 1]]], f: [[0, 1], [12, 1]] },
  X: { w: 10, s: [[[0, 1], [10, 11]], [[10, 1], [0, 11]]] },
  Y: { w: 10, s: [[[0, 1], [5, 6], [10, 1]], [[5, 6], [5, 11]]], f: [[5, 11]] },
  Z: { w: 10, s: [[[1, 1], [9, 1]], [[9, 1], [1, 11]], [[1, 11], [9, 11]]] },
  a: { w: 10, s: [[[9, 5], [9, 11], [3, 11], [1, 9], [1, 7], [3, 5], [7, 5], [9, 6]]] },
  b: { w: 10, s: [[[1, 1], [1, 11]], [[1, 6], [6, 5], [8, 7], [8, 9], [6, 11], [1, 11]]] },
  c: { w: 10, s: [[[8, 6], [6, 5], [3, 5], [1, 7], [1, 9], [3, 11], [6, 11], [8, 10]]] },
  d: { w: 10, s: [[[9, 1], [9, 11]], [[9, 6], [5, 5], [2, 7], [2, 9], [5, 11], [9, 11]]] },
  e: { w: 10, s: [[[8, 7], [6, 5], [3, 5], [1, 7], [1, 9], [3, 11], [6, 11], [8, 10], [8, 8], [3, 8]]] },
  f: { w: 8, s: [[[6, 1], [3, 1], [2, 3], [2, 11]], [[1, 6], [7, 6]]] },
  g: { w: 10, s: [[[8, 5], [4, 5], [1, 7], [1, 9], [3, 11], [7, 11], [9, 9], [9, 5]], [[9, 9], [9, 13], [7, 14], [4, 14], [2, 13]]] },
  h: { w: 10, s: [[[1, 1], [1, 11]], [[1, 6], [5, 5], [8, 6], [8, 11]]] },
  i: { w: 5, s: [[[2.5, 5], [2.5, 11]], [[2.5, 1.5], [2.5, 2.5]]] },
  j: { w: 6, s: [[[4, 5], [4, 12], [3, 14], [1, 14]], [[4, 1.5], [4, 2.5]]] },
  k: { w: 10, s: [[[1, 1], [1, 11]], [[8, 5], [2, 8]], [[4, 7], [8, 11]]] },
  l: { w: 5, s: [[[2.5, 1], [2.5, 11]]] },
  m: { w: 12, s: [[[1, 5], [1, 11]], [[1, 5], [4, 5], [5, 7], [5, 11]], [[5, 5], [8, 5], [9, 7], [9, 11]]] },
  n: { w: 10, s: [[[1, 5], [1, 11]], [[1, 5], [5, 5], [8, 6], [8, 11]]] },
  o: { w: 10, s: [[[3, 5], [7, 5], [9, 7], [9, 9], [7, 11], [3, 11], [1, 9], [1, 7], [3, 5]]] },
  p: { w: 10, s: [[[1, 5], [1, 14]], [[1, 6], [6, 5], [8, 7], [8, 9], [6, 11], [1, 11]]] },
  q: { w: 10, s: [[[9, 5], [9, 14]], [[9, 6], [4, 5], [2, 7], [2, 9], [4, 11], [9, 11]]] },
  r: { w: 8, s: [[[1, 5], [1, 11]], [[1, 5], [5, 5], [7, 6], [7, 8]]] },
  s: { w: 9, s: [[[8, 5], [5, 5], [2, 6], [1, 8], [2, 9], [5, 10], [7, 10], [9, 9], [8, 7], [6, 7]]] },
  t: { w: 7, s: [[[4, 1], [4, 10], [6, 11]], [[1, 5], [7, 5]]] },
  u: { w: 10, s: [[[1, 5], [1, 9], [3, 11], [7, 11], [9, 9], [9, 5]]] },
  v: { w: 10, s: [[[0, 5], [5, 11], [10, 5]]] },
  w: { w: 12, s: [[[0, 5], [3, 11], [6, 7], [9, 11], [12, 5]]] },
  x: { w: 10, s: [[[0, 5], [10, 11]], [[10, 5], [0, 11]]] },
  y: { w: 10, s: [[[0, 5], [5, 11], [10, 5]], [[5, 11], [5, 13], [3, 14]]] },
  z: { w: 10, s: [[[1, 5], [9, 5]], [[9, 5], [1, 11]], [[1, 11], [9, 11]]] },
  "0": { w: 11, s: [[[3, 1], [8, 1], [10, 3], [10, 8], [8, 11], [3, 11], [1, 8], [1, 3], [3, 1]], [[3, 4], [8, 8]]] },
  "1": { w: 7, s: [[[4, 1], [4, 11]], [[2, 3], [4, 1]], [[1, 11], [7, 11]]] },
  "2": { w: 10, s: [[[2, 3], [4, 1], [7, 1], [9, 3], [9, 6], [2, 11], [9, 11]]] },
  "3": { w: 10, s: [[[2, 2], [5, 1], [8, 2], [9, 4], [7, 6], [9, 8], [8, 10], [5, 11], [2, 10]]] },
  "4": { w: 10, s: [[[7, 1], [7, 11]], [[1, 8], [8, 8]], [[8, 1], [1, 8]]] },
  "5": { w: 10, s: [[[9, 1], [2, 1], [2, 5], [7, 5], [9, 7], [9, 10], [7, 11], [3, 11]]] },
  "6": { w: 10, s: [[[8, 2], [6, 1], [3, 2], [1, 5], [1, 9], [3, 11], [7, 11], [9, 9], [9, 7], [7, 5], [3, 5]]] },
  "7": { w: 10, s: [[[1, 1], [9, 1], [4, 11]]] },
  "8": { w: 10, s: [[[3, 1], [7, 1], [9, 3], [8, 6], [5, 6], [3, 6], [1, 4], [3, 1]], [[3, 6], [7, 6], [9, 8], [8, 11], [5, 11], [3, 11], [1, 9], [1, 7], [3, 6]]] },
  "9": { w: 10, s: [[[2, 2], [5, 1], [8, 2], [9, 5], [8, 8], [5, 10], [2, 9], [1, 6], [2, 3]], [[9, 2], [9, 11]]] },
  ".": { w: 5, s: [[[2.5, 10], [2.5, 11]]] },
  ",": { w: 5, s: [[[2.5, 10], [2.5, 11], [1.5, 13]]] },
  ":": { w: 5, s: [[[2.5, 4], [2.5, 5]], [[2.5, 9], [2.5, 10]]] },
  ";": { w: 5, s: [[[2.5, 4], [2.5, 5]], [[2.5, 9], [2.5, 10], [1.5, 13]]] },
  "'": { w: 5, s: [[[3.5, 1], [2, 4]]] },
  '"': { w: 8, s: [[[2.5, 1], [1.5, 4]], [[6, 1], [5, 4]]] },
  "!": { w: 5, s: [[[2.5, 1], [2.5, 8]], [[2.5, 10], [2.5, 11]]] },
  "?": { w: 10, s: [[[2, 3], [4, 1], [7, 1], [9, 3], [9, 5], [7, 7], [5, 7]], [[5, 10], [5, 11]]] },
  "-": { w: 8, s: [[[1, 7], [7, 7]]] },
  "—": { w: 12, s: [[[0, 7], [12, 7]]] },
  "·": { w: 5, s: [[[2.5, 6], [2.5, 7]]] },
  "•": { w: 5, s: [[[2.5, 6], [2.5, 7]]] },
  "/": { w: 8, s: [[[6, 1], [2, 11]]] },
  "(": { w: 6, s: [[[5, 1], [2, 4], [2, 8], [5, 11]]] },
  ")": { w: 6, s: [[[1, 1], [4, 4], [4, 8], [1, 11]]] },
  "%": { w: 12, s: [[[8, 1], [2, 11]], [[2, 2], [4, 2], [4, 4], [2, 4]], [[8, 8], [10, 8], [10, 10], [8, 10]]] },
  "+": { w: 10, s: [[[5, 2], [5, 10]], [[1, 6], [9, 6]]] },
  "$": { w: 10, s: [[[5, 0], [5, 12]], [[8, 3], [6, 1], [3, 1], [1, 3], [2, 5], [5, 6], [8, 6], [9, 8], [8, 11], [6, 11], [3, 11]]] },
  "&": { w: 11, s: [[[7, 2], [4, 1], [2, 3], [2, 6], [4, 8], [7, 8], [9, 6], [9, 4], [7, 2]], [[10, 1], [3, 10], [2, 12], [6, 13], [9, 12]]] },
  "=": { w: 10, s: [[[1, 4], [9, 4]], [[1, 8], [9, 8]]] },
  "[": { w: 6, s: [[[5, 1], [1, 1], [1, 11], [5, 11]]] },
  "]": { w: 6, s: [[[1, 1], [5, 1], [5, 11], [1, 11]]] },
  " ": { w: 6.3, s: [] },
};

// ------------------------------------------------------------ text engine
function adv(ch: string, size: number, xs = 0.72): number {
  const g = FONT[ch];
  if (!g) return size * 0.5 * xs;
  return (g.w + 1.4) * (size / 14) * xs;
}
function textWidth(s: string, size: number, xs = 0.72): number {
  let w = 0;
  for (const ch of s) w += adv(ch, size, xs);
  return w;
}
function drawGlyph(ch: string, x: number, yBase: number, size: number, c: C, bold: boolean, serif: boolean, xs = 0.72): void {
  const g = FONT[ch];
  if (!g) return;
  const sc = size / 14;
  const thick = (bold ? size * 0.17 : size * 0.10) * SS;
  for (const stroke of g.s) {
    for (let i = 0; i + 1 < stroke.length; i++) {
      const a = stroke[i], b = stroke[i + 1];
      line(
        (x + a[0] * sc * xs) * SS, (yBase - (11 - a[1]) * sc) * SS,
        (x + b[0] * sc * xs) * SS, (yBase - (11 - b[1]) * sc) * SS,
        thick, c,
      );
    }
    if (stroke.length === 1) {
      disc((x + stroke[0][0] * sc * xs) * SS, (yBase - (11 - stroke[0][1]) * sc) * SS, thick / 2, c);
    }
  }
  if (serif && g.f) {
    for (const f of g.f) {
      const cx = (x + f[0] * sc * xs) * SS;
      const cy = (yBase - (11 - f[1]) * sc) * SS;
      fillRect(cx - 1.7 * sc * xs * SS, cy - thick / 2, 3.4 * sc * xs * SS, thick, c);
    }
  }
}
function drawText(s: string, x: number, yBase: number, size: number, c: C, o: { bold?: boolean; serif?: boolean; align?: "l" | "c" | "r"; xs?: number } = {}): number {
  const xs = o.xs ?? 0.72;
  const w = textWidth(s, size, xs);
  let cx = x;
  if (o.align === "c") cx = x - w / 2;
  if (o.align === "r") cx = x - w;
  for (const ch of s) {
    drawGlyph(ch, cx, yBase, size, c, !!o.bold, !!o.serif, xs);
    cx += adv(ch, size, xs);
  }
  return w;
}
function wrapText(s: string, size: number, maxW: number, xs = 0.72): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const wd of words) {
    const t = cur ? cur + " " + wd : wd;
    if (textWidth(t, size, xs) <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = wd; }
  }
  if (cur) lines.push(cur);
  return lines;
}
// Fit a string to one line by shrinking size until it fits (never below min).
function fitSize(s: string, size: number, maxW: number, min: number, xs = 0.72): number {
  let sz = size;
  while (sz > min && textWidth(s, sz, xs) > maxW) sz -= 0.5;
  return sz;
}

// ------------------------------------------------------------ layout helpers
const MX = 26; // side margin
function hRule(y: number, x0 = MX, x1 = W - MX, w = 2): void {
  fillRect(x0 * SS, y * SS, (x1 - x0) * SS, w * SS, INK);
}
function pillLabel(text: string, cx: number, y: number, size: number, bg: C, fg: C): void {
  const tw = textWidth(text, size) + 18;
  pill((cx - tw / 2) * SS, y * SS, tw * SS, (size + 8) * SS, bg);
  drawText(text, cx, y + size + 2, size, fg, { bold: true, align: "c" });
}

// ------------------------------------------------------- scaled primitives
// All take FINAL (1024) coordinates and scale to the 2x buffer internally.
function R(x: number, y: number, w: number, h: number, c: C): void { fillRect(x * SS, y * SS, w * SS, h * SS, c); }
function D(cx: number, cy: number, r: number, c: C): void { disc(cx * SS, cy * SS, r * SS, c); }
function LN(x0: number, y0: number, x1: number, y1: number, w: number, c: C): void { line(x0 * SS, y0 * SS, x1 * SS, y1 * SS, w * SS, c); }
function EL(cx: number, cy: number, rx: number, ry: number, c: C): void { fillEllipse(cx * SS, cy * SS, rx * SS, ry * SS, c); }
function PG(pts: [number, number][], c: C): void { fillPoly(pts.map((p) => [p[0] * SS, p[1] * SS] as [number, number]), c); }

// ------------------------------------------------------------------ smoke
// Spreading plume: puffs widen toward the top, anti-clustered by a spread
// rule, plus 8 thin curling wisps. Deterministic (fixed-seed rng).
function plume(cx: number, baseY: number, topY: number, maxR: number, n: number): void {
  const puffs: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const y = baseY - (baseY - topY) * t;
    const spread = maxR * (0.35 + 0.95 * Math.sin(t * Math.PI * 0.8));
    const ox = (rnd() - 0.5) * spread * 1.5;
    const r = maxR * (0.32 + 0.5 * rnd()) * (0.65 + 0.5 * Math.sin(t * Math.PI));
    puffs.push([cx + ox, y, r]);
  }
  // draw far puffs first (smaller = higher), then near ones
  puffs.sort((a, b) => a[2] - b[2]);
  for (const [px, py, pr] of puffs) {
    EL(px, py, pr, pr * 0.8, SMOKE);
    EL(px - pr * 0.25, py - pr * 0.2, pr * 0.55, pr * 0.45, SMOKE_L);
  }
  for (let k = 0; k < 8; k++) {
    const sx = cx + (rnd() - 0.5) * maxR * 2.4;
    const sy = baseY - rnd() * (baseY - topY) * 0.85;
    let px = sx, py = sy;
    for (let s = 0; s < 4; s++) {
      const nx = px + Math.sin(s * 1.4 + k * 1.7) * 9;
      const ny = py - 8 - rnd() * 4;
      LN(px, py, nx, ny, 1.8, SMOKE_L);
      px = nx; py = ny;
    }
  }
}
function mine(cx: number, cy: number, r: number): void {
  const dark: C = [40, 44, 48];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 + 0.4;
    LN(cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6, cx + Math.cos(a) * r * 1.55, cy + Math.sin(a) * r * 1.55, 1.8, dark);
  }
  D(cx, cy, r, dark);
  D(cx - r * 0.3, cy - r * 0.3, r * 0.28, [96, 106, 112]);
}

// ------------------------------------------------------------------ tanker
function tanker(x: number, y: number, w: number, h: number, hull: C, fire: boolean): void {
  // hull: flat stern left, raked bow right; y = deck line, h = hull depth
  PG([[x, y], [x + w * 0.8, y], [x + w, y + h * 0.55], [x + w * 0.94, y + h], [x, y + h]], hull);
  R(x, y, w * 0.8, 3, [24, 28, 32]);
  // deckhouse + funnel + containers
  R(x + w * 0.1, y - h * 0.55, w * 0.15, h * 0.55, [238, 235, 228]);
  R(x + w * 0.1, y - h * 0.55, w * 0.15, 3, INK);
  R(x + w * 0.3, y - h * 0.42, w * 0.07, h * 0.42, RED);
  R(x + w * 0.42, y - h * 0.3, w * 0.13, h * 0.3, NAVY_L);
  R(x + w * 0.58, y - h * 0.3, w * 0.13, h * 0.3, GOLD);
  R(x + w * 0.73, y - h * 0.18, w * 0.08, h * 0.18, [120, 130, 134]);
  if (fire) {
    EL(x + w * 0.5, y - h * 0.5, w * 0.16, h * 0.3, [242, 169, 59]);
    PG([[x + w * 0.38, y - h * 0.1], [x + w * 0.46, y - h * 0.85], [x + w * 0.52, y - h * 0.25], [x + w * 0.58, y - h * 0.7], [x + w * 0.64, y - h * 0.1]], FIRE);
    PG([[x + w * 0.44, y - h * 0.1], [x + w * 0.49, y - h * 0.55], [x + w * 0.55, y - h * 0.1]], FLAME);
  }
}

// ---------------------------------------------------------------- corvette
function corvette(x: number, y: number, w: number, h: number): void {
  // hull in three light bands so deck detail survives at thumbnail scale
  PG([[x, y], [x + w * 0.78, y], [x + w, y + h * 0.5], [x + w * 0.94, y + h], [x, y + h]], [122, 132, 136]);
  PG([[x, y], [x + w * 0.78, y], [x + w, y + h * 0.5], [x + w * 0.97, y + h * 0.42], [x, y + h * 0.42]], [168, 178, 182]);
  PG([[x, y + h * 0.62], [x + w * 0.96, y + h * 0.62], [x + w * 0.94, y + h], [x, y + h]], [62, 72, 76]);
  LN(x, y, x + w * 0.78, y, 2, [226, 232, 234]); // bright sheer line
  // superstructure, funnel with gold cap, mast + radar, turret
  R(x + w * 0.3, y - h * 0.5, w * 0.22, h * 0.5, [198, 206, 210]);
  R(x + w * 0.3, y - h * 0.5, w * 0.22, 3, INK);
  R(x + w * 0.56, y - h * 0.62, w * 0.09, h * 0.62, [226, 232, 234]);
  R(x + w * 0.56, y - h * 0.62, w * 0.09, 5, GOLD);
  R(x + w * 0.68, y - h * 0.85, 3, h * 0.85, INK);
  R(x + w * 0.6, y - h * 0.85, w * 0.16, 4, INK); // radar bar
  EL(x + w * 0.16, y - 3, w * 0.05, 4, [226, 232, 234]); // bow turret dome
  // wake + reflection streaks
  LN(x - 8, y + h + 4, x + w * 0.5, y + h + 4, 1.6, [226, 232, 234]);
  LN(x + w * 0.2, y + h + 9, x + w * 0.8, y + h + 9, 1.4, [190, 200, 204]);
}
function seaDrone(x: number, y: number, w: number): void {
  PG([[x, y], [x + w * 0.7, y], [x + w, y + 8], [x + w * 0.92, y + 14], [x, y + 14]], [52, 60, 64]);
  R(x + w * 0.3, y - 8, 3, 8, INK);
  D(x + w * 0.32, y - 10, 2.5, FIRE);
  // dotted path behind it
  for (let i = 1; i <= 6; i++) D(x - i * 12, y + 7 + Math.sin(i) * 2, 1.8, [226, 232, 234]);
}

// ------------------------------------------------------------ lead: Hormuz
function sceneLead(x: number, y: number, w: number, h: number): void {
  const skyH = Math.round(h * 0.42);
  R(x, y, w, skyH, SKY);
  R(x, y + skyH, w, h - skyH, SEA);
  R(x, y + skyH + Math.round((h - skyH) * 0.55), w, h - skyH - Math.round((h - skyH) * 0.55), SEA_D);
  // land corners: Iran top-left, Oman bottom-right (sand)
  PG([[x, y], [x + 150, y], [x, y + 58]], SAND);
  PG([[x + w, y + h], [x + w - 170, y + h], [x + w, y + h - 52]], SAND);
  // horizon shimmer
  LN(x, y + skyH, x + w, y + skyH, 1.5, [226, 232, 234]);
  // tankers: left calm, middle burning, right calm
  tanker(x + 60, y + 128, 210, 52, [58, 66, 72], false);
  tanker(x + 380, y + 118, 240, 58, [70, 60, 54], true);
  tanker(x + 700, y + 132, 200, 50, [52, 62, 70], false);
  // smoke column above the burning tanker, spreading wide
  plume(x + 500, y + 108, y + 8, 26, 28);
  // mines in the water
  mine(x + 330, y + 178, 7);
  mine(x + 660, y + 186, 6);
  mine(x + 880, y + 172, 6);
  // labels
  pillLabel("IRAN", x + 78, y + 8, 13, NAVY, WHITE);
  pillLabel("OMAN", x + w - 82, y + h - 30, 13, NAVY, WHITE);
  pillLabel("STRAIT OF HORMUZ", x + w / 2, y + h - 30, 13, INK, WHITE);
}

// ---------------------------------------------------------- Nvidia panel
function sceneNvidia(x: number, y: number, w: number, h: number): void {
  R(x, y, w, h, [16, 32, 54]);
  // chip
  const cx = x + 16, cy = y + 16, s = 62;
  R(cx - 5, cy - 5, s + 10, s + 10, [34, 64, 96]);
  R(cx, cy, s, s, [10, 22, 40]);
  R(cx + 8, cy + 8, s - 16, s - 16, [22, 48, 74]);
  drawText("NVDA", cx + s / 2, cy + s / 2 + 7, 17, [118, 200, 120], { bold: true, align: "c" });
  for (let i = 0; i < 5; i++) {
    R(cx + 6 + i * 12, cy - 11, 4, 6, GOLD);
    R(cx + 6 + i * 12, cy + s + 5, 4, 6, GOLD);
  }
  // rising chart
  const gx = x + 100, gy = y + 18, gw = w - 118, gh = 62;
  LN(gx, gy + gh, gx + gw, gy + gh, 1.5, [120, 140, 160]);
  const pts: [number, number][] = [[gx + 4, gy + gh - 8], [gx + gw * 0.3, gy + gh - 22], [gx + gw * 0.55, gy + gh - 16], [gx + gw * 0.8, gy + gh - 40], [gx + gw - 4, gy + 6]];
  for (let i = 0; i + 1 < pts.length; i++) LN(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 3, [86, 200, 120]);
  for (const p of pts) D(p[0], p[1], 3, [86, 200, 120]);
  drawText("+33%", gx + gw - 4, gy + 26, 22, [86, 200, 120], { bold: true, align: "r" });
  drawText("NASDAQ +6%  •  S&P +4%", x + 16, y + h - 12, 14, [200, 210, 220], { bold: true });
}

// ----------------------------------------------------------- Libya panel
function sceneLibya(x: number, y: number, w: number, h: number): void {
  R(x, y, w, h, [24, 46, 66]);
  R(x, y + Math.round(h * 0.62), w, h - Math.round(h * 0.62), [16, 34, 50]);
  // explosion glow + spread plume above the corvette
  EL(x + w * 0.62, y + 34, 34, 16, [242, 169, 59]);
  plume(x + w * 0.62, y + 30, y + 4, 13, 16);
  corvette(x + 12, y + 74, 292, 40);
  seaDrone(x + 14, y + h - 26, 52);
  pillLabel("LIBYA", x + w / 2, y + 6, 12, NAVY, WHITE);
}

// --------------------------------------------------------- Estonia panel
function sceneEstonia(x: number, y: number, w: number, h: number): void {
  R(x, y, w, h, [214, 208, 188]); // pale land
  R(x, y + Math.round(h * 0.66), w, h - Math.round(h * 0.66), [120, 122, 116]); // road
  LN(x, y + Math.round(h * 0.66), x + w, y + Math.round(h * 0.66), 2, INK);
  // flag pole with Estonian flag (blue-black-white), labels clear of the pole
  const px = x + w - 58, pyTop = y + 12, pyBot = y + 92;
  R(px, pyTop, 3, pyBot - pyTop, INK);
  R(px + 3, pyTop, 40, 9, [0, 114, 206]);
  R(px + 3, pyTop + 9, 40, 9, INK);
  R(px + 3, pyTop + 18, 40, 9, WHITE);
  drawText("ESTONIA", px - 8, pyTop + 44, 13, INK, { bold: true, align: "r" });
  drawText("RUSSIA", px - 8, pyTop + 62, 13, INK, { bold: true, align: "r" });
  // warning triangle
  PG([[x + 34, y + 26], [x + 62, y + 74], [x + 6, y + 74]], GOLD);
  PG([[x + 36, y + 32], [x + 58, y + 70], [x + 12, y + 70]], [244, 220, 120]);
  drawText("!", x + 34, y + 68, 22, INK, { bold: true, align: "c" });
  // red-white barrier across the road
  const by = y + Math.round(h * 0.72);
  R(x + 18, by, 8, 34, INK);
  R(x + w - 90, by, 8, 34, INK);
  for (let i = 0; i < 8; i++) R(x + 26 + i * ((w - 116) / 8), by, (w - 116) / 8, 12, i % 2 ? WHITE : RED);
  R(x + 26, by + 12, w - 116, 3, INK);
}

// ------------------------------------------------------------------ briefs
function briefLines(text: string, size: number, firstW: number, restW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  let maxW = firstW;
  for (const wd of words) {
    const t = cur ? cur + " " + wd : wd;
    if (textWidth(t, size) <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = wd; maxW = restW; }
  }
  if (cur) lines.push(cur);
  return lines;
}
function drawBrief(x: number, yBase: number, label: string, text: string, labelColor: C): void {
  const size = 17.5;
  const prefix = label + " — ";
  const pw = textWidth(prefix, size);
  drawText(prefix, x, yBase, size, labelColor, { bold: true });
  const lines = briefLines(text, size, 474 - pw, 474);
  drawText(lines[0] ?? "", x + pw, yBase, size, INK, {});
  if (lines[1]) drawText(lines[1], x, yBase + 26, size, INK, {});
}

// ------------------------------------------------------------------ layout
function render(): void {
  fillAll(PAPER);
  // masthead + dateline
  drawText("THE WORLD", W / 2, 98, 100, INK, { bold: true, serif: true, align: "c", xs: 1.0 });
  drawText("TUESDAY, 24 NOVEMBER 2026 • IN ONE IMAGE", W / 2, 128, 15, SOFT, { bold: true, align: "c" });
  hRule(140);
  // lead illustration + headline + facts
  sceneLead(MX, 148, W - 2 * MX, 200);
  drawText("MINES IN THE STRAIT OF HORMUZ", W / 2, 392, 42, INK, { bold: true, serif: true, align: "c", xs: 0.9 });
  drawText("Three tankers hit sea mines in the Strait of Hormuz, ablaze under US air escort.", MX, 424, 19, INK, {});
  drawText("Qatar mediates in Washington; US Treasury sanctions 22 firms, 8 people, $14.7bn.", MX, 460, 19, INK, {});
  drawText("JMIC: threat 'severe', more attacks 'highly likely'. Claim not independently verified.", MX, 496, 19, INK, {});
  hRule(512);
  // secondary panels
  const panels: [number, (x: number, y: number, w: number, h: number) => void, string, string][] = [
    [26, sceneNvidia, "HUANG RETURNS AS NVIDIA CEO", "Back 11 days after resigning; Trump pressed the board; shares +33%, Nasdaq +6%."],
    [356, sceneLibya, "SEA DRONES SINK RUSSIAN CORVETTE", "Seven drones sank corvette Merkury off Benghazi; MV Angara also hit, Ka-27 destroyed."],
    [682, sceneEstonia, "ESTONIA TO SHUT BORDER WITH RUSSIA", "Russia warns move is 'on the verge of triggering open war'; Tallinn shuts border from 1 Dec."],
  ];
  for (const [px, scene, head, fact] of panels) {
    const pw = 316;
    // card border
    R(px, 522, pw, 1.5, INK);
    R(px, 522, 1.5, 254, INK);
    R(px + pw - 1.5, 522, 1.5, 254, INK);
    R(px, 774.5, pw, 1.5, INK);
    scene(px + 1.5, 523.5, pw - 3, 128);
    const hl = wrapText(head, 21, pw - 12);
    let hy = 676;
    for (const ln of hl.slice(0, 2)) { drawText(ln, px + 6, hy, 21, INK, { bold: true, serif: true }); hy += 24; }
    const fl = wrapText(fact, 16, pw - 12);
    let fy = 722;
    for (const ln of fl.slice(0, 3)) { drawText(ln, px + 6, fy, 16, INK, {}); fy += 24; }
  }
  hRule(786);
  // IN BRIEF
  drawText("IN BRIEF", MX, 814, 18, INK, { bold: true, serif: true });
  const briefs: [string, string, C][] = [
    ["GAZA", "Israeli strikes kill at least 3, including UNRWA worker Adel al-Helo in Jabalia.", RED],
    ["INDONESIA", "26 body bags identified, 28 still missing after the Banten candy factory fire.", NAVY],
    ["MEGASPEED", "US blacklists seven firms in Nvidia spy case; first reported 24 Nov.", NAVY],
    ["ZELENSKY", "Urges four-party talks with Russia, US and Europe 'as soon as possible'.", NAVY],
    ["S. KOREA", "Russian jets enter air defence zone; Seoul scrambles fighters.", NAVY],
    ["BANGLADESH", "Mass typhoid vaccination of 50 million children begins.", NAVY],
  ];
  const rows = [844, 896, 948];
  for (let i = 0; i < 3; i++) {
    drawBrief(MX, rows[i], briefs[i][0], briefs[i][1], briefs[i][2]);
    drawBrief(524, rows[i], briefs[i + 3][0], briefs[i + 3][1], briefs[i + 3][2]);
  }
  // sources credit — kept well clear of the bottom edge (baseline 1006)
  drawText("Sources: Reuters, The Times, Le Monde, AFP, UN News, CNN, WSJ, Trends MENA, ThedailyID — 24 Nov 2026", W / 2, 1006, 12, SOFT, { align: "c" });
}

// ------------------------------------------------------------------ dossier
function dossier(pngSha: string): object {
  return {
    title: "THE WORLD — Tuesday, 24 November 2026",
    competition: "news-image-20261124",
    version: "v7",
    entry_png_sha256: pngSha,
    facts: [
      {
        story: "Strait of Hormuz — lead",
        text: "Three tankers hit sea mines in the Strait of Hormuz and caught fire under US air escort; IRGC claim not independently verified. Qatar mediates in Washington; US Treasury sanctions 22 firms and 8 people over $14.7bn in suspect deals. JMIC: threat 'severe', further attacks 'highly likely'.",
        sources: ["TRENDS MENA (2026-11-24T03:37:47Z)", "Dubai Standard", "AJVC sitrep 24 Nov 02:31 UTC"],
      },
      {
        story: "Nvidia",
        text: "Board restores Jensen Huang as CEO 11 days after he resigned; shares +33%, Nasdaq +6%, S&P 500 +4%; Trump pressed the board.",
        sources: ["Reuters", "CNN", "WSJ (announced 23 Nov)"],
      },
      {
        story: "Libya",
        text: "Ukrainian sea drones sank Russian corvette Merkury off Benghazi and hit cargo ship MV Angara; Ka-27 helicopter destroyed. Zelensky: 7 drones. UNSMIL calls for an independent investigation.",
        sources: ["The Times", "Le Monde", "AFP / UN News (attack 22 Nov, probe call 23 Nov)"],
      },
      {
        story: "Estonia",
        text: "Russia's foreign ministry calls Estonia's move 'on the verge of triggering open war' after Tallinn announced closing its land border from 1 Dec for at least 6 months.",
        sources: ["Reuters (23 Nov)"],
      },
      {
        story: "Briefs",
        text: "Gaza: Israeli strikes kill at least 3, including UNRWA worker Adel al-Helo in Jabalia. Indonesia: 26 body bags identified, 28 still missing after the Banten candy factory fire. Megaspeed: US blacklists seven firms in Nvidia spy case. Zelensky urges four-party talks. South Korea: Russian jets enter air defence zone. Bangladesh: mass typhoid vaccination of 50 million children begins.",
        sources: ["Reuters", "ThedailyID (24 Nov)", "US announcement 24 Nov 00:52 UTC", "24 Nov 00:30 UTC", "24 Nov 01:04 UTC", "24 Nov"],
      },
    ],
    notes: "4 of 7 lead stories were first reported 23 Nov (US time) but dominated the 24 Nov morning news cycle; the Hormuz lead is purely 24 Nov UTC.",
  };
}

// --------------------------------------------------------------------- main
function main(): void {
  const outDir = process.argv[2] || process.env.MAKEFUN_OUTPUT_DIR || "/output";
  render();
  const rgb = downsample();
  const png = encodePNG(rgb, W, H);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "entry.png"), png);
  const sha = crypto.createHash("sha256").update(png).digest("hex");
  fs.writeFileSync(path.join(outDir, "dossier.json"), JSON.stringify(dossier(sha), null, 2) + "\n");
  console.log("entry.png", png.length, "bytes sha256", sha);
}
main();
