// news-image-20261124 v3 — "THE WORLD" front page, Tuesday 24 November 2026.
// Fresh build: procedural newspaper front page, 1024x1024 PNG.
// Node 22 stdlib only, no network at run time, deterministic (same bytes every run).
// Own software rasteriser (2x supersampling + box downsample), own PNG encoder
// (zlib deflate + CRC32), own vector stroke font (glyph = M/L/Q path on a
// 12-wide x 14-tall grid, quadratic curves flattened, round caps/joins).
// Facts: verified news of 24 Nov 2026 (see dossier.json for sources per fact).

import * as fs from "node:fs";
import * as zlib from "node:zlib";

// ---------------------------------------------------------------- palette
type RGB = [number, number, number];
const PAPER: RGB = [247, 243, 234];
const INK: RGB = [20, 20, 20];
const RED: RGB = [179, 39, 30];
const NAVY: RGB = [27, 42, 74];
const NAVY2: RGB = [38, 58, 96];
const SKY: RGB = [191, 217, 232];
const SKY2: RGB = [168, 203, 224];
const SEA: RGB = [46, 110, 142];
const SEA2: RGB = [31, 78, 102];
const SAND: RGB = [227, 211, 168];
const SAND2: RGB = [213, 192, 140];
const STEEL: RGB = [107, 124, 140];
const STEEL2: RGB = [84, 96, 110];
const FLAME: RGB = [232, 106, 28];
const GOLD: RGB = [245, 184, 29];
const GREEN: RGB = [30, 122, 70];
const GREEN2: RGB = [46, 160, 96];
const WHITE: RGB = [250, 250, 248];
const SMOKE: RGB = [120, 122, 126];
const CHIP: RGB = [22, 34, 56];
const GRASS: RGB = [122, 158, 96];

// ---------------------------------------------------------------- canvas
const W = 1024;
const H = 1024;
const SS = 2; // supersample factor
const SW = W * SS;
const SH = H * SS;
const buf = new Uint8Array(SW * SH * 3);

function fillAll(c: RGB): void {
  for (let i = 0; i < SW * SH; i++) {
    buf[i * 3] = c[0];
    buf[i * 3 + 1] = c[1];
    buf[i * 3 + 2] = c[2];
  }
}

function setPx(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= SW || y >= SH) return;
  const i = (y * SW + x) * 3;
  buf[i] = c[0];
  buf[i + 1] = c[1];
  buf[i + 2] = c[2];
}

// filled rectangle, coordinates in final (1024) space
function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor(x * SS));
  const y0 = Math.max(0, Math.floor(y * SS));
  const x1 = Math.min(SW, Math.ceil((x + w) * SS));
  const y1 = Math.min(SH, Math.ceil((y + h) * SS));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) setPx(xx, yy, c);
  }
}

function fillCircle(cx: number, cy: number, r: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor((cx - r) * SS));
  const y0 = Math.max(0, Math.floor((cy - r) * SS));
  const x1 = Math.min(SW, Math.ceil((cx + r) * SS));
  const y1 = Math.min(SH, Math.ceil((cy + r) * SS));
  const rr = r * SS;
  const ccx = cx * SS;
  const ccy = cy * SS;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const dx = xx + 0.5 - ccx;
      const dy = yy + 0.5 - ccy;
      if (dx * dx + dy * dy <= rr * rr) setPx(xx, yy, c);
    }
  }
}

function fillEllipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor((cx - rx) * SS));
  const y0 = Math.max(0, Math.floor((cy - ry) * SS));
  const x1 = Math.min(SW, Math.ceil((cx + rx) * SS));
  const y1 = Math.min(SH, Math.ceil((cy + ry) * SS));
  const ccx = cx * SS;
  const ccy = cy * SS;
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const dx = (xx + 0.5 - ccx) / (rx * SS);
      const dy = (yy + 0.5 - ccy) / (ry * SS);
      if (dx * dx + dy * dy <= 1) setPx(xx, yy, c);
    }
  }
}

// filled polygon, points in final space; scanline fill in supersampled space
function fillPoly(pts: Array<[number, number]>, c: RGB): void {
  const sp = pts.map(([x, y]) => [x * SS, y * SS] as [number, number]);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of sp) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(SH - 1, Math.ceil(maxY));
  for (let yy = y0; yy <= y1; yy++) {
    const yc = yy + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < sp.length; i++) {
      const [x1, y1p] = sp[i];
      const [x2, y2p] = sp[(i + 1) % sp.length];
      if ((y1p <= yc && y2p > yc) || (y2p <= yc && y1p > yc)) {
        xs.push(x1 + ((yc - y1p) / (y2p - y1p)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.floor(xs[k]));
      const xb = Math.min(SW - 1, Math.ceil(xs[k + 1]));
      for (let xx = xa; xx <= xb; xx++) setPx(xx, yy, c);
    }
  }
}

function distSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = x1 + t * dx;
  const qy = y1 + t * dy;
  const ex = px - qx;
  const ey = py - qy;
  return Math.sqrt(ex * ex + ey * ey);
}

// thick line segment with round caps, final-space coords, w = width in final px
function strokeSeg(x1: number, y1: number, x2: number, y2: number, w: number, c: RGB): void {
  const hw = (w * SS) / 2;
  const ax = x1 * SS;
  const ay = y1 * SS;
  const bx = x2 * SS;
  const by = y2 * SS;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - hw - 1));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - hw - 1));
  const x1p = Math.min(SW - 1, Math.ceil(Math.max(ax, bx) + hw + 1));
  const y1p = Math.min(SH - 1, Math.ceil(Math.max(ay, by) + hw + 1));
  for (let yy = y0; yy <= y1p; yy++) {
    for (let xx = x0; xx <= x1p; xx++) {
      if (distSeg(xx + 0.5, yy + 0.5, ax, ay, bx, by) <= hw) setPx(xx, yy, c);
    }
  }
}

// polyline with round joins (joint discs) and round caps
function strokePoly(pts: Array<[number, number]>, w: number, c: RGB): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    strokeSeg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, c);
  }
  for (const [x, y] of pts) fillCircle(x, y, w / 2, c);
}

// ---------------------------------------------------------------- vector font
// Glyph grid: x 0..12, y 0..14 (cap top 0, baseline 10, descender to 14).
// Path tokens: M x,y | L x,y | Q cx,cy x,y. All paths drawn fresh here.
type Glyph = { a: number; d: string };
const GLYPHS: Record<string, Glyph> = {
  A: { a: 10, d: "M0,10 L5,0 L10,10 M2.6,6.5 L7.4,6.5" },
  B: { a: 10, d: "M0,0 L0,10 M0,0 L6,0 Q10,0 10,2.5 Q10,5 6,5 L0,5 M6,5 Q10,5 10,7.5 Q10,10 6,10 L0,10" },
  C: { a: 10, d: "M10,2.5 Q8,0 5,0 Q1,0 1,5 Q1,10 5,10 Q8,10 10,7.5" },
  D: { a: 10, d: "M0,0 L0,10 L6,10 Q10,10 10,5 Q10,0 6,0 L0,0" },
  E: { a: 9, d: "M10,0 L0,0 L0,10 L10,10 M0,5 L7,5" },
  F: { a: 9, d: "M0,10 L0,0 L10,0 M0,5 L7,5" },
  G: { a: 10, d: "M10,2.5 Q8,0 5,0 Q1,0 1,5 Q1,10 5,10 Q9,10 10,7 L10,5.5 L6,5.5" },
  H: { a: 10, d: "M0,0 L0,10 M10,0 L10,10 M0,5 L10,5" },
  I: { a: 6, d: "M5,0 L5,10 M2,0 L8,0 M2,10 L8,10" },
  J: { a: 9, d: "M8,0 L8,8 Q8,11.5 5,11.5 Q2,11.5 1,9" },
  K: { a: 10, d: "M0,0 L0,10 M9.5,0 L0,5.5 L9.5,10" },
  L: { a: 9, d: "M0,0 L0,10 L10,10" },
  M: { a: 11, d: "M0,10 L0,0 L5,6.5 L10,0 L10,10" },
  N: { a: 10, d: "M0,10 L0,0 L10,10 L10,0" },
  O: { a: 10.5, d: "M5,0 Q10,0 10,5 Q10,10 5,10 Q0,10 0,5 Q0,0 5,0" },
  P: { a: 10, d: "M0,10 L0,0 L6,0 Q10,0 10,2.5 Q10,5 6,5 L0,5" },
  Q: { a: 10.5, d: "M5,0 Q10,0 10,5 Q10,10 5,10 Q0,10 0,5 Q0,0 5,0 M6.5,7 L10,11" },
  R: { a: 10, d: "M0,10 L0,0 L6,0 Q10,0 10,2.5 Q10,5 6,5 L0,5 M6.5,5 L10,10" },
  S: { a: 10, d: "M9,2 Q7,0 5,0 Q1,0 1,2.5 Q1,5 5,5 Q9,5 9,7.5 Q9,10 5,10 Q3,10 1,8" },
  T: { a: 9, d: "M0,0 L10,0 M5,0 L5,10" },
  U: { a: 10, d: "M0,0 L0,7 Q0,10 5,10 Q10,10 10,7 L10,0" },
  V: { a: 10, d: "M0,0 L5,10 L10,0" },
  W: { a: 12, d: "M0,0 L2.5,10 L5,4 L7.5,10 L10,0" },
  X: { a: 10, d: "M0,0 L10,10 M10,0 L0,10" },
  Y: { a: 10, d: "M0,0 L5,5 L10,0 M5,5 L5,10" },
  Z: { a: 10, d: "M0,0 L10,0 L0,10 L10,10" },
  "0": { a: 10.5, d: "M5,0 Q10,0 10,5 Q10,10 5,10 Q0,10 0,5 Q0,0 5,0" },
  "1": { a: 7, d: "M5,0 L5,10 M2,10 L8,10 M3,2.5 L5,0" },
  "2": { a: 10, d: "M1,2.5 Q1,0 4.5,0 Q8,0 9,2 Q9,5 5,7.5 L1,10 L9,10" },
  "3": { a: 10, d: "M1,1.5 Q3,0 5.5,0 Q9,0 9,2.5 Q9,4.5 7,5 Q9,5.5 9,7.5 Q9,10 5.5,10 Q3,10 1,8.5" },
  "4": { a: 10, d: "M7,0 L7,10 M0.5,7 L8.5,7 M7,0 L1,7" },
  "5": { a: 10, d: "M9,0 L1,0 L1,4.5 L6,4.5 Q9,4.5 9,7.5 Q9,10 6,10 L1,10" },
  "6": { a: 10, d: "M9,1.5 Q7,0 5,0 Q1,0 1,5 Q1,10 5,10 Q9,10 9,7 Q9,5 5,5 Q2,5 1,3.5" },
  "7": { a: 10, d: "M0,0 L10,0 L5,10" },
  "8": { a: 10, d: "M5,0 Q9,0 9,2.5 Q9,5 5,5 Q1,5 1,2.5 Q1,0 5,0 M5,5 Q9,5 9,7.5 Q9,10 5,10 Q1,10 1,7.5 Q1,5 5,5" },
  "9": { a: 10, d: "M1,8.5 Q3,10 5,10 Q9,10 9,5 Q9,0 5,0 Q1,0 1,3 Q1,5 5,5 Q8,5 9,6.5" },
  " ": { a: 5, d: "" },
  ".": { a: 5, d: "M4,9 L6,9 L6,11 L4,11 L4,9" },
  ",": { a: 5, d: "M4,9 L6,9 L6,11 L4,11 M5.5,10.5 L4,13.5" },
  ":": { a: 5, d: "M4,2 L6,2 L6,4 L4,4 M4,8 L6,8 L6,10 L4,10" },
  ";": { a: 5, d: "M4,2 L6,2 L6,4 L4,4 M4,8 L6,8 L6,10 L4,10 M5.5,9.5 L4,13" },
  "!": { a: 5, d: "M5,0 L5,7 M4,8.5 L6,8.5 L6,10.5 L4,10.5" },
  "?": { a: 9, d: "M2,2.5 Q2,0 5,0 Q8,0 8,2.5 Q8,5 5,5 L5,6.5 M4,8.5 L6,8.5 L6,10.5 L4,10.5" },
  "'": { a: 5, d: "M5,0 L4,3.5" },
  "\u2019": { a: 5, d: "M5,0 L4,3.5" },
  '"': { a: 7, d: "M3,0 L2,3.5 M7,0 L6,3.5" },
  "\u201c": { a: 7, d: "M3,0 L2,3.5 M7,0 L6,3.5" },
  "\u201d": { a: 7, d: "M3,0 L2,3.5 M7,0 L6,3.5" },
  "\u2013": { a: 8, d: "M1,5 L9,5" },
  "\u2014": { a: 12, d: "M0,5 L10,5" },
  "-": { a: 7, d: "M2,5 L8,5" },
  "/": { a: 8, d: "M8,0 L2,10" },
  "%": { a: 11, d: "M9,0 L1,10 M1.5,1.5 L3.5,1.5 L3.5,3.5 L1.5,3.5 M6.5,6.5 L8.5,6.5 L8.5,8.5 L6.5,8.5" },
  $: { a: 10, d: "M9,2 Q7,0 5,0 Q1,0 1,2.5 Q1,5 5,5 Q9,5 9,7.5 Q9,10 5,10 Q3,10 1,8 M5,-1 L5,11" },
  "&": { a: 10, d: "M8,2 Q8,0 5,0 Q2,0 2,2.5 Q2,5 5,5 Q8,5 8,7.5 Q8,10 5,10 Q2,10 1,8 M5,5 L9,10" },
  "+": { a: 9, d: "M5,2 L5,8 M2,5 L8,5" },
  "\u2022": { a: 7, d: "M3.5,3.5 L6.5,3.5 L6.5,6.5 L3.5,6.5" },
  "=": { a: 9, d: "M1,3.5 L9,3.5 M1,6.5 L9,6.5" },
  "(": { a: 6, d: "M8,0 Q4.5,2 4.5,5 Q4.5,8 8,10" },
  ")": { a: 6, d: "M2,0 Q5.5,2 5.5,5 Q5.5,8 2,10" },
  _: { a: 10, d: "M0,12 L10,12" },
};

const parsedCache = new Map<string, Array<Array<[number, number]>>>();
function parseGlyph(d: string): Array<Array<[number, number]>> {
  const hit = parsedCache.get(d);
  if (hit) return hit;
  const subs: Array<Array<[number, number]>> = [];
  let cur: Array<[number, number]> | null = null;
  const toks = d.trim().split(/\s+/);
  let i = 0;
  let cmd = "";
  while (i < toks.length) {
    let t = toks[i];
    // Command letter is attached to its first coordinate pair: "M0,10", "Q10,0".
    const m = /^([MLQ])(.+)$/.exec(t);
    if (m) {
      cmd = m[1];
      t = m[2];
    }
    const [x, y] = t.split(",").map(Number);
    if (cmd === "M") {
      cur = [[x, y]];
      subs.push(cur);
      i += 1;
    } else if (cmd === "L") {
      if (cur) cur.push([x, y]);
      i += 1;
    } else if (cmd === "Q") {
      // control point is (x, y); the end point is the next bare token
      const [ex, ey] = toks[i + 1].split(",").map(Number);
      if (cur) {
        const p0 = cur[cur.length - 1];
        for (let s = 1; s <= 10; s++) {
          const u = s / 10;
          const mx = (1 - u) * (1 - u) * p0[0] + 2 * (1 - u) * u * x + u * u * ex;
          const my = (1 - u) * (1 - u) * p0[1] + 2 * (1 - u) * u * y + u * u * ey;
          cur.push([mx, my]);
        }
      }
      i += 2;
    } else {
      i += 1;
    }
  }
  parsedCache.set(d, subs);
  return subs;
}

function glyphAdvance(ch: string): number {
  const g = GLYPHS[ch];
  return g ? g.a : 5;
}

function measure(text: string, size: number): number {
  const s = size / 14;
  let w = 0;
  for (const ch of text) w += glyphAdvance(ch) * s;
  return w;
}

function drawText(
  text: string,
  x: number,
  yTop: number,
  size: number,
  c: RGB,
  align: "left" | "center" | "right" = "left",
  swF = 0.115,
): void {
  const w = measure(text, size);
  let cx = x;
  if (align === "center") cx = x - w / 2;
  if (align === "right") cx = x - w;
  const s = size / 14;
  const sw = size * swF;
  let pen = cx;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (g && g.d) {
      for (const sub of parseGlyph(g.d)) {
        const pts = sub.map(([gx, gy]) => [pen + gx * s, yTop + gy * s] as [number, number]);
        strokePoly(pts, sw, c);
      }
    }
    pen += glyphAdvance(ch) * s;
  }
}

// shrink text until it fits maxW (never below minSize)
function fitSize(text: string, size: number, maxW: number, minSize: number): number {
  let s = size;
  while (s > minSize && measure(text, s) > maxW) s -= 0.5;
  return s;
}

// greedy wrap; shrinks size until lines fit maxLines (never below minSize)
function wrapFit(
  text: string,
  size: number,
  maxW: number,
  maxLines: number,
  minSize: number,
): { lines: string[]; size: number } {
  let s = size;
  for (;;) {
    const words = text.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const wd of words) {
      const trial = cur ? cur + " " + wd : wd;
      if (measure(trial, s) <= maxW || !cur) cur = trial;
      else {
        lines.push(cur);
        cur = wd;
      }
    }
    if (cur) lines.push(cur);
    if (lines.length <= maxLines || s <= minSize) return { lines, size: s };
    s -= 0.5;
  }
}

// ---------------------------------------------------------------- helpers
function rule(y: number, h: number, c: RGB = INK): void {
  fillRect(28, y, 968, h, c);
}

function pill(x: number, y: number, label: string, size: number, bg: RGB, fg: RGB): number {
  const w = measure(label, size) + 18;
  fillRect(x, y, w, size + 10, bg);
  drawText(label, x + 9, y + 5, size, fg, "left", 0.13);
  return w;
}

function wave(x0: number, x1: number, y: number, amp: number, c: RGB): void {
  const pts: Array<[number, number]> = [];
  for (let x = x0; x <= x1; x += 6) {
    pts.push([x, y + Math.sin((x - x0) / 26) * amp]);
  }
  strokePoly(pts, 2, c);
}

// spiky sea mine
function mine(cx: number, cy: number, r: number): void {
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    strokeSeg(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7, cx + Math.cos(a) * (r + 5), cy + Math.sin(a) * (r + 5), 2.5, INK);
  }
  fillCircle(cx, cy, r, INK);
  fillCircle(cx - r * 0.3, cy - r * 0.3, r * 0.28, STEEL);
}

// tanker: hull from x0..x1, deck at yDeck, hull depth d; one burning stack optional
function tanker(x0: number, x1: number, yDeck: number, d: number, hull: RGB, burnX: number | null): void {
  fillPoly(
    [
      [x0, yDeck],
      [x1, yDeck],
      [x1 - 8, yDeck + d],
      [x0 + 10, yDeck + d],
    ],
    hull,
  );
  fillRect(x0 + 6, yDeck - 4, x1 - x0 - 12, 4, RED);
  // bridge tower
  fillRect(x1 - 34, yDeck - 26, 24, 26, WHITE);
  fillRect(x1 - 30, yDeck - 22, 16, 6, NAVY);
  // containers
  fillRect(x0 + 14, yDeck - 14, 26, 14, GOLD);
  fillRect(x0 + 44, yDeck - 14, 26, 14, GREEN2);
  fillRect(x0 + 74, yDeck - 10, 22, 10, SKY2);
  if (burnX !== null) {
    // flame + smoke column rising from the deck
    fillPoly(
      [
        [burnX - 12, yDeck - 2],
        [burnX - 4, yDeck - 30],
        [burnX + 2, yDeck - 14],
        [burnX + 10, yDeck - 34],
        [burnX + 16, yDeck - 2],
      ],
      FLAME,
    );
    fillPoly(
      [
        [burnX - 5, yDeck - 6],
        [burnX, yDeck - 22],
        [burnX + 6, yDeck - 6],
      ],
      GOLD,
    );
    fillCircle(burnX - 4, yDeck - 44, 9, SMOKE);
    fillCircle(burnX + 6, yDeck - 58, 12, SMOKE);
    fillCircle(burnX - 2, yDeck - 74, 10, [150, 152, 156]);
  }
}

function jet(x: number, y: number, s: number): void {
  fillPoly(
    [
      [x, y],
      [x + 26 * s, y + 5 * s],
      [x, y + 10 * s],
      [x + 6 * s, y + 5 * s],
    ],
    NAVY,
  );
  strokeSeg(x - 4, y + 5 * s, x - 44 * s, y + 5 * s, 1.5, WHITE);
  strokeSeg(x - 4, y + 8 * s, x - 34 * s, y + 12 * s, 1.5, WHITE);
}

// ---------------------------------------------------------------- page
function drawPage(): void {
  fillAll(PAPER);
  const M = 28;

  // ---- masthead (compressed a touch vs v2 so the footer can breathe)
  drawText("THE WORLD", 512, 10, 116, INK, "center", 0.1);
  drawText("TUESDAY, 24 NOVEMBER 2026  \u2022  IN ONE IMAGE", 512, 100, 20, INK, "center", 0.12);
  rule(122, 3);
  rule(128, 1);

  // ---- lead headline (shorter illustration below buys room for the facts)
  const hl1 = fitSize("THREE TANKERS HIT BY MINES", 42, 968, 30);
  drawText("THREE TANKERS HIT BY MINES", 512, 140, hl1, INK, "center", 0.11);
  const hl2 = fitSize("IN STRAIT OF HORMUZ", 42, 968, 30);
  drawText("IN STRAIT OF HORMUZ", 512, 190, hl2, RED, "center", 0.11);

  // ---- lead illustration: Strait of Hormuz, y 230..420
  const LY0 = 230;
  const LY1 = 420;
  fillRect(M, LY0, 968, 62, SKY); // sky
  fillRect(M, LY0 + 62, 968, LY1 - LY0 - 62, SEA); // sea
  fillRect(M, LY0 + 62, 968, 4, SEA2);
  // Iran coast, top-left sand wedge
  fillPoly(
    [
      [M, LY0],
      [520, LY0],
      [452, LY0 + 62],
      [M, LY0 + 62],
    ],
    SAND,
  );
  drawText("IRAN", 52, 240, 18, INK, "left", 0.13);
  // Oman coast, bottom-right sand wedge
  fillPoly(
    [
      [996, LY1],
      [996, 356],
      [812, 396],
      [706, LY1],
    ],
    SAND2,
  );
  drawText("OMAN", 884, 384, 18, INK, "left", 0.13);
  // US jets in the sky, left of the strait label
  jet(600, 246, 1);
  jet(688, 262, 0.85);
  drawText("STRAIT OF HORMUZ", 968, 242, 18, NAVY, "right", 0.13);
  // three tankers
  tanker(84, 300, 336, 26, NAVY2, 196);
  tanker(392, 622, 348, 30, NAVY, 560);
  tanker(688, 906, 330, 22, STEEL2, null);
  // small flame on the third tanker too (burning, no smoke stack)
  fillPoly(
    [
      [742, 328],
      [748, 308],
      [754, 320],
      [760, 306],
      [766, 328],
    ],
    FLAME,
  );
  // mines
  mine(348, 398, 9);
  mine(648, 404, 9);
  mine(958, 348, 8);
  // waves
  wave(40, 980, 372, 3, WHITE);
  wave(60, 960, 392, 3, [190, 220, 232]);
  wave(40, 700, 412, 3, [190, 220, 232]);

  // ---- lead facts: generous leading (36 px at 19 px type -> ~22 px clear gap)
  const facts = [
    "IRGC: THREE TANKERS HIT BY MINES, ABLAZE UNDER US AIR ESCORT \u2014 CLAIM UNVERIFIED.",
    "QATAR PM MEDIATES IN WASHINGTON; \u201cCOULD NOT WITHSTAND ANOTHER ESCALATION\u201d.",
    "US SANCTIONS IRAN SHADOW BANKING, $14.7BN; JMIC: THREAT \u201cSEVERE\u201d, MORE ATTACKS LIKELY.",
  ];
  let fy = 434;
  for (const f of facts) {
    const s = fitSize(f, 19, 940, 16);
    fillRect(M, fy + 4, 9, 9, RED);
    drawText(f, M + 18, fy, s, INK, "left", 0.12);
    fy += 36;
  }
  rule(534, 2);

  // ---- secondary stories: three panels
  const pw = 312;
  const pxs = [M, M + pw + 16, M + 2 * (pw + 16)];
  const py = 546;

  // NVIDIA
  {
    const x = pxs[0];
    pill(x, py, "NVIDIA", 16, GREEN, WHITE);
    const iy = py + 30;
    fillRect(x, iy, pw, 116, [232, 238, 226]);
    // chip
    fillRect(x + 22, iy + 34, 108, 52, CHIP);
    for (let k = 0; k < 5; k++) {
      fillRect(x + 34 + k * 20, iy + 26, 5, 8, GOLD);
      fillRect(x + 34 + k * 20, iy + 86, 5, 8, GOLD);
    }
    drawText("NVDA", x + 76, iy + 50, 22, GREEN2, "center", 0.13);
    // rising chart
    strokePoly(
      [
        [x + 150, iy + 88],
        [x + 185, iy + 70],
        [x + 215, iy + 76],
        [x + 250, iy + 44],
        [x + 292, iy + 22],
      ],
      4,
      GREEN,
    );
    fillPoly(
      [
        [x + 292, iy + 22],
        [x + 280, iy + 22],
        [x + 292, iy + 34],
      ],
      GREEN,
    );
    drawText("+33%", x + 232, iy + 4, 30, GREEN, "left", 0.12);
    const h = wrapFit("HUANG RETURNS AS CEO AS SHARES JUMP 33%", 22, pw, 2, 18);
    let hy = iy + 124;
    for (const ln of h.lines) {
      drawText(ln, x, hy, h.size, INK, "left", 0.115);
      hy += 27;
    }
    const f = wrapFit("HUANG BACK 11 DAYS AFTER QUITTING; NASDAQ +6%, S&P +4%.", 16.5, pw, 2, 14);
    let fyy = hy + 8;
    for (const ln of f.lines) {
      drawText(ln, x, fyy, f.size, INK, "left", 0.12);
      fyy += 21;
    }
  }

  // LIBYA — corvette made dominant in its panel, label fully over the sky
  {
    const x = pxs[1];
    pill(x, py, "LIBYA", 16, NAVY, WHITE);
    const iy = py + 30;
    fillRect(x, iy, pw, 62, SKY); // sky — the LIBYA pill sits above it, never on sand
    fillRect(x, iy + 62, pw, 54, SEA); // sea
    // explosion plume at the stern (left), big and bright
    fillCircle(x + 34, iy + 66, 16, FLAME);
    fillCircle(x + 52, iy + 52, 20, GOLD);
    fillCircle(x + 30, iy + 44, 13, FLAME);
    fillCircle(x + 48, iy + 34, 11, SMOKE);
    fillCircle(x + 62, iy + 22, 14, SMOKE);
    fillCircle(x + 40, iy + 18, 10, [150, 152, 156]);
    // corvette: nearly the full panel width, tall hull
    const hx0 = x + 10;
    const hx1 = x + pw - 8;
    const deck = iy + 84;
    fillPoly(
      [
        [hx0, deck],
        [hx1 - 14, deck],
        [hx1, deck + 12],
        [hx1 - 6, deck + 26],
        [hx0 + 12, deck + 26],
        [hx0, deck + 12],
      ],
      STEEL2,
    );
    fillRect(hx0 + 4, deck - 3, hx1 - hx0 - 18, 3, RED);
    // superstructure + mast + funnel + turret
    fillRect(x + 96, deck - 30, 92, 30, [226, 230, 234]);
    fillRect(x + 104, deck - 26, 76, 8, NAVY);
    fillRect(x + 146, deck - 52, 7, 22, STEEL);
    fillRect(x + 132, deck - 56, 36, 5, STEEL);
    fillRect(x + 196, deck - 26, 20, 26, INK);
    fillPoly(
      [
        [hx1 - 78, deck],
        [hx1 - 78, deck - 14],
        [hx1 - 40, deck - 14],
        [hx1 - 40, deck],
      ],
      NAVY2,
    );
    strokeSeg(hx1 - 40, deck - 11, hx1 - 12, deck - 16, 4, NAVY2);
    // sea drone + dotted approach path, low in the sea
    fillEllipse(x + 238, iy + 106, 16, 5, INK);
    strokeSeg(x + 238, iy + 106, x + 238, iy + 94, 2.5, INK);
    fillCircle(x + 238, iy + 93, 2.5, RED);
    for (let k = 0; k < 6; k++) {
      fillCircle(x + 196 - k * 12, iy + 104 - k * 1.5, 2, WHITE);
    }
    // wake
    wave(x + 8, x + pw - 10, iy + 112, 2, WHITE);
    const h = wrapFit("SEA DRONE SINKS RUSSIAN CORVETTE", 22, pw, 2, 18);
    let hy = iy + 124;
    for (const ln of h.lines) {
      drawText(ln, x, hy, h.size, INK, "left", 0.115);
      hy += 27;
    }
    const f = wrapFit("MERKURY SUNK OFF BENGHAZI; ANGARA HIT; UNSMIL SEEKS PROBE.", 16.5, pw, 2, 14);
    let fyy = hy + 8;
    for (const ln of f.lines) {
      drawText(ln, x, fyy, f.size, INK, "left", 0.12);
      fyy += 21;
    }
  }

  // ESTONIA
  {
    const x = pxs[2];
    pill(x, py, "ESTONIA", 16, RED, WHITE);
    const iy = py + 30;
    fillRect(x, iy, pw, 62, SKY);
    fillRect(x, iy + 62, pw, 54, GRASS);
    // two flag poles with country names stacked above the barrier
    strokeSeg(x + 30, iy + 8, x + 30, iy + 58, 3, INK);
    fillRect(x + 30, iy + 8, 34, 8, NAVY2);
    fillRect(x + 30, iy + 16, 34, 8, INK);
    fillRect(x + 30, iy + 24, 34, 8, WHITE);
    drawText("ESTONIA", x + 18, iy + 34, 13, INK, "left", 0.13);
    strokeSeg(x + pw - 30, iy + 8, x + pw - 30, iy + 58, 3, INK);
    fillRect(x + pw - 64, iy + 8, 34, 8, WHITE);
    fillRect(x + pw - 64, iy + 16, 34, 8, NAVY2);
    fillRect(x + pw - 64, iy + 24, 34, 8, RED);
    drawText("RUSSIA", x + pw - 66, iy + 34, 13, RED, "left", 0.13);
    // warning triangle in the middle sky
    fillPoly(
      [
        [x + 156, iy + 10],
        [x + 182, iy + 52],
        [x + 130, iy + 52],
      ],
      GOLD,
    );
    fillPoly(
      [
        [x + 156, iy + 18],
        [x + 174, iy + 46],
        [x + 138, iy + 46],
      ],
      INK,
    );
    drawText("!", x + 156, iy + 22, 20, GOLD, "center", 0.14);
    // striped barrier across the panel
    for (let k = 0; k < 12; k++) {
      fillPoly(
        [
          [x + 8 + k * 26, iy + 66],
          [x + 8 + k * 26 + 13, iy + 66],
          [x + 8 + k * 26 + 13 - 8, iy + 84],
          [x + 8 + k * 26 - 8, iy + 84],
        ],
        k % 2 === 0 ? RED : WHITE,
      );
    }
    fillRect(x + 8, iy + 66, pw - 16, 3, INK);
    fillRect(x + 8, iy + 81, pw - 16, 3, INK);
    strokeSeg(x + 30, iy + 84, x + 18, iy + 112, 4, INK);
    strokeSeg(x + pw - 30, iy + 84, x + pw - 18, iy + 112, 4, INK);
    const h = wrapFit("RUSSIA WARNS ESTONIA OVER BORDER SHUTDOWN", 22, pw, 2, 18);
    let hy = iy + 124;
    for (const ln of h.lines) {
      drawText(ln, x, hy, h.size, INK, "left", 0.115);
      hy += 27;
    }
    const f = wrapFit("TALLINN SHUTS LAND BORDER FROM 1 DEC, AT LEAST SIX MONTHS.", 16.5, pw, 2, 14);
    let fyy = hy + 8;
    for (const ln of f.lines) {
      drawText(ln, x, fyy, f.size, INK, "left", 0.12);
      fyy += 21;
    }
  }

  // ---- footer: IN BRIEF, 6 items in 2 columns, 17.5 px type
  rule(798, 2);
  drawText("IN BRIEF", M, 808, 20, RED, "left", 0.12);
  const briefs: Array<[string, string]> = [
    ["GAZA", "ISRAELI STRIKES KILL AT LEAST 3, INCLUDING UNRWA WORKER AT JABALIA WELL."],
    ["INDONESIA", "26 BODIES IDENTIFIED, 28 STILL MISSING AFTER BANTEN FACTORY FIRE."],
    ["MEGASPEED", "US BLACKLISTS 7 FIRMS IN NVIDIA SPY CASE."],
    ["ZELENSKY", "SEEKS FOUR-WAY TALKS WITH RUSSIA, US, EUROPE, \u201cAS SOON AS POSSIBLE\u201d."],
    ["SOUTH KOREA", "RUSSIAN PLANE ENTERS AIR DEFENCE ZONE; JETS SCRAMBLED."],
    ["BANGLADESH", "MASS TYPHOID VACCINATION OF 50 MILLION CHILDREN BEGINS."],
  ];
  const colW = 472;
  const colX = [M, M + colW + 24];
  for (let i = 0; i < briefs.length; i++) {
    const [label, body] = briefs[i];
    const cx = colX[i % 2];
    const cy = 838 + Math.floor(i / 2) * 46;
    const labelW = measure(label + " \u2014 ", 17.5);
    // wrap body with a narrower first line (label takes the head of line 1)
    const words = body.split(" ");
    const lines: string[] = [];
    let cur = "";
    let first = true;
    for (const wd of words) {
      const avail = first ? colW - labelW : colW;
      const trial = cur ? cur + " " + wd : wd;
      if (measure(trial, 17.5) <= avail || !cur) cur = trial;
      else {
        lines.push(cur);
        cur = wd;
        first = false;
      }
    }
    if (cur) lines.push(cur);
    for (let li = 0; li < Math.min(2, lines.length); li++) {
      const ly = cy + li * 22;
      if (li === 0) {
        drawText(label + " \u2014 ", cx, ly, 17.5, RED, "left", 0.12);
        drawText(lines[li], cx + labelW, ly, 17.5, INK, "left", 0.12);
      } else {
        drawText(lines[li], cx, ly, 17.5, INK, "left", 0.12);
      }
    }
  }
  drawText(
    "SOURCES: TRENDS MENA \u2022 DUBAI STANDARD \u2022 AJVC \u2022 REUTERS \u2022 CNN \u2022 WSJ \u2022 THE TIMES \u2022 LE MONDE \u2022 AFP",
    512,
    978,
    13.5,
    STEEL,
    "center",
    0.12,
  );
}

// ---------------------------------------------------------------- PNG encode
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePNG(): Buffer {
  // box-downsample 2x2 supersampled buffer to 1024x1024 RGB
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = ((y * SS + dy) * SW + (x * SS + dx)) * 3;
          r += buf[i];
          g += buf[i + 1];
          b += buf[i + 2];
        }
      }
      const o = y * (1 + W * 3) + 1 + x * 3;
      raw[o] = Math.round(r / 4);
      raw[o + 1] = Math.round(g / 4);
      raw[o + 2] = Math.round(b / 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- dossier
const DOSSIER = {
  title: "THE WORLD — Tuesday, 24 November 2026",
  competition: "news-image-20261124",
  version: 3,
  lead: {
    headline: "Three tankers hit by mines in Strait of Hormuz",
    facts: [
      "IRGC says three tankers were struck by sea mines and set ablaze while sailing under US air escort; the claim is not independently verified.",
      "Qatar's prime minister is mediating in Washington, meeting VP Vance and Secretary of State Rubio; Qatar says the region could not withstand another escalation.",
      "The US Treasury sanctioned Iran-linked shadow banking worth $14.7 billion; JMIC rates the threat severe and further attacks highly likely.",
    ],
    sources: ["TRENDS MENA", "Dubai Standard", "AJVC"],
  },
  secondary: [
    {
      headline: "Huang returns as CEO as shares jump 33%",
      fact: "Nvidia's board restored Jensen Huang as CEO 11 days after he stepped down; shares rose 33%, the Nasdaq 6% and the S&P 500 4%.",
      sources: ["Reuters", "CNN", "WSJ"],
    },
    {
      headline: "Sea drone sinks Russian corvette",
      fact: "A Ukrainian sea drone sank the Russian corvette Merkury off Benghazi and hit the cargo ship MV Angara; UNSMIL seeks an independent probe.",
      sources: ["The Times", "Le Monde", "AFP"],
    },
    {
      headline: "Russia warns Estonia over border shutdown",
      fact: "Russia said Estonia's actions are on the verge of triggering open war after Tallinn announced it will shut its land border from 1 December for at least six months.",
      sources: ["Reuters"],
    },
  ],
  briefs: [
    { label: "GAZA", fact: "Israeli strikes kill at least 3, including an UNRWA worker at a Jabalia well.", source: "Reuters" },
    { label: "INDONESIA", fact: "26 bodies identified, 28 still missing after the Banten candy factory fire.", source: "ThedailyID" },
    { label: "MEGASPEED", fact: "US blacklists 7 firms in the Nvidia spy case.", source: "Reuters" },
    { label: "ZELENSKY", fact: "Seeks four-way talks with Russia, the US and Europe as soon as possible.", source: "Reuters" },
    { label: "SOUTH KOREA", fact: "A Russian plane entered the air defence zone; jets were scrambled.", source: "Reuters" },
    { label: "BANGLADESH", fact: "Mass typhoid vaccination of 50 million children begins.", source: "Reuters" },
  ],
};

// ---------------------------------------------------------------- main
drawPage();
const png = encodePNG();
fs.mkdirSync("/output", { recursive: true });
fs.writeFileSync("/output/entry.png", png);
fs.writeFileSync("/output/dossier.json", JSON.stringify(DOSSIER, null, 2) + "\n");
