// THE WORLD — Tuesday, 24 November 2026, in one image.
// make.fun bounty news-image-20261124, v4. Fresh build: procedural newspaper
// front page, 1024x1024, Node 22 stdlib only, no network at runtime.
// Every glyph is a hand-defined vector stroke path; every picture is drawn
// with a small rasteriser + PNG encoder written here. Deterministic output.
//
// makefun anchor 731d6a1e38cc4e561250ca6f7c8c8a5cb6725da6 round 34234665

import * as fs from "node:fs";
import * as zlib from "node:zlib";

// ---------------------------------------------------------------- canvas
const W = 1024;
const H = 1024;
const px = new Uint8Array(W * H * 3);

type RGB = [number, number, number];
const PAPER: RGB = [247, 242, 229];
const INK: RGB = [22, 18, 14];
const RED: RGB = [163, 51, 39];
const NAVY: RGB = [31, 58, 95];
const SEA: RGB = [30, 74, 99];
const SEA_DARK: RGB = [20, 50, 74];
const SKY: RGB = [207, 221, 230];
const SAND: RGB = [217, 201, 163];
const GREEN: RGB = [46, 125, 79];
const ORANGE: RGB = [217, 106, 30];
const GREY: RGB = [138, 138, 134];
const WHITE: RGB = [250, 248, 242];

function fillAll(c: RGB): void {
  for (let i = 0; i < W * H; i++) {
    px[i * 3] = c[0];
    px[i * 3 + 1] = c[1];
    px[i * 3 + 2] = c[2];
  }
}

function setPx(x: number, y: number, c: RGB): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || xi >= W || yi < 0 || yi >= H) return;
  const o = (yi * W + xi) * 3;
  px[o] = c[0];
  px[o + 1] = c[1];
  px[o + 2] = c[2];
}

function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(W, Math.round(x + w));
  const y1 = Math.min(H, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const o = (yy * W + xx) * 3;
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
    }
  }
}

function disc(cx: number, cy: number, r: number, c: RGB): void {
  const rr = Math.max(0.5, r);
  const x0 = Math.max(0, Math.floor(cx - rr));
  const x1 = Math.min(W - 1, Math.ceil(cx + rr));
  const y0 = Math.max(0, Math.floor(cy - rr));
  const y1 = Math.min(H - 1, Math.ceil(cy + rr));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= rr * rr) setPx(x, y, c);
    }
  }
}

// Thick line drawn as a chain of discs — round caps and joins for free.
function thickLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const r = w / 2;
  if (len < 0.001) {
    disc(x0, y0, r, c);
    return;
  }
  const step = Math.max(0.5, r * 0.7);
  const n = Math.ceil(len / step);
  for (let i = 0; i <= n; i++) {
    disc(x0 + (dx * i) / n, y0 + (dy * i) / n, r, c);
  }
}

type Pt = [number, number];

function polyline(pts: Pt[], w: number, c: RGB, close = false): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    thickLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, c);
  }
  if (close && pts.length > 2) {
    thickLine(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1], w, c);
  }
}

// Even-odd scanline polygon fill.
function fillPoly(pts: Pt[], c: RGB): void {
  let minY = H;
  let maxY = 0;
  for (const p of pts) {
    minY = Math.min(minY, Math.floor(p[1]));
    maxY = Math.max(maxY, Math.ceil(p[1]));
  }
  minY = Math.max(0, minY);
  maxY = Math.min(H - 1, maxY);
  for (let y = minY; y <= maxY; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
        const t = (yc - a[1]) / (b[1] - a[1]);
        xs.push(a[0] + t * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k]));
      const x1 = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = x0; x <= x1; x++) setPx(x, y, c);
    }
  }
}

function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(H - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    const t = (y + 0.5 - cy) / ry;
    if (Math.abs(t) > 1) continue;
    const hx = rx * Math.sqrt(1 - t * t);
    const x0 = Math.max(0, Math.ceil(cx - hx));
    const x1 = Math.min(W - 1, Math.floor(cx + hx));
    for (let x = x0; x <= x1; x++) setPx(x, y, c);
  }
}

// ---------------------------------------------------------------- PNG
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePNG(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    Buffer.from(px.buffer, y * W * 3, W * 3).copy(raw, y * (1 + W * 3) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------- vector font
// Glyph space: cap height 12 units, baseline y=0, descenders to -4.
// Curves are smooth arcs (not jagged polylines) so S, G, Q and & read as
// newspaper serif letterforms. Rendered condensed (x scale 0.82).

function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 12): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

type Glyph = { w: number; s: Pt[][] };
const G: Record<string, Glyph> = {
  A: { w: 11, s: [[[1, 0], [6, 12], [11, 0]], [[3.4, 5.2], [8.6, 5.2]]] },
  B: { w: 10, s: [[[1.5, 0], [1.5, 12]], [[1.5, 12], ...arc(5.5, 9, 4, 3, 90, -90), [1.5, 6]], [[1.5, 6], ...arc(5.5, 3, 4.5, 3, 90, -90), [1.5, 0]]] },
  C: { w: 10, s: [arc(5.5, 6, 4.5, 6, 55, 305, 16)] },
  D: { w: 11, s: [[[1.5, 0], [1.5, 12]], [[1.5, 12], ...arc(5.5, 6, 5, 6, 90, -90), [1.5, 0]]] },
  E: { w: 9, s: [[[1.5, 0], [1.5, 12]], [[1.5, 12], [8.5, 12]], [[1.5, 6], [7.5, 6]], [[1.5, 0], [8.5, 0]]] },
  F: { w: 9, s: [[[1.5, 0], [1.5, 12]], [[1.5, 12], [8.5, 12]], [[1.5, 7], [7.5, 7]]] },
  G: { w: 11, s: [arc(5.8, 6, 4.6, 6, 45, 315, 16), [[10.2, 5.2], [6.6, 5.2], [6.6, 2.2]]] },
  H: { w: 11, s: [[[1.5, 0], [1.5, 12]], [[9.5, 0], [9.5, 12]], [[1.5, 6], [9.5, 6]]] },
  I: { w: 6, s: [[[3, 0], [3, 12]], [[0.8, 12], [5.2, 12]], [[0.8, 0], [5.2, 0]]] },
  J: { w: 9, s: [[[4, 12], [9, 12]], [[7, 12], [7, 2], ...arc(4.5, 2, 2.5, 2, 0, -180, 10)]] },
  K: { w: 10, s: [[[1.5, 0], [1.5, 12]], [[9.5, 12], [2.5, 5.5]], [[4, 4], [9.5, 0]]] },
  L: { w: 9, s: [[[1.5, 0], [1.5, 12]], [[1.5, 0], [8.5, 0]]] },
  M: { w: 13, s: [[[1, 0], [1, 12]], [[12, 0], [12, 12]], [[1, 12], [6.5, 3], [12, 12]]] },
  N: { w: 11, s: [[[1.5, 0], [1.5, 12]], [[9.5, 0], [9.5, 12]], [[1.5, 12], [9.5, 0]]] },
  O: { w: 11, s: [arc(5.5, 6, 4.5, 6, 0, 360, 20)] },
  P: { w: 10, s: [[[1.5, 0], [1.5, 12]], [[1.5, 12], ...arc(5.5, 9, 4, 3, 90, -90), [1.5, 6]]] },
  Q: { w: 11, s: [arc(5.5, 6, 4.5, 6, 0, 360, 20), [[7.5, 2.5], [11, -0.5]]] },
  R: { w: 10, s: [[[1.5, 0], [1.5, 12]], [[1.5, 12], ...arc(5.5, 9, 4, 3, 90, -90), [1.5, 6]], [[5, 6], [10, 0]]] },
  S: { w: 10, s: [[...arc(6, 9, 4, 3, 30, 240, 14), ...arc(5.8, 3.2, 4.2, 3.2, 60, -180, 14)]] },
  T: { w: 10, s: [[[1, 12], [10, 12]], [[5.5, 12], [5.5, 0]]] },
  U: { w: 11, s: [[[1.5, 12], [1.5, 3.2], ...arc(5.5, 3, 4, 3, 180, 360, 12), [9.5, 12]]] },
  V: { w: 11, s: [[[1, 12], [5.5, 0]], [[10, 12], [5.5, 0]]] },
  W: { w: 14, s: [[[1, 12], [3.8, 0]], [[3.8, 0], [7, 9]], [[7, 9], [10.2, 0]], [[10.2, 0], [13, 12]]] },
  X: { w: 10, s: [[[1.5, 12], [9.5, 0]], [[9.5, 12], [1.5, 0]]] },
  Y: { w: 10, s: [[[1, 12], [5.5, 6]], [[10, 12], [5.5, 6]], [[5.5, 6], [5.5, 0]]] },
  Z: { w: 10, s: [[[1.5, 12], [9.5, 12]], [[9.5, 12], [1.5, 0]], [[1.5, 0], [9.5, 0]]] },
  a: { w: 9, s: [[[8.5, 8], [8.5, 0]], arc(4.8, 4, 3.6, 4, 0, 360, 16)] },
  b: { w: 9, s: [[[1.5, 0], [1.5, 12]], arc(5.2, 4, 3.4, 4, 0, 360, 16)] },
  c: { w: 8, s: [arc(4.8, 4, 3.8, 4, 50, 310, 14)] },
  d: { w: 9, s: [arc(4.8, 4, 3.4, 4, 0, 360, 16), [[8.2, 12], [8.2, 0]]] },
  e: { w: 9, s: [arc(5, 4, 3.8, 4, -50, 230, 16), [[1.6, 4.2], [8.6, 4.2]]] },
  f: { w: 7, s: [[[5.5, 0], [5.5, 10], ...arc(3.8, 10, 1.8, 2, 0, 180, 8)], [[2, 7.5], [7.5, 7.5]]] },
  g: { w: 9, s: [arc(4.8, 4, 3.5, 4, 0, 360, 16), [[8.3, 8], [8.3, -2], ...arc(5.5, -2, 2.8, 2, 0, -180, 10)]] },
  h: { w: 9, s: [[[1.5, 0], [1.5, 12]], [[1.5, 7], ...arc(5.2, 4, 3.7, 4, 105, -5, 10), [8.9, 0]]] },
  i: { w: 5, s: [[[2.5, 0], [2.5, 8]], [[2.5, 11]]] },
  j: { w: 6, s: [[[4, 8], [4, 0], ...arc(2.4, 0, 1.7, 2, 0, -180, 8)], [[4, 11]]] },
  k: { w: 9, s: [[[1.5, 0], [1.5, 12]], [[8.5, 8], [2.5, 3.5]], [[4, 2], [8.5, 0]]] },
  l: { w: 5, s: [[[2.5, 0], [2.5, 12]]] },
  m: { w: 15, s: [[[1.5, 0], [1.5, 8]], [[1.5, 7], ...arc(4.8, 4, 3.3, 4, 100, -5, 10), [8.1, 0]], [[8.1, 7], ...arc(11.4, 4, 3.3, 4, 100, -5, 10), [14.7, 0]]] },
  n: { w: 9, s: [[[1.5, 0], [1.5, 8]], [[1.5, 7], ...arc(5.2, 4, 3.7, 4, 105, -5, 10), [8.9, 0]]] },
  o: { w: 9, s: [arc(4.8, 4, 3.8, 4, 0, 360, 16)] },
  p: { w: 9, s: [[[1.5, -4], [1.5, 8]], arc(5.2, 4, 3.4, 4, 0, 360, 16)] },
  q: { w: 9, s: [arc(4.8, 4, 3.4, 4, 0, 360, 16), [[8.2, 8], [8.2, -4]]] },
  r: { w: 7, s: [[[1.5, 0], [1.5, 8]], [[1.5, 7], ...arc(4.6, 5.8, 3, 2, 115, 5, 8)]] },
  s: { w: 8, s: [[...arc(4.4, 6.4, 3, 2.2, 30, 240, 10), ...arc(4.2, 2.4, 3.1, 2.4, 60, -180, 10)]] },
  t: { w: 7, s: [[[3.5, 0], [3.5, 10], ...arc(2.2, 10, 1.4, 1.6, 0, 160, 8)], [[1, 7], [6, 7]]] },
  u: { w: 9, s: [[[1.5, 8], [1.5, 3.2], ...arc(5, 3, 3.5, 3, 180, 360, 10)], [[8.5, 8], [8.5, 0]]] },
  v: { w: 9, s: [[[1, 8], [4.8, 0]], [[8.5, 8], [4.8, 0]]] },
  w: { w: 13, s: [[[1, 8], [3.2, 0]], [[3.2, 0], [6.5, 6]], [[6.5, 6], [9.8, 0]], [[9.8, 0], [12.5, 8]]] },
  x: { w: 9, s: [[[1.5, 8], [8.5, 0]], [[8.5, 8], [1.5, 0]]] },
  y: { w: 9, s: [[[1, 8], [4.8, 0]], [[8.5, 8], [4.8, 0], [2.8, -4]]] },
  z: { w: 8, s: [[[1.5, 8], [8, 8]], [[8, 8], [1.5, 0]], [[1.5, 0], [8, 0]]] },
  "0": { w: 10, s: [arc(5, 6, 4, 6, 0, 360, 18)] },
  "1": { w: 6, s: [[[1.5, 9], [4.5, 12], [4.5, 0]], [[2, 0], [6, 0]]] },
  "2": { w: 10, s: [[...arc(5.5, 8.5, 4, 3.5, 180, 0, 12), [1.5, 0], [9.5, 0]]] },
  "3": { w: 10, s: [[[2, 12], ...arc(5.8, 9, 4, 3, 120, -60, 10), [5.5, 6]], [[5.5, 6], ...arc(5.8, 3, 4.2, 3, 120, -60, 10), [2, 0]]] },
  "4": { w: 10, s: [[[7, 12], [1.5, 0.5]], [[1, 4.5], [9.5, 4.5]], [[7, 12], [7, 0]]] },
  "5": { w: 10, s: [[[8.5, 12], [1.5, 12], [1.5, 6.5]], [[1.5, 6.5], [5.5, 6.5], ...arc(5.5, 3, 4, 3, 90, -90, 10), [2, 0]]] },
  "6": { w: 10, s: [[[9, 11.5], [6.5, 12], [3, 9], [2, 4]], arc(5.2, 3.5, 3.4, 3.5, 0, 360, 16)] },
  "7": { w: 10, s: [[[1.5, 12], [9.5, 12], [4.5, 0]], [[5.5, 7], [8, 7]]] },
  "8": { w: 10, s: [arc(5, 9, 3.6, 3, 0, 360, 14), arc(5, 3, 4, 3, 0, 360, 14)] },
  "9": { w: 10, s: [arc(5, 8.5, 3.6, 3.5, 0, 360, 16), [[8.5, 8], [8.5, 0]]] },
  ".": { w: 5, s: [[[2.5, 0.8]]] },
  ",": { w: 5, s: [[[2.5, 1], [1.5, -2.5]]] },
  ":": { w: 5, s: [[[2.5, 8]], [[2.5, 1]]] },
  ";": { w: 5, s: [[[2.5, 8]], [[2.5, 1], [1.5, -2.5]]] },
  "'": { w: 4, s: [[[2.5, 12], [1.8, 8.5]]] },
  '"': { w: 7, s: [[[2, 12], [1.4, 9]], [[5.5, 12], [4.9, 9]]] },
  "!": { w: 5, s: [[[2.5, 12], [2.5, 4]], [[2.5, 1]]] },
  "?": { w: 9, s: [[...arc(5, 9, 3.5, 3, -10, 200, 12), [4.8, 5.8], [5, 4.5]], [[5, 1]]] },
  "-": { w: 8, s: [[[1, 5], [7, 5]]] },
  "—": { w: 12, s: [[[1, 5], [11, 5]]] },
  "–": { w: 8, s: [[[1, 5], [7, 5]]] },
  "•": { w: 6, s: [[[3, 6]]] },
  "(": { w: 6, s: [arc(4.5, 6, 3, 6, 55, 305, 12)] },
  ")": { w: 6, s: [arc(2, 6, 2.5, 6, 125, 235, 12)] },
  "/": { w: 7, s: [[[1.5, 0], [6, 12]]] },
  "%": { w: 12, s: [[[1.5, 0], [10.5, 12]], arc(3, 9, 2.2, 2.6, 0, 360, 10), arc(9, 3, 2.2, 2.6, 0, 360, 10)] },
  $: { w: 10, s: [[[5, 12.5], [5, -0.5]], [...arc(5.2, 9, 3.4, 2.6, 30, 240, 10), ...arc(4.8, 3, 3.4, 2.6, 60, -180, 10)]] },
  "&": { w: 11, s: [arc(5.5, 9, 3, 2.8, 20, 290, 12), [[9, 12], [2.5, 0]], arc(5, 3, 2.8, 2.6, 180, 360, 10)] },
  "+": { w: 9, s: [[[4.5, 1], [4.5, 11]], [[0.5, 6], [8.5, 6]]] },
  "=": { w: 9, s: [[[1, 4], [8, 4]], [[1, 8], [8, 8]]] },
  " ": { w: 4, s: [] },
};

const XS = 0.82; // condensed horizontal scale for newspaper type

function glyphWidth(ch: string, size: number): number {
  const g = G[ch];
  if (!g) return (8 * XS * size) / 12;
  return (g.w * XS * size) / 12;
}

function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += glyphWidth(ch, size);
  return w;
}

// Draw one string, baseline at (x, yBase). Returns the x after the last glyph.
function drawText(s: string, x: number, yBase: number, size: number, c: RGB, bold = false): number {
  const sc = size / 12;
  const sw = size * (bold ? 0.125 : 0.088);
  let pen = x;
  for (const ch of s) {
    const g = G[ch];
    if (g) {
      for (const stroke of g.s) {
        if (stroke.length === 1) {
          disc(pen + stroke[0][0] * XS * sc, yBase - stroke[0][1] * sc, Math.max(sw / 2, size * 0.075), c);
        } else if (stroke.length > 1) {
          const pts: Pt[] = stroke.map((p) => [pen + p[0] * XS * sc, yBase - p[1] * sc]);
          polyline(pts, sw, c);
        }
      }
      pen += (g.w * XS * sc);
    } else {
      pen += (8 * XS * sc);
    }
  }
  return pen;
}

function drawTextCentered(s: string, cx: number, yBase: number, size: number, c: RGB, bold = false): void {
  drawText(s, cx - textWidth(s, size) / 2, yBase, size, c, bold);
}

function wrapLines(s: string, size: number, maxW: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (textWidth(trial, size) <= maxW || !cur) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Rich line: bold label prefix, then regular text, wrapped to maxW.
// Returns the number of lines drawn.
function drawRich(label: string, text: string, x: number, yBase: number, size: number, maxW: number, c: RGB, labelColor: RGB): number {
  const words = text.split(" ");
  const labelW = textWidth(label, size);
  const lines: { label: boolean; s: string }[] = [];
  let cur = "";
  let first = true;
  for (const w of words) {
    const budget = first ? maxW - labelW : maxW;
    const trial = cur ? cur + " " + w : w;
    if (textWidth(trial, size) <= budget || !cur) {
      cur = trial;
    } else {
      lines.push({ label: first, s: cur });
      cur = w;
      first = false;
    }
  }
  if (cur) lines.push({ label: first, s: cur });
  const leading = size * 1.2;
  lines.forEach((ln, i) => {
    const y = yBase + i * leading;
    if (ln.label) {
      const after = drawText(label, x, y, size, labelColor, true);
      drawText(ln.s, after, y, size, c, false);
    } else {
      drawText(ln.s, x, y, size, c, false);
    }
  });
  return lines.length;
}

// ------------------------------------------------------- illustrations
function mine(cx: number, cy: number, r: number): void {
  disc(cx, cy, r, INK);
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    thickLine(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7, cx + Math.cos(a) * (r + 5), cy + Math.sin(a) * (r + 5), 2.5, INK);
  }
  disc(cx - r * 0.3, cy - r * 0.3, r * 0.3, [70, 70, 72]);
}

function tanker(x0: number, x1: number, waterY: number, deckY: number, superX: number, superW: number, burning: boolean): void {
  // Hull with a raked bow (bow to the right).
  fillPoly([[x0, waterY], [x1, waterY], [x1 + 18, (waterY + deckY) / 2], [x1, deckY], [x0, deckY]], [38, 38, 42]);
  rect(x0, deckY - 2, x1 - x0, 2, [90, 40, 30]);
  // Superstructure.
  rect(superX, deckY - 26, superW, 26, [232, 228, 216]);
  for (let i = 0; i < 3; i++) rect(superX + 6 + i * 14, deckY - 20, 8, 8, [40, 52, 66]);
  // Funnel.
  rect(superX + superW - 12, deckY - 38, 10, 12, [120, 40, 30]);
  if (burning) {
    // Flame on the forward deck.
    fillPoly([[superX - 34, deckY - 2], [superX - 22, deckY - 30], [superX - 10, deckY - 2]], ORANGE);
    fillPoly([[superX - 29, deckY - 2], [superX - 22, deckY - 20], [superX - 15, deckY - 2]], [242, 211, 138]);
    // Smoke column rising from the fire.
    disc(superX - 22, deckY - 36, 9, GREY);
    disc(superX - 26, deckY - 54, 12, [105, 105, 101]);
    disc(superX - 18, deckY - 72, 15, GREY);
    disc(superX - 24, deckY - 92, 17, [96, 96, 92]);
  } else {
    disc(superX + superW - 7, deckY - 44, 7, GREY);
    disc(superX + superW - 10, deckY - 58, 9, [105, 105, 101]);
  }
}

function drawLead(): void {
  const x0 = 28;
  const x1 = 996;
  const y0 = 230;
  const y1 = 420;
  const horizon = 342;
  rect(x0, y0, x1 - x0, horizon - y0, SKY);
  rect(x0, horizon, x1 - x0, y1 - horizon, SEA);
  rect(x0, horizon - 1, x1 - x0, 2, SEA_DARK);
  // Sun and clouds.
  disc(918, 272, 24, [242, 211, 138]);
  ellipse(150, 262, 46, 10, [226, 234, 238]);
  ellipse(420, 252, 38, 9, [226, 234, 238]);
  // US jets with contrails, upper right of the sky.
  for (const [jx, jy] of [[600, 268], [672, 252]] as Pt[]) {
    thickLine(jx - 64, jy + 10, jx - 14, jy + 2, 2, [240, 244, 246]);
    fillPoly([[jx - 12, jy], [jx + 12, jy + 4], [jx - 12, jy + 8]], INK);
    fillPoly([[jx - 4, jy + 2], [jx + 2, jy - 8], [jx + 6, jy + 3]], INK);
  }
  drawText("U.S. JETS", 596, 296, 12, INK, true);
  // Tankers.
  tanker(96, 332, 388, 362, 270, 48, true);
  tanker(560, 748, 392, 368, 700, 40, false);
  // Sea mines, kept well clear of the labels.
  mine(430, 372, 7);
  mine(800, 366, 7);
  mine(180, 398, 6);
  // Wave marks.
  for (const [wx, wy] of [[120, 402], [380, 408], [520, 400], [700, 406], [860, 402]] as Pt[]) {
    polyline([[wx, wy], [wx + 14, wy - 3], [wx + 28, wy]], 2, [150, 190, 205]);
  }
  // Oman landmass, bottom right.
  fillPoly([[830, y1], [x1, y1], [x1, 376], [900, 376], [860, 392], [830, 404]], SAND);
  drawText("OMAN", 902, 406, 15, INK, true);
  // Sea label, white on the dark water, far from the mines.
  drawTextCentered("STRAIT OF HORMUZ", 500, 412, 15, WHITE, true);
}

function drawNvidia(colX: number): void {
  const y0 = 600;
  const y1 = 730;
  rect(colX, y0, 312, y1 - y0, [238, 240, 230]);
  for (const gy of [630, 660, 690, 720]) rect(colX, gy, 312, 1, [213, 216, 204]);
  // Chip.
  rect(56, 640, 72, 66, [35, 38, 43]);
  rect(66, 650, 52, 46, [58, 63, 69]);
  for (let i = 0; i < 4; i++) {
    rect(60 + i * 18, 632, 6, 8, [35, 38, 43]);
    rect(60 + i * 18, 706, 6, 8, [35, 38, 43]);
  }
  drawTextCentered("NV", 92, 682, 16, WHITE, true);
  // Rising chart with arrowhead.
  polyline([[150, 712], [190, 690], [225, 696], [265, 660], [300, 640], [330, 618]], 4, GREEN);
  fillPoly([[330, 618], [314, 616], [326, 632]], GREEN);
  drawText("+33%", 196, 634, 26, GREEN, true);
  drawText("NASDAQ +6%  •  S&P 500 +4%", 40, 726, 12, INK, false);
}

function drawLibya(colX: number): void {
  const y0 = 600;
  const y1 = 730;
  const horizon = 668;
  rect(colX, y0, 312, horizon - y0, SKY);
  rect(colX, horizon, 312, y1 - horizon, [36, 80, 107]);
  rect(colX, horizon - 1, 312, 2, SEA_DARK);
  // Explosion plume: kept entirely ABOVE the horizon (lowest puff ends
  // 5 px above the horizon line) so the horizon stays clean and readable,
  // and clustered over the bow with a flame on the deck to tie it to the ship.
  disc(968, 650, 12, ORANGE);
  disc(978, 640, 13, [242, 150, 60]);
  disc(962, 632, 10, ORANGE);
  disc(984, 628, 9, [242, 211, 138]);
  disc(972, 618, 8, [90, 90, 88]);
  fillPoly([[972, 684], [982, 672], [992, 684]], ORANGE);
  // Corvette: hull ~294 px wide, mast, funnel, turret, gun.
  const hullX0 = 700;
  const hullX1 = 994;
  fillPoly([[hullX0, 700], [hullX1, 700], [hullX1, 684], [hullX0, 690]], [35, 38, 43]);
  rect(810, 662, 74, 24, [58, 63, 69]);
  rect(846, 640, 4, 24, [35, 38, 43]);
  rect(838, 646, 20, 3, [35, 38, 43]);
  rect(896, 654, 20, 32, [47, 51, 56]);
  rect(896, 654, 20, 5, [120, 40, 30]);
  rect(716, 672, 40, 14, [58, 63, 69]);
  thickLine(716, 676, 694, 670, 3, [35, 38, 43]);
  // Wake.
  polyline([[690, 704], [700, 708], [716, 706]], 2, [190, 215, 225]);
  polyline([[686, 712], [700, 716], [718, 714]], 2, [150, 190, 205]);
  // Sea drone, bigger than v3: 52 px long, with a dotted approach path.
  for (const [dx, dy] of [[700, 716], [688, 718], [676, 720]] as Pt[]) disc(dx, dy, 1.6, [220, 230, 235]);
  fillPoly([[716, 714], [762, 714], [768, 719], [716, 719]], [25, 28, 32]);
  thickLine(740, 714, 740, 706, 2, [25, 28, 32]);
  disc(740, 705, 2.5, ORANGE);
  drawText("OFF BENGHAZI", 884, 724, 12, WHITE, true);
  // LIBYA pill, fully over the sky.
  rect(692, 604, 64, 24, NAVY);
  drawTextCentered("LIBYA", 724, 622, 16, WHITE, true);
}

function drawEstonia(colX: number): void {
  const y0 = 600;
  const y1 = 730;
  rect(colX, y0, 312, 60, SKY);
  rect(colX, 660, 312, 70, [125, 138, 106]);
  rect(colX, 660, 312, 4, [96, 108, 82]);
  // Flagpoles and flags.
  rect(398, 606, 4, 84, [60, 58, 54]);
  rect(402, 606, 40, 12, [0, 114, 206]); // Estonia: blue
  rect(402, 618, 40, 12, INK); // black
  rect(402, 630, 40, 12, WHITE); // white
  rect(604, 606, 4, 84, [60, 58, 54]);
  rect(608, 606, 40, 12, WHITE); // Russia: white
  rect(608, 618, 40, 12, [0, 57, 166]); // blue
  rect(608, 630, 40, 12, [213, 0, 50]); // red
  // Border barrier: striped rails on posts.
  for (const px0 of [372, 470, 566, 640]) rect(px0, 664, 6, 36, [60, 58, 54]);
  for (let i = 0; i < 22; i++) {
    const sx = 372 + i * 13;
    rect(sx, 672, 13, 4, i % 2 === 0 ? [179, 64, 47] : [240, 234, 216]);
    rect(sx, 686, 13, 4, i % 2 === 0 ? [240, 234, 216] : [179, 64, 47]);
  }
  // Country labels on the ground, well away from the poles (poles end at
  // y 690; labels sit at baseline 722, 18 px below the pole bases).
  drawText("ESTONIA", 366, 722, 14, INK, true);
  const rw = textWidth("RUSSIA", 14);
  drawText("RUSSIA", 658 - rw, 722, 14, INK, true);
}

// ---------------------------------------------------------------- page
function pillLabel(text: string, x: number, y: number, c: RGB): void {
  const w = textWidth(text, 16) + 22;
  rect(x, y, w, 26, c);
  drawTextCentered(text, x + w / 2, y + 19, 16, WHITE, true);
}

function drawPage(): void {
  fillAll(PAPER);
  // Masthead.
  drawTextCentered("THE WORLD", 512, 102, 92, INK, true);
  drawTextCentered("TUESDAY, 24 NOVEMBER 2026 • IN ONE IMAGE", 512, 130, 17, INK, false);
  rect(28, 142, 968, 3, INK);
  rect(28, 148, 968, 1, INK);
  // Lead.
  drawText("STRAIT OF HORMUZ • LEAD", 28, 176, 16, RED, true);
  drawText("MINES IN THE STRAIT OF HORMUZ", 28, 216, 36, INK, true);
  drawLead();
  const leadFacts = [
    "3 tankers hit by sea mines in the Strait of Hormuz, burning, under US air escort.",
    "Claim unverified. Qatar PM mediates in Washington; US sanctions 22 firms, 8 people.",
    "$14.7bn shadow-banking deals. Threat 'severe'; new attacks 'highly likely' — JMIC.",
  ];
  leadFacts.forEach((f, i) => drawText(f, 28, 456 + i * 36, 19, INK, false));
  rect(28, 552, 968, 2, INK);
  // Secondaries.
  const cols = [28, 356, 684];
  pillLabel("NVIDIA", cols[0], 566, GREEN);
  pillLabel("ESTONIA", cols[1], 566, RED);
  // LIBYA pill is drawn inside its own illustration (navy, over the sky).
  drawNvidia(cols[0]);
  drawEstonia(cols[1]);
  drawLibya(cols[2]);
  drawText("HUANG BACK AS CEO", cols[0], 762, 23, INK, true);
  drawText("WAR WARNING", cols[1], 762, 23, INK, true);
  drawText("DRONE SINKS CORVETTE", cols[2], 762, 21, INK, true);
  const secFacts = [
    "Board restores Jensen Huang as CEO 11 days after he quit; shares +33%, Nasdaq +6%, S&P +4%.",
    "Russia: Estonia is 'on the verge of triggering open war'; Tallinn shuts border from 1 Dec.",
    "7 Ukrainian drones sink Russian corvette Merkury off Benghazi; MV Angara also hit.",
  ];
  secFacts.forEach((f, ci) => {
    const lines = wrapLines(f, 16.5, 312);
    lines.forEach((ln, li) => drawText(ln, cols[ci], 788 + li * 21, 16.5, INK, false));
  });
  // Footer: IN BRIEF.
  rect(28, 850, 968, 2, INK);
  drawText("IN BRIEF", 28, 878, 19, RED, true);
  const briefs: [string, string][] = [
    ["GAZA — ", "Israeli strikes kill at least 3, incl. UNRWA worker Adel al-Helo at a Jabalia well."],
    ["INDONESIA — ", "26 body bags identified, 28 still missing after Banten candy-factory fire."],
    ["MEGASPEED — ", "US blacklists 7 firms in Nvidia spy case."],
    ["ZELENSKY — ", "Zelensky seeks 4-party talks with Russia, US, Europe 'as soon as possible'."],
    ["KORSEL — ", "Russian plane enters air defence zone; jets scrambled."],
    ["BANGLADESH — ", "Mass typhoid vaccination of 50m children begins."],
  ];
  const briefY = [900, 946, 992];
  briefs.forEach((b, i) => {
    const colX = i % 2 === 0 ? 28 : 526;
    const row = Math.floor(i / 2);
    drawRich(b[0], b[1], colX, briefY[row], 17.5, 468, INK, RED);
  });
}

// ---------------------------------------------------------------- dossier
const dossier = {
  title: "THE WORLD — Tuesday, 24 November 2026",
  version: "v4",
  bounty: "news-image-20261124",
  image: { width: 1024, height: 1024, file: "entry.png" },
  facts: [
    {
      story: "Strait of Hormuz (lead)",
      headline: "MINES IN THE STRAIT OF HORMUZ",
      lines: [
        "3 tankers hit by sea mines in the Strait of Hormuz, burning, under US air escort.",
        "Claim unverified. Qatar PM mediates in Washington; US sanctions 22 firms, 8 people.",
        "$14.7bn shadow-banking deals. Threat 'severe'; new attacks 'highly likely' — JMIC.",
        "Qatar: the region 'could not withstand another escalation'.",
      ],
      sources: [
        "IRGC claim of 3 tankers hit by sea mines, burning, under US air escort; claim not independently verified",
        "Qatar PM mediation in Washington (met VP Vance and Secretary of State Rubio); Qatar quote on escalation",
        "US Treasury sanctions on 22 companies and 8 people linked to Iran shadow banking; $14.7bn in suspicious transactions",
        "JMIC assessment: threat 'severe', further attacks 'highly likely'",
      ],
    },
    {
      story: "Nvidia",
      headline: "HUANG BACK AS CEO",
      lines: [
        "Board restores Jensen Huang as CEO 11 days after he quit; shares +33%, Nasdaq +6%, S&P +4%.",
        "Trump pressed the board; the board said 'no national security risk' after US government input.",
      ],
      sources: ["Nvidia board decision returning Jensen Huang as CEO 11 days after his exit; market moves +33% shares, Nasdaq +6%, S&P 500 +4%; board statement after US government input"],
    },
    {
      story: "Libya",
      headline: "DRONE SINKS CORVETTE",
      lines: [
        "7 Ukrainian drones sink Russian corvette Merkury off Benghazi; MV Angara also hit.",
        "Zelensky: 7 drones used, a Ka-27 helicopter also destroyed; UNSMIL calls for an independent, immediate, transparent investigation.",
      ],
      sources: ["Ukrainian sea drone sinking of Russian corvette Merkury at Benghazi and strike on cargo ship MV Angara; Zelensky statement (7 drones, Ka-27 destroyed); UNSMIL call for investigation"],
    },
    {
      story: "Estonia",
      headline: "WAR WARNING",
      lines: [
        "Russia: Estonia is 'on the verge of triggering open war' as Tallinn shuts its land border from 1 Dec.",
        "Border closure for at least 6 months; Estonia denies letting its territory be used for another state's military operations.",
      ],
      sources: ["Russian Foreign Ministry statement on Estonia; Tallinn announcement closing the land border from 1 December for at least 6 months; Estonian denial"],
    },
  ],
  brief: [
    "GAZA — Israeli strikes kill at least 3, incl. UNRWA worker Adel al-Helo at a Jabalia well.",
    "INDONESIA — 26 body bags identified, 28 still missing after Banten candy-factory fire.",
    "MEGASPEED — US blacklists 7 firms in Nvidia spy case.",
    "ZELENSKY — Zelensky seeks 4-party talks with Russia, US, Europe 'as soon as possible'.",
    "KORSEL — Russian plane enters air defence zone; jets scrambled.",
    "BANGLADESH — Mass typhoid vaccination of 50m children begins.",
  ],
  notes: [
    "v4 vs v3: smoother vector glyphs (S, G, Q, & drawn as true arcs); Libya explosion plume kept entirely above the horizon line; sea drone enlarged to 52 px with dotted approach path; ESTONIA/RUSSIA labels moved to the ground, clear of the flagpoles; fact and brief lines shortened for 300 px thumbnail legibility.",
    "All facts are events of, or first reported on, Tuesday 24 November 2026. No new stories added in v4; image text is a shortened rendering of the same facts, full wording in this dossier.",
    "Deterministic: no network, no clock, no randomness; two runs write identical bytes.",
  ],
};

// ---------------------------------------------------------------- main
function main(): void {
  drawPage();
  fs.mkdirSync("/output", { recursive: true });
  fs.writeFileSync("/output/entry.png", encodePNG());
  fs.writeFileSync("/output/dossier.json", JSON.stringify(dossier, null, 2) + "\n");
}

main();
