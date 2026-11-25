// THE WORLD — Tuesday, 24 November 2026. A one-image newspaper front page.
// Fresh build for make.fun news-image-20261124 (v6). Node 22 stdlib only.
// Deterministic: fixed seeds, no network, no clock, no randomness outside the
// seeded generator below. Writes entry.png (1024x1024, <= 1 MiB) and a
// dossier.json with the facts and their sources into the output directory.
// Run: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 1024;
const H = 1024;
const SS = 2; // supersampling factor
const SW = W * SS;
const SH = H * SS;
const buf = new Uint8ClampedArray(SW * SH * 3);

// ---------------------------------------------------------------- colors
type RGB = [number, number, number];
function hex(h: string): RGB {
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
}
const PAPER = hex("#f6f0e1");
const INK = hex("#1b1815");
const SOFT = hex("#3a352e");
const RED = hex("#a63a2a");
const NAVY = hex("#20405e");
const GOLD = hex("#d9a441");
const SKY = hex("#dde7e9");
const SKY2 = hex("#cfdde0");
const SEA = hex("#2e5a74");
const SEA2 = hex("#3a6a84");
const SEA3 = hex("#27506a");
const WAVE = hex("#8fb8c8");
const SAND = hex("#d9c49a");
const SANDLINE = hex("#b39a6d");
const HULL = hex("#333f47");
const STEEL_L = hex("#a9b4b9");
const STEEL_M = hex("#75838b");
const STEEL_D = hex("#46545d");
const DECK_L = hex("#ccd3d6");
const FUNNEL = hex("#d8c9a3");
const CHIP = hex("#1d4e89");
const CHIP2 = hex("#2a63a8");
const GREEN = hex("#2e7d4f");
const CREAM = hex("#f2ede0");
const SMOKE = [
  hex("#b3ac9c"),
  hex("#a29b8a"),
  hex("#c6bfb0"),
  hex("#948d7d"),
  hex("#bfb8a6"),
];
const HAZE = hex("#d8d2c2");
const WISP = hex("#9a937f");
const CORE = hex("#8f887a");

// ---------------------------------------------------------------- prng
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- raster
// All drawing functions take FINAL (1024-space) coordinates, like v5's fix:
// primitives and callers share one coordinate system, no raw-buffer mixes.
function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.round(x * SS));
  const y0 = Math.max(0, Math.round(y * SS));
  const x1 = Math.min(SW, Math.round((x + w) * SS));
  const y1 = Math.min(SH, Math.round((y + h) * SS));
  for (let yy = y0; yy < y1; yy++) {
    let idx = (yy * SW + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      buf[idx] = c[0];
      buf[idx + 1] = c[1];
      buf[idx + 2] = c[2];
      idx += 3;
    }
  }
}

function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  if (rx <= 0 || ry <= 0) return;
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(H - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - cy) / ry;
    if (Math.abs(dy) >= 1) continue;
    const dx = rx * Math.sqrt(1 - dy * dy);
    fillRect(cx - dx, y, dx * 2, 1, c);
  }
}

function disc(cx: number, cy: number, r: number, c: RGB): void {
  ellipse(cx, cy, r, r, c);
}

function poly(pts: number[][], c: RGB): void {
  if (pts.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(H - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      fillRect(xs[k], y, xs[k + 1] - xs[k], 1, c);
    }
  }
}

function seg(x1: number, y1: number, x2: number, y2: number, w: number, c: RGB): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) {
    disc(x1, y1, w / 2, c);
    return;
  }
  const nx = (-dy / len) * (w / 2);
  const ny = (dx / len) * (w / 2);
  poly(
    [
      [x1 + nx, y1 + ny],
      [x2 + nx, y2 + ny],
      [x2 - nx, y2 - ny],
      [x1 - nx, y1 - ny],
    ],
    c
  );
  disc(x1, y1, w / 2, c);
  disc(x2, y2, w / 2, c);
}

function polyline(pts: number[][], w: number, c: RGB): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    seg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, c);
  }
}

function rrect(x: number, y: number, w: number, h: number, r: number, c: RGB): void {
  fillRect(x + r, y, w - 2 * r, h, c);
  fillRect(x, y + r, w, h - 2 * r, c);
  disc(x + r, y + r, r, c);
  disc(x + w - r, y + r, r, c);
  disc(x + r, y + h - r, r, c);
  disc(x + w - r, y + h - r, r, c);
}

// ---------------------------------------------------------------- font
// Vector stroke font, drawn fresh here. Glyph space: 10 units wide,
// 14 units tall; cap top y=1, baseline y=12, x-height top y=5.5,
// descenders to y=15. Strokes are polylines; closed loops repeat the
// first point at the end. Letters are drawn as THICK filled strokes
// (not outlines) so the masthead reads as bold serif, with small slab
// feet added on vertical stems when serif is on.
function ell(cx: number, cy: number, rx: number, ry: number, n: number): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

type Glyph = [number, number[][][]];
const FONT: Record<string, Glyph> = {
  A: [10.5, [[[0, 12], [5, 1], [10, 12]], [[3, 8], [7, 8]]]],
  B: [10, [[[1, 1], [1, 12]], [[1, 1], [6.5, 1], [9, 3], [9, 5], [7, 6.5], [1, 6.5]], [[1, 6.5], [7, 6.5], [9.5, 8.5], [9.5, 10], [7, 12], [1, 12]]]],
  C: [10, [[[9, 3], [7, 1], [3, 1], [1, 4], [1, 9], [3, 12], [7, 12], [9, 10]]]],
  D: [10.5, [[[1, 1], [1, 12]], [[1, 1], [7, 1], [9.5, 3], [9.5, 10], [7, 12], [1, 12]]]],
  E: [9, [[[1, 1], [1, 12]], [[1, 1], [9, 1]], [[1, 6.5], [7, 6.5]], [[1, 12], [9, 12]]]],
  F: [9, [[[1, 1], [1, 12]], [[1, 1], [9, 1]], [[1, 6.5], [7, 6.5]]]],
  G: [10.5, [[[9, 3], [7, 1], [3, 1], [1, 4], [1, 9], [3, 12], [7, 12], [9, 10], [9, 7], [6, 7]]]],
  H: [10, [[[1, 1], [1, 12]], [[9, 1], [9, 12]], [[1, 6.5], [9, 6.5]]]],
  I: [5.5, [[[2.75, 1], [2.75, 12]], [[0.8, 1], [4.7, 1]], [[0.8, 12], [4.7, 12]]]],
  J: [7, [[[7, 1], [7, 10.5], [5.5, 12], [2.5, 12], [1, 10]]]],
  K: [10, [[[1, 1], [1, 12]], [[8.5, 1], [1, 7]], [[3, 6], [9, 12]]]],
  L: [9, [[[1, 1], [1, 12]], [[1, 12], [9, 12]]]],
  M: [10.5, [[[1, 12], [1, 1], [5, 8], [9, 1], [9, 12]]]],
  N: [10, [[[1, 12], [1, 1], [9, 12], [9, 1]]]],
  O: [10.5, [ell(5, 6.5, 4.3, 5.5, 18)]],
  P: [10, [[[1, 1], [1, 12]], [[1, 1], [7, 1], [9, 3], [9, 5], [7, 6.5], [1, 6.5]]]],
  Q: [10.5, [ell(5, 6.5, 4.3, 5.5, 18), [[6.5, 9], [9.5, 13]]]],
  R: [10, [[[1, 1], [1, 12]], [[1, 1], [7, 1], [9, 3], [9, 5], [7, 6.5], [1, 6.5]], [[4.5, 6.5], [9, 12]]]],
  S: [10, [[[8.5, 3], [6.5, 1], [3, 1.5], [1.5, 4], [2.5, 6], [5, 7], [7.5, 8], [8.5, 9.5], [7.5, 12], [4.5, 12.5], [2, 11.5]]]],
  T: [9.5, [[[1, 1], [9, 1]], [[5, 1], [5, 12]]]],
  U: [10, [[[1, 1], [1, 9], [2.5, 12], [7.5, 12], [9, 9], [9, 1]]]],
  V: [10, [[[0.5, 1], [5, 12], [9.5, 1]]]],
  W: [11.5, [[[0.5, 1], [2.5, 12], [5, 5], [7.5, 12], [9.5, 1]]]],
  X: [10, [[[1, 1], [9, 12]], [[9, 1], [1, 12]]]],
  Y: [10, [[[0.5, 1], [5, 6.5], [9.5, 1]], [[5, 6.5], [5, 12]]]],
  Z: [10, [[[1, 1], [9, 1]], [[9, 1], [1, 12]], [[1, 12], [9, 12]]]],
  a: [9, [[[8.5, 5], [8.5, 12]], [[8.5, 8.5], [6.5, 5.5], [3.5, 5.5], [1.5, 7.5], [1.5, 10], [3.5, 12], [6.5, 12], [8.5, 10]]]],
  b: [9, [[[1.5, 1], [1.5, 12]], [[1.5, 8.5], [3, 5.5], [6, 5.5], [8, 7.5], [8, 10], [6, 12], [3, 12], [1.5, 10]]]],
  c: [8.5, [[[8, 7], [6, 5.5], [3, 5.5], [1.5, 7.5], [1.5, 10], [3, 12], [6, 12], [8, 10.5]]]],
  d: [9, [[[8.5, 1], [8.5, 12]], [[8.5, 8.5], [7, 5.5], [4, 5.5], [2, 7.5], [2, 10], [4, 12], [7, 12], [8.5, 10]]]],
  e: [9, [[[1.5, 8.5], [8.5, 8.5]], [[8.5, 9.5], [6.5, 5.5], [3.5, 5.5], [1.5, 7.5], [1.5, 10], [3, 12], [6, 12], [8.5, 10]]]],
  f: [5.5, [[[4.5, 1], [2.5, 1.5], [2, 3], [2, 12]], [[1, 4.5], [5, 4.5]]]],
  g: [9, [[[8.5, 5], [8.5, 13], [6, 15], [3, 15], [1.5, 13.5]], [[8.5, 8.5], [6.5, 5.5], [3.5, 5.5], [1.5, 7.5], [1.5, 10], [3, 12], [6, 12], [8.5, 10]]]],
  h: [9, [[[1.5, 1], [1.5, 12]], [[1.5, 8], [3, 5.5], [6, 5.5], [8, 7.5], [8, 12]]]],
  i: [4, [[[2, 5.5], [2, 12]], [[2, 2.2], [2, 2.8]]]],
  j: [4.5, [[[3, 5.5], [3, 12], [2.5, 14], [0.5, 14]], [[3, 2.2], [3, 2.8]]]],
  k: [9, [[[1.5, 1], [1.5, 12]], [[7.5, 5.5], [2, 9]], [[3.5, 8], [8, 12]]]],
  l: [4, [[[2, 1], [2, 12]]]],
  m: [9.5, [[[1.5, 12], [1.5, 6], [3.5, 5.5], [5, 6.5], [5, 12]], [[5, 6.5], [6.5, 5.5], [8.5, 6.5], [8.5, 12]]]],
  n: [9, [[[1.5, 12], [1.5, 6], [3.5, 5.5], [6.5, 6.5], [8, 8], [8, 12]]]],
  o: [9, [ell(5, 8.75, 3.5, 3.25, 14)]],
  p: [9, [[[1.5, 5.5], [1.5, 15]], [[1.5, 8.5], [3, 5.5], [6, 5.5], [8, 7.5], [8, 10], [6, 12], [3, 12], [1.5, 10]]]],
  q: [9, [[[8.5, 5.5], [8.5, 15]], [[8.5, 8.5], [7, 5.5], [4, 5.5], [2, 7.5], [2, 10], [4, 12], [7, 12], [8.5, 10]]]],
  r: [8, [[[1.5, 12], [1.5, 5.5]], [[1.5, 7.5], [3.5, 5.5], [6, 5.5], [7.5, 7]]]],
  s: [9, [[[7.5, 7], [6, 5.5], [3.5, 5.5], [2, 7], [2.8, 8.8], [5, 9.5], [7, 10.2], [7.5, 11], [6, 12.5], [3.5, 12.5], [2, 11]]]],
  t: [8.5, [[[4, 2.5], [6, 1.5], [6, 11], [5, 12.5], [3, 12.5]], [[2, 5.5], [8.5, 5.5]]]],
  u: [9, [[[1.5, 5.5], [1.5, 10], [3, 12], [6, 12], [8, 10], [8, 5.5]]]],
  v: [9, [[[1, 5.5], [4.5, 12], [8, 5.5]]]],
  w: [10.5, [[[0.5, 5.5], [2.5, 12], [5, 8], [7.5, 12], [9.5, 5.5]]]],
  x: [9, [[[1.5, 5.5], [8, 12]], [[8, 5.5], [1.5, 12]]]],
  y: [9, [[[1, 5.5], [4.5, 12], [8, 5.5]], [[4.5, 12], [4, 14.5], [2, 15]]]],
  z: [9, [[[1.5, 5.5], [8, 5.5]], [[8, 5.5], [1.5, 12]], [[1.5, 12], [8, 12]]]],
  "0": [10.5, [ell(5, 6.5, 4.2, 5.5, 18)]],
  "1": [7, [[[3, 3.5], [5.5, 1], [5.5, 12]], [[3, 12], [7, 12]]]],
  "2": [10, [[[2, 3], [4, 1], [7, 1], [8.5, 3], [8.5, 5], [3, 12], [8.5, 12]]]],
  "3": [10, [[[2, 3], [4, 1], [7, 1], [8.5, 3], [7, 6.5], [8.5, 9], [7, 12], [4, 12], [2, 10]]]],
  "4": [10, [[[1, 8], [7, 1], [7, 12]], [[1, 8], [9, 8]]]],
  "5": [10, [[[8.5, 1], [2, 1], [2, 6], [4, 6], [7, 6], [8.5, 8], [8.5, 10], [7, 12], [3.5, 12], [2, 10.5]]]],
  "6": [10, [[[8, 3], [6, 1], [3, 1.5], [1.5, 4], [1.5, 9], [3, 12], [7, 12], [8.5, 10], [8.5, 8], [6.5, 6.5], [3, 6.5]]]],
  "7": [10, [[[1.5, 1], [8.5, 1], [5, 12]]]],
  "8": [10, [ell(5, 4, 3.3, 2.8, 14), ell(5, 9.5, 3.8, 3, 14)]],
  "9": [10, [[[2, 9], [2, 6], [3.5, 2], [6, 1], [8.5, 2], [8.5, 5], [8.5, 10], [6, 12], [3, 12], [1.5, 10]]]],
  ".": [4, [[[2, 11.8], [2, 12.2]]]],
  ",": [4, [[[2, 12], [1, 14.5]]]],
  ":": [4, [[[2, 4.8], [2, 5.2]], [[2, 11.8], [2, 12.2]]]],
  ";": [4, [[[2, 4.8], [2, 5.2]], [[2, 12], [1, 14.5]]]],
  "'": [4, [[[2.5, 1], [1.8, 4]]]],
  '"': [5.5, [[[2.5, 1], [1.8, 4]], [[4.8, 1], [4.1, 4]]]],
  "-": [6, [[[0.8, 7], [5.2, 7]]]],
  "–": [8, [[[0.8, 7], [7.2, 7]]]],
  "—": [10, [[[0.5, 7], [9.5, 7]]]],
  "·": [4, [[[2, 6.8], [2, 7.2]]]],
  "•": [6, [ell(3, 7, 1.6, 1.6, 10)]],
  "/": [7, [[[6, 1], [2, 12]]]],
  "%": [11, [[[8, 1], [2, 12]], ell(3, 4, 1.7, 1.7, 10), ell(7, 9.5, 1.7, 1.7, 10)]],
  "+": [10, [[[5, 3], [5, 11]], [[1, 7], [9, 7]]]],
  $: [10, [[[5, 0], [5, 13]], [[8, 3], [6, 1], [3, 1], [1.5, 3], [2, 5], [5, 6], [8, 7], [8.5, 9], [7, 11], [4, 12], [2, 11]]]],
  "&": [10, [[[7, 1.5], [4, 1.5], [2, 3.5], [2.5, 6], [5, 7.5], [8, 8.5], [8.5, 11], [6.5, 12.5], [3.5, 12.5]], [[2.5, 6], [8, 12.5]]]],
  "(": [7, [[[6, 1], [3.5, 3], [2.5, 6.5], [3.5, 10], [6, 12]]]],
  ")": [7, [[[1, 1], [3.5, 3], [4.5, 6.5], [3.5, 10], [1, 12]]]],
  "!": [4.5, [[[2.25, 1], [2.25, 9]], [[2.25, 11.8], [2.25, 12.2]]]],
  "?": [9, [[[2.5, 3], [4, 1], [7, 1], [8, 5], [8, 6.5], [6, 8.5], [5, 10]], [[5, 11.8], [5, 12.2]]]],
  " ": [5, []],
};

function textWidth(s: string, size: number, weight: number, tracking: number): number {
  const unit = size / 14;
  let w = 0;
  for (const ch of s) {
    const g = FONT[ch] ?? FONT["?"];
    w += g[0] * unit + tracking * unit;
  }
  return w - tracking * unit;
}

function drawText(
  s: string,
  x: number,
  baseline: number,
  size: number,
  o: { color: RGB; weight?: number; serif?: boolean; align?: "left" | "center" | "right"; tracking?: number }
): void {
  const unit = size / 14;
  const wgt = (o.weight ?? 1.6) * unit;
  const track = (o.tracking ?? 0.35) * unit;
  const total = textWidth(s, size, o.weight ?? 1.6, o.tracking ?? 0.35);
  let cx = o.align === "center" ? x - total / 2 : o.align === "right" ? x - total : x;
  for (const ch of s) {
    const g = FONT[ch] ?? FONT["?"];
    const gx0 = cx;
    for (const stroke of g[1]) {
      if (stroke.length === 1) {
        disc(gx0 + stroke[0][0] * unit, baseline + (stroke[0][1] - 12) * unit, wgt * 0.6, o.color);
        continue;
      }
      const pts = stroke.map(([gx, gy]) => [gx0 + gx * unit, baseline + (gy - 12) * unit]);
      polyline(pts, wgt, o.color);
      if (o.serif) {
        // Slab feet on vertical stems, only at cap top / baseline ends.
        for (let i = 0; i + 1 < stroke.length; i++) {
          const ax = stroke[i][0];
          const ay = stroke[i][1];
          const bx = stroke[i + 1][0];
          const by = stroke[i + 1][1];
          if (Math.abs(bx - ax) <= 1.0 && Math.abs(by - ay) >= 5) {
            for (const [ex, ey] of [[ax, ay], [bx, by]] as const) {
              if (ey <= 2.2 || ey >= 11.6) {
                const exx = gx0 + ex * unit;
                const eyy = baseline + (ey - 12) * unit;
                seg(exx - 1.7 * unit, eyy, exx + 1.7 * unit, eyy, 1.15 * unit, o.color);
              }
            }
          }
        }
      }
    }
    cx += g[0] * unit + track;
  }
}

function wrapText(s: string, size: number, maxW: number, weight: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? cur + " " + word : word;
    if (textWidth(test, size, weight, 0.35) <= maxW || !cur) {
      cur = test;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------- png
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
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG(): Buffer {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const idx = ((y * SS + sy) * SW + (x * SS + sx)) * 3;
          r += buf[idx];
          g += buf[idx + 1];
          b += buf[idx + 2];
        }
      }
      const o = y * (1 + W * 3) + 1 + x * 3;
      raw[o] = Math.round(r / (SS * SS));
      raw[o + 1] = Math.round(g / (SS * SS));
      raw[o + 2] = Math.round(b / (SS * SS));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- scenes
function pill(cx: number, cy: number, text: string, size: number, bg: RGB, fg: RGB): void {
  const w = textWidth(text, size, 1.8, 0.35) + size * 1.1;
  const h = size * 1.75;
  rrect(cx - w / 2, cy - h / 2, w, h, h / 2, bg);
  drawText(text, cx, cy + size * 0.36, size, { color: fg, weight: 1.8, align: "center" });
}

function pillLeft(x: number, y: number, text: string, size: number, bg: RGB, fg: RGB): void {
  const w = textWidth(text, size, 1.8, 0.35) + size * 1.1;
  const h = size * 1.75;
  rrect(x, y, w, h, h / 2, bg);
  drawText(text, x + w / 2, y + h / 2 + size * 0.36, size, { color: fg, weight: 1.8, align: "center" });
}

function mine(x: number, y: number): void {
  const rnd = mulberry32(Math.round(x * 7 + y));
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8 + 0.4;
    seg(x, y, x + Math.cos(a) * 10, y + Math.sin(a) * 10, 2.5, INK);
  }
  disc(x, y, 7, INK);
  disc(x - 2, y - 2, 2.5, hex("#5a6a72"));
  void rnd;
}

// v6 smoke: wider spread at the top, much bigger puff-size variation,
// a separation push so puffs never pile into one tight cluster, and
// long curling wisps that stay visible at full zoom.
function plume(cx: number, baseY: number, topY: number, w: number, seed: number, n: number): void {
  const rnd = mulberry32(seed);
  const h = baseY - topY;
  for (let i = 0; i < 3; i++) {
    const t = 0.3 + i * 0.28;
    ellipse(cx + (rnd() - 0.5) * w * 0.4, baseY - t * h, w * (0.5 + rnd() * 0.2), h * 0.16, HAZE);
  }
  const placed: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    let px = cx + Math.sin(t * 5.0 + seed * 0.7) * w * 0.16 + (rnd() - 0.5) * w * (0.25 + 0.55 * t);
    let py = baseY - t * h + (rnd() - 0.5) * h * 0.06;
    const r = w * 0.15 * (0.55 + rnd() * 1.05) * (1 - 0.22 * t);
    for (const p of placed) {
      const dx = px - p.x;
      const dy = py - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const min = (r + p.r) * 0.55;
      if (d < min && d > 0.01) {
        px += (dx / d) * (min - d);
        py += (dy / d) * (min - d) * 0.4;
      }
    }
    px = Math.max(cx - w * 0.8, Math.min(cx + w * 0.8, px));
    py = Math.max(topY - 8, Math.min(baseY + 4, py));
    placed.push({ x: px, y: py, r });
    ellipse(px, py, r * (1.1 + rnd() * 0.35), r * (0.78 + rnd() * 0.4), SMOKE[Math.floor(rnd() * SMOKE.length)]);
    if (rnd() < 0.4) ellipse(px - r * 0.2, py + r * 0.15, r * 0.45, r * 0.35, CORE);
  }
  for (let i = 0; i < 8; i++) {
    const t = 0.25 + rnd() * 0.7;
    const side = rnd() < 0.5 ? -1 : 1;
    let x = cx + side * w * (0.25 + rnd() * 0.3);
    let y = baseY - t * h;
    const pts: number[][] = [];
    for (let k = 0; k < 5; k++) {
      pts.push([x, y]);
      x += side * (6 + rnd() * 14);
      y -= 4 + rnd() * 9;
    }
    polyline(pts, 2.2, WISP);
  }
}

function tanker(x: number, yWater: number, len: number, hullH: number, burning: boolean): void {
  // Hull, raked bow to the right.
  poly(
    [
      [x, yWater - hullH * 0.62],
      [x + len * 0.82, yWater - hullH * 0.62],
      [x + len, yWater - hullH * 0.12],
      [x + len * 0.96, yWater],
      [x, yWater],
    ],
    HULL
  );
  fillRect(x, yWater - hullH * 0.62, len * 0.82, 3, hex("#4a5a63"));
  // Deck cargo: containers.
  const cont: RGB[] = [RED, hex("#c98a2e"), hex("#3f7d5a"), NAVY];
  let cx = x + 8;
  let ci = 0;
  while (cx < x + len * 0.62) {
    const cw = Math.min(34, x + len * 0.62 - cx);
    fillRect(cx, yWater - hullH * 0.62 - 16, cw - 3, 16, cont[ci % cont.length]);
    cx += 34;
    ci++;
  }
  // Bridge tower near the stern, funnel near the bow.
  fillRect(x + 4, yWater - hullH * 0.62 - 34, 26, 34, CREAM);
  fillRect(x + 8, yWater - hullH * 0.62 - 30, 18, 5, hex("#31404a"));
  fillRect(x + len * 0.66, yWater - hullH * 0.62 - 24, 18, 24, RED);
  if (burning) {
    // Flames above the mid deck.
    const fx = x + len * 0.42;
    const fy = yWater - hullH * 0.62 - 16;
    poly([[fx, fy], [fx + 14, fy - 34], [fx + 26, fy - 10], [fx + 38, fy - 26], [fx + 52, fy]], hex("#e2701d"));
    poly([[fx + 10, fy], [fx + 20, fy - 22], [fx + 30, fy - 6], [fx + 40, fy - 16], [fx + 46, fy]], hex("#f2a541"));
    poly([[fx + 18, fy], [fx + 24, fy - 12], [fx + 32, fy]], hex("#c93b1e"));
  }
}

// Corvette with a bright 3-band hull and light, high-contrast deck detail
// so the ship still reads at 300 px thumbnail size.
function corvette(x: number, yWater: number, len: number): void {
  const top = yWater - 26;
  poly([[x, top], [x + len * 0.82, top], [x + len * 0.88, top + 10], [x, top + 10]], STEEL_L);
  poly([[x, top + 10], [x + len * 0.88, top + 10], [x + len * 0.93, top + 18], [x, top + 18]], STEEL_M);
  poly([[x, top + 18], [x + len * 0.93, top + 18], [x + len, top + 12], [x + len * 0.96, top + 26], [x, top + 26]], STEEL_D);
  // Bright waterline + reflection streaks.
  seg(x, yWater, x + len * 0.96, yWater, 3, CREAM);
  seg(x + 12, yWater + 7, x + len * 0.8, yWater + 7, 2, WAVE);
  seg(x + 30, yWater + 13, x + len * 0.62, yWater + 13, 2, WAVE);
  // Superstructure, pale so it stands off the dark hull.
  fillRect(x + 34, top - 22, 72, 22, DECK_L);
  fillRect(x + 38, top - 18, 64, 4, hex("#31404a"));
  // Turret + pale barrel.
  fillRect(x + 118, top - 13, 26, 13, hex("#b9c2c6"));
  seg(x + 144, top - 9, x + 168, top - 13, 4, CREAM);
  // Funnel: light body, gold cap.
  fillRect(x + 176, top - 28, 22, 28, FUNNEL);
  fillRect(x + 176, top - 32, 22, 6, GOLD);
  // Mast + bright radar bar.
  seg(x + 58, top - 22, x + 58, top - 48, 3, CREAM);
  seg(x + 48, top - 46, x + 68, top - 46, 4, CREAM);
  disc(x + 58, top - 48, 3, CREAM);
  // Deck rail line, pale.
  seg(x + 6, top + 1, x + len * 0.8, top + 1, 1.5, CREAM);
}

function seaDrone(x: number, y: number): void {
  poly([[x, y], [x + 48, y], [x + 43, y + 8], [x + 5, y + 8]], hex("#22303a"));
  seg(x + 10, y, x + 10, y - 8, 2.5, hex("#22303a"));
  disc(x + 40, y - 4, 3.5, hex("#ff8c1a"));
  for (let i = 0; i < 6; i++) disc(x - 8 - i * 9, y + 4 + (i % 2), 1.6, hex("#ffd9a0"));
}

// ---------------------------------------------------------------- page
function drawPage(): void {
  fillRect(0, 0, W, H, PAPER);

  // Masthead — thick filled strokes + slab feet: a serif newspaper face.
  drawText("THE WORLD", 512, 112, 92, { color: INK, weight: 2.6, serif: true, align: "center" });
  drawText("TUESDAY, 24 NOVEMBER 2026 • IN ONE IMAGE", 512, 148, 19, {
    color: INK,
    weight: 1.8,
    align: "center",
  });
  fillRect(28, 160, 968, 3, INK);
  fillRect(28, 166, 968, 1, INK);

  // ---- Lead: Strait of Hormuz (illustration 176..428) ----
  fillRect(28, 176, 968, 146, SKY);
  fillRect(28, 176, 968, 40, SKY2);
  fillRect(28, 322, 968, 106, SEA);
  fillRect(28, 322, 968, 26, SEA2);
  fillRect(28, 392, 968, 36, SEA3);
  fillRect(28, 321, 968, 2, hex("#1b3a4d"));
  // Wave strokes.
  const wrnd = mulberry32(7);
  for (let r = 0; r < 5; r++) {
    const wy = 336 + r * 17;
    const pts: number[][] = [];
    for (let x = 28; x <= 996; x += 24) pts.push([x, wy + (wrnd() - 0.5) * 5]);
    polyline(pts, 1.6, WAVE);
  }
  // Iran coast (top-left sand) and Oman coast (bottom-right sand).
  poly([[28, 176], [430, 176], [400, 238], [330, 272], [28, 296]], SAND);
  polyline([[28, 296], [330, 272], [400, 238], [430, 176]], 2, SANDLINE);
  poly([[860, 428], [996, 352], [996, 428]], SAND);
  polyline([[860, 428], [996, 352]], 2, SANDLINE);
  // Three tankers; the middle one burns.
  tanker(80, 392, 200, 26, false);
  tanker(560, 408, 230, 30, true);
  tanker(820, 390, 130, 22, false);
  // Smoke plume: entirely above the horizon, wide and scattered.
  plume(660, 326, 190, 150, 11, 28);
  // Sea mines.
  mine(330, 414);
  mine(500, 418);
  mine(755, 420);
  // Labels.
  pill(95, 208, "IRAN", 15, NAVY, CREAM);
  pill(905, 400, "OMAN", 15, NAVY, CREAM);
  pill(300, 300, "STRAIT OF HORMUZ", 14, NAVY, CREAM);

  // Lead headline + facts, with a clear gap between band and facts.
  drawText("MINES IN THE STRAIT OF HORMUZ", 512, 480, 42, {
    color: INK,
    weight: 2.1,
    serif: true,
    align: "center",
  });
  const leadFacts = [
    "Three tankers hit sea mines in the Strait of Hormuz, the IRGC says;",
    "Qatar mediates in Washington; US Treasury sanctions 22 firms, 8 people, $14.7bn.",
    "JMIC: threat 'severe'. Not independently verified.",
  ];
  leadFacts.forEach((line, i) => {
    drawText(line, 512, 510 + i * 26, 20, { color: INK, weight: 1.7, align: "center" });
  });
  fillRect(28, 578, 968, 2, INK);

  // ---- Secondary panels (592..852) ----
  const panels = [
    { x: 28, pill: "TECHNOLOGY" },
    { x: 357, pill: "LIBYA" },
    { x: 686, pill: "EUROPE" },
  ];
  for (const p of panels) {
    fillRect(p.x, 592, 310, 268, hex("#fbf8f0"));
    fillRect(p.x, 592, 310, 1, hex("#d8d2c2"));
    fillRect(p.x, 592, 1, 268, hex("#d8d2c2"));
    fillRect(p.x + 309, 592, 1, 268, hex("#d8d2c2"));
    fillRect(p.x, 859, 310, 1, hex("#d8d2c2"));
  }

  // Nvidia: chip + rising chart.
  fillRect(28, 592, 310, 130, hex("#eef2f5"));
  fillRect(44, 624, 86, 86, CHIP);
  fillRect(56, 636, 62, 62, CHIP2);
  for (let i = 0; i < 4; i++) {
    fillRect(58 + i * 18, 616, 8, 8, hex("#8fa8c4"));
    fillRect(58 + i * 18, 710, 8, 8, hex("#8fa8c4"));
    fillRect(36, 638 + i * 18, 8, 8, hex("#8fa8c4"));
    fillRect(130, 638 + i * 18, 8, 8, hex("#8fa8c4"));
  }
  drawText("NVDA", 87, 676, 18, { color: CREAM, weight: 1.9, align: "center" });
  polyline([[155, 690], [190, 672], [225, 678], [260, 648], [295, 622]], 4, GREEN);
  for (const [px, py] of [[155, 690], [190, 672], [225, 678], [260, 648], [295, 622]] as const) disc(px, py, 3.5, GREEN);
  drawText("+33%", 318, 636, 22, { color: GREEN, weight: 2.1, align: "right" });
  drawText("Nasdaq +6% · S&P +4%", 236, 714, 12.5, { color: SOFT, weight: 1.6, align: "center" });
  pillLeft(38, 602, "TECHNOLOGY", 13, NAVY, CREAM);
  drawText("HUANG RETURNS AS", 30, 752, 25, { color: INK, weight: 2.0, serif: true });
  drawText("NVIDIA CEO", 30, 782, 25, { color: INK, weight: 2.0, serif: true });
  wrapText("Back 11 days after resigning; Trump pressed the board; shares +33%, Nasdaq +6%.", 17.5, 304, 1.6)
    .slice(0, 3)
    .forEach((line, j) => {
      drawText(line, 30, 808 + j * 22, 17.5, { color: INK, weight: 1.6 });
    });

  // Libya: corvette + smoke + sea drone.
  fillRect(357, 592, 310, 58, SKY);
  fillRect(357, 650, 310, 72, SEA);
  fillRect(357, 650, 310, 14, SEA2);
  fillRect(357, 690, 310, 32, SEA3);
  const lrnd = mulberry32(19);
  for (let r = 0; r < 2; r++) {
    const wy = 662 + r * 22;
    const pts: number[][] = [];
    for (let x = 357; x <= 667; x += 22) pts.push([x, wy + (lrnd() - 0.5) * 4]);
    polyline(pts, 1.5, WAVE);
  }
  corvette(387, 700, 250);
  plume(560, 648, 600, 64, 23, 16);
  seaDrone(600, 712);
  pillLeft(367, 602, "LIBYA", 13, NAVY, CREAM);
  drawText("SEA DRONES SINK", 359, 752, 25, { color: INK, weight: 2.0, serif: true });
  drawText("RUSSIAN CORVETTE", 359, 782, 25, { color: INK, weight: 2.0, serif: true });
  wrapText("Seven drones sank corvette Merkury off Benghazi; MV Angara hit.", 17.5, 304, 1.6)
    .slice(0, 3)
    .forEach((line, j) => {
      drawText(line, 359, 808 + j * 22, 17.5, { color: INK, weight: 1.6 });
    });

  // Estonia: closed-border barrier + warning sign.
  fillRect(686, 592, 310, 130, hex("#e8e2d2"));
  fillRect(686, 690, 310, 32, hex("#cbb98f"));
  fillRect(686, 688, 310, 2, hex("#8a7a55"));
  fillRect(716, 632, 10, 58, SOFT);
  fillRect(946, 632, 10, 58, SOFT);
  fillRect(716, 668, 240, 16, CREAM);
  for (let sx = 716; sx < 956; sx += 40) fillRect(sx, 668, 20, 16, RED);
  fillRect(716, 668, 240, 1.5, SOFT);
  fillRect(716, 682.5, 240, 1.5, SOFT);
  poly([[951, 598], [929, 634], [973, 634]], SOFT);
  poly([[951, 604], [934, 630], [968, 630]], hex("#e8b921"));
  drawText("!", 951, 628, 16, { color: INK, weight: 2.0, align: "center" });
  // Country labels: 18 px below the post tops, shifted clear of the posts.
  drawText("ESTONIA", 732, 661, 15, { color: INK, weight: 1.8 });
  drawText("RUSSIA", 940, 661, 15, { color: INK, weight: 1.8, align: "right" });
  pillLeft(696, 602, "EUROPE", 13, NAVY, CREAM);
  drawText("ESTONIA TO SHUT", 688, 752, 25, { color: INK, weight: 2.0, serif: true });
  drawText("BORDER WITH RUSSIA", 688, 782, 25, { color: INK, weight: 2.0, serif: true });
  wrapText("Russia: 'on the verge of triggering open war'. Border shut 1 Dec, 6 months.", 17.5, 304, 1.6)
    .slice(0, 3)
    .forEach((line, j) => {
      drawText(line, 688, 808 + j * 22, 17.5, { color: INK, weight: 1.6 });
    });

  fillRect(28, 866, 968, 2, INK);

  // ---- In brief: six items, two columns, two lines each ----
  drawText("IN BRIEF", 28, 890, 20, { color: INK, weight: 2.2 });
  const briefs = [
    "GAZA — Israeli strikes kill at least 3, including a UNRWA worker.",
    "INDONESIA — 26 body bags identified after Banten candy factory fire.",
    "MEGASPEED — US blacklists seven firms in Nvidia spy case.",
    "ZELENSKY — Seeks four-party talks with Russia, the US and Europe.",
    "SOUTH KOREA — Russian plane enters air defence zone; jets scrambled.",
    "BANGLADESH — Mass typhoid vaccination of 50 million children begins.",
  ];
  const colX = [28, 524];
  const rowY = [912, 948, 984];
  briefs.forEach((b, i) => {
    const lines = wrapText(b, 17.5, 472, 1.6);
    const x = colX[i % 2];
    const y = rowY[Math.floor(i / 2)];
    lines.slice(0, 2).forEach((line, j) => {
      drawText(line, x, y + j * 18, 17.5, { color: INK, weight: 1.6 });
    });
  });
  drawText("Sources: Trends MENA · Dubai Standard · Reuters · AFP · The Times · Le Monde · UN News", 512, 1018, 11, {
    color: SOFT,
    weight: 1.5,
    align: "center",
  });
}

// ---------------------------------------------------------------- dossier
const DOSSIER = {
  title: "THE WORLD — Tuesday, 24 November 2026",
  competition: "news-image-20261124",
  version: 6,
  lead: {
    headline: "MINES IN THE STRAIT OF HORMUZ",
    facts: [
      "Three tankers hit sea mines in the Strait of Hormuz, the IRGC says; not independently verified.",
      "Qatar mediates in Washington; US Treasury sanctions 22 firms, 8 people, $14.7bn.",
      "JMIC: threat 'severe'.",
    ],
    sources: ["Trends MENA, 2026-11-24T03:37:47Z", "Dubai Standard", "AJVC sitrep, 24 Nov 02:31 UTC"],
  },
  secondary: [
    {
      headline: "HUANG RETURNS AS NVIDIA CEO",
      facts: ["Back 11 days after resigning; Trump pressed the board; shares +33%, Nasdaq +6%."],
      sources: ["Reuters", "CNN", "WSJ, announced 23 Nov"],
    },
    {
      headline: "SEA DRONES SINK RUSSIAN CORVETTE",
      facts: ["Seven drones sank corvette Merkury off Benghazi; MV Angara hit."],
      detail: "Ka-27 helicopter also destroyed (Zelensky); UNSMIL seeks an investigation.",
      sources: ["The Times", "Le Monde", "AFP / UN News"],
    },
    {
      headline: "ESTONIA TO SHUT BORDER WITH RUSSIA",
      facts: ["Russia: 'on the verge of triggering open war'. Border shut 1 Dec, 6 months."],
      sources: ["Reuters, 23 Nov"],
    },
  ],
  briefs: [
    { label: "GAZA", text: "Israeli strikes kill at least 3, including a UNRWA worker.", source: "Reuters, 23 Nov" },
    { label: "INDONESIA", text: "26 body bags identified after Banten candy factory fire.", source: "ThedailyID, 24 Nov" },
    { label: "MEGASPEED", text: "US blacklists seven firms in Nvidia spy case.", source: "First reported 24 Nov 00:52 UTC" },
    { label: "ZELENSKY", text: "Seeks four-party talks with Russia, the US and Europe.", source: "24 Nov 00:30 UTC" },
    { label: "SOUTH KOREA", text: "Russian plane enters air defence zone; jets scrambled.", source: "24 Nov 01:04 UTC" },
    { label: "BANGLADESH", text: "Mass typhoid vaccination of 50 million children begins.", source: "24 Nov" },
  ],
  notes:
    "Lead first reported 24 Nov 2026 UTC. Secondary stories first reported 23 Nov but dominating the 24 Nov news cycle. IRGC mine claim not independently verified; shown as a claim.",
};

// ---------------------------------------------------------------- main
const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
mkdirSync(outDir, { recursive: true });
drawPage();
writeFileSync(`${outDir}/entry.png`, encodePNG());
writeFileSync(`${outDir}/dossier.json`, JSON.stringify(DOSSIER, null, 2) + "\n");
