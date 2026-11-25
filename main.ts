// main.ts — "THE WORLD" — make.fun news-image-20261124 v5
// A one-image newspaper front page for Tuesday 24 November 2026.
// Node 22 stdlib only. No network at run time. Deterministic:
// same bytes every run. Writes <out>/entry.png (1024x1024, RGB PNG)
// and <out>/dossier.json (facts + sources).
// Usage: node main.ts [outDir]   (default outDir: /output)
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

// ---------------------------------------------------------------------------
// Deterministic RNG (fixed seed; call order is fixed, so output is fixed)
// ---------------------------------------------------------------------------
let _seed = 987654321;
function rnd() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
function rr(a, b) { return a + rnd() * (b - a); }

// ---------------------------------------------------------------------------
// Canvas: 2x supersampled RGB buffer, alpha-blended drawing, box downsample
// ---------------------------------------------------------------------------
const W = 1024, H = 1024, SS = 2, SW = W * SS, SH = H * SS;
const buf = new Uint8Array(SW * SH * 3);
function hx(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
const PAPER = hx("#f7f2e7"), INK = hx("#1c1712"), MUTED = hx("#6b6257");
const RED = hx("#b3261e"), NAVY = hx("#1e3a5c"), GREEN = hx("#2f7d1e"), GOLD = hx("#b8860b");

function px(x, y, rgb, a) {
  const xi = Math.floor(x), yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= SW || yi >= SH) return;
  const i = (yi * SW + xi) * 3, na = 1 - a;
  buf[i] = Math.round(buf[i] * na + rgb[0] * a);
  buf[i + 1] = Math.round(buf[i + 1] * na + rgb[1] * a);
  buf[i + 2] = Math.round(buf[i + 2] * na + rgb[2] * a);
}
function disc(cx, cy, r, rgb, a) {
  // Final (1024) coords in, supersampled buffer out.
  cx *= SS; cy *= SS; r *= SS;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(SW - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(SH - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    if (dx * dx + dy * dy <= r2) px(x, y, rgb, a);
  }
}
function line(x1, y1, x2, y2, w, rgb, a) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / 0.5));
  const r = w / 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(x1 + dx * t, y1 + dy * t, r, rgb, a);
  }
}
function polyline(pts, w, rgb, a) {
  for (let i = 0; i + 1 < pts.length; i++) line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, rgb, a);
}
function rect(x, y, w, h, rgb, a) {
  x *= SS; y *= SS; w *= SS; h *= SS;
  const x0 = Math.max(0, Math.floor(x)), x1 = Math.min(SW, Math.ceil(x + w));
  const y0 = Math.max(0, Math.floor(y)), y1 = Math.min(SH, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) px(xx, yy, rgb, a === undefined ? 1 : a);
}
function ellipse(cx, cy, rx, ry, rgb, a) {
  cx *= SS; cy *= SS; rx *= SS; ry *= SS;
  const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(SW - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(SH - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
    if (dx * dx + dy * dy <= 1) px(x, y, rgb, a);
  }
}
// Even-odd scanline polygon fill (points in 1024 coords).
function fillPoly(pts, rgb, a) {
  const ys = pts.map(p => p[1]);
  const yMin = Math.max(0, Math.floor(Math.min.apply(null, ys)));
  const yMax = Math.min(H - 1, Math.ceil(Math.max.apply(null, ys)));
  for (let y = yMin; y <= yMax; y++) {
    const yc = y + 0.5, xs = [];
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
      if ((p1[1] <= yc && p2[1] > yc) || (p2[1] <= yc && p1[1] > yc)) {
        xs.push(p1[0] + (yc - p1[1]) * (p2[0] - p1[0]) / (p2[1] - p1[1]));
      }
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k])), x1 = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = x0; x <= x1; x++) {
        for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) px(x * SS + sx, y * SS + sy, rgb, a);
      }
    }
  }
}
function fillPaper() {
  for (let i = 0; i < buf.length; i += 3) { buf[i] = PAPER[0]; buf[i + 1] = PAPER[1]; buf[i + 2] = PAPER[2]; }
}
// Horizontal band gradient (list of [yEnd, color]).
function vBands(x, y0, w, bands, a) {
  let y = y0;
  for (const [yEnd, c] of bands) { rect(x, y, w, yEnd - y, hx(c), a === undefined ? 1 : a); y = yEnd; }
}

// ---------------------------------------------------------------------------
// Vector stroke font (authored fresh in this session).
// Grid: 10 wide, cap top y=0, baseline y=10, descender y=13.
// Glyph = [advanceUnits, "stroke1;stroke2"] where a stroke is "x,y x,y ...".
// Ellipse strokes are generated by E() so O/0/o/8 are smooth, never boxy.
// S path topology (fix from v4): top terminal RIGHT, middle diagonal
// left->right, bottom terminal LEFT — never reads as C.
// W topology: middle vertex at y=4 (well above baseline) — never two Vs.
// ---------------------------------------------------------------------------
function E(cx, cy, rx, ry, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = i / n * Math.PI * 2;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}
const S_PATH = "8,1 5.5,0 2.5,0.6 1,2.5 1.5,4.7 4,6 7,7.6 8.6,9 7,10 4.5,10.4 1.8,9.4";
const RAW = {
  A: [9.5, "0,10 5,0 10,10;2.8,6.5 7.2,6.5"],
  B: [9, "1,0 1,10;1,0 6,0 8.5,2 7,5 1,5;1,5 7,5 8.5,7.5 6,10 1,10"],
  C: [9, "9,2 6,0 3,0.5 1,3 1,7 3,9.5 6,10 9,8"],
  D: [9.5, "1,0 1,10;1,0 6.5,0 9.5,3 9.5,7 6.5,10 1,10"],
  E: [8.5, "1,0 1,10;1,0 9,0;1,5 7,5;1,10 9,10"],
  F: [8, "1,0 1,10;1,0 9,0;1,5 7,5"],
  G: [9.5, "9,2 6,0 3,0.5 1,3 1,7 3,9.5 6,10 9,8 9,5 5.5,5"],
  H: [9.5, "1,0 1,10;9,0 9,10;1,5 9,5"],
  I: [4.5, "5,0 5,10;2,0 8,0;2,10 8,10"],
  J: [6.5, "8,0 8,8 6,10 3,10 1.5,8.5"],
  K: [9.5, "1,0 1,10;9,0 1.5,5.5;4,4 9,10"],
  L: [8, "1,0 1,10;1,10 9,10"],
  M: [11.5, "1,10 1,0 5,6 9,0 9,10"],
  N: [10, "1,10 1,0 9,10 9,0"],
  O: [10, null],
  P: [9, "1,0 1,10;1,0 6,0 8.5,2 7,5 1,5"],
  Q: [10, null],
  R: [9.5, "1,0 1,10;1,0 6,0 8.5,2 7,5 1,5;5,5 9.5,10"],
  S: [9, S_PATH],
  T: [8.5, "1,0 9,0;5,0 5,10"],
  U: [9.5, "1,0 1,7 2.5,9.5 7,9.5 9,7 9,0"],
  V: [9.5, "0,0 5,10 10,0"],
  W: [12.5, "0,0 2.5,10 5,4 7.5,10 10,0"],
  X: [9.5, "1,0 9,10;9,0 1,10"],
  Y: [9, "1,0 5,5 9,0;5,5 5,10"],
  Z: [9, "1,0 9,0 1,10 9,10"],
  a: [8.5, "8.5,3.5 6,3 3,3.8 1.8,5.5 2.2,8 4.5,10 7,9.8 8.5,8;8.5,3.5 8.5,10"],
  b: [8.5, "1.5,0 1.5,10;1.5,5 3.5,3.2 6.5,3.2 8.5,5 8.5,7.5 7,9.8 4.5,10 2.2,8.5"],
  c: [8, "8.5,4.5 6,3.2 3,3.5 1.5,5.5 2,8 4.5,9.8 7,9.5 8.5,8"],
  d: [8.5, "8.5,0 8.5,10;8.5,5 6.5,3.2 3.5,3.2 1.8,5 1.8,7.5 3.5,9.8 6,10 8,8.5"],
  e: [8.5, "7.5,6.5 6,3.2 3,3.5 1.5,5.5 2,8 4.5,10 7,9.5 8.5,7.5;1.8,6.2 8,6.2"],
  f: [5, "7,0 4.5,1 3.5,3 3.5,10;2,4 6.5,4"],
  g: [8.5, "8.5,3.5 6,3 3,3.8 1.8,5.5 2.2,8 4.5,10 7,9.8 8.5,8;8.5,3.5 8.5,10;8.5,10 8,12.5 6,13.2 4,13 3,12"],
  h: [8.5, "1.5,0 1.5,10;1.5,6 3.5,3.2 6,3.2 8,4.5 8.5,7 8.5,10"],
  i: [4, "5,3.2 5,10"],
  j: [4.5, "6.5,3.2 6.5,11 5,12.8 3,12.8"],
  k: [8.5, "1.5,0 1.5,10;8.5,3.2 2,6.5;4,5.5 8.5,10"],
  l: [4, "5,0 5,10"],
  m: [11, "1.5,10 1.5,3.5 3.5,3.2 5,5.5 5,3.5 7,3.2 8.5,5 8.5,10"],
  n: [8.5, "1.5,10 1.5,3.5 3.5,3.2 6.5,3.2 8.5,5 8.5,10"],
  o: [8.5, null],
  p: [8.5, "1.5,3.2 1.5,13;1.5,6 3.5,3.5 6.5,3.5 8.5,5.5 8.5,7.5 7,9.8 4.5,10 2.2,8.5"],
  q: [8.5, "8.5,3.2 8.5,13;8.5,6 6.5,3.5 3.5,3.5 1.8,5.5 1.8,7.5 3.5,9.8 6,10 8,8.5"],
  r: [5.5, "1.5,10 1.5,3.2;1.5,5 3.5,3.2 6.5,3.2 8,4.5"],
  s: [8, "7.5,4 5,3.2 3,3.8 1.8,5 2.2,6.5 4.5,7.5 7,8.5 7.5,9 6,10 3.5,10 1.8,9"],
  t: [5.5, "5,0.8 5,8.5 3.8,9.8 2.5,9.8;2,4 7.5,4"],
  u: [8.5, "1.5,3.2 1.5,8 3,9.8 6,9.8 8.5,8 8.5,3.2"],
  v: [8.5, "1,3.2 5,10 9,3.2"],
  w: [11, "0.5,3.2 2.5,10 5,5 7.5,10 9.5,3.2"],
  x: [8.5, "1.5,3.2 8.5,10;8.5,3.2 1.5,10"],
  y: [8.5, "1,3.2 4.5,9 8.5,3.2;4.5,9 4.5,12 3,13"],
  z: [8, "1.5,3.2 8.5,3.2 1.5,10 8.5,10"],
  "0": [9.5, null], "1": [5.5, "3,2 5.5,0 5.5,10;3,10 8,10"],
  "2": [9.5, "1.5,2.5 3,0.5 6.5,0.5 8.5,2.5 8,5 2,10 8.5,10"],
  "3": [9.5, "2,1 5,0 7.5,1 8.5,2.5 7,4.5 4.5,5;4.5,5 7,5.5 8.5,7 7.5,9.5 4.5,10 2,9"],
  "4": [9.5, "6.5,0 2,7 8.5,7;6.5,0 6.5,10"],
  "5": [9.5, "8.5,0 2,0 2,4.5 6,4.5 8,6 8,8 6,10 3,10 1.5,8.5"],
  "6": [9.5, "8.5,1 6,0 3,1 1.5,3.5 1.5,7 3.5,10 6.5,10 8.5,7.5 8.5,5.5 6.5,4.5 3.5,4.8 1.8,6.8"],
  "7": [9.5, "1,0 9,0 4.5,10"],
  "8": [9.5, null],
  "9": [9.5, "1.5,9 4,10 7,9 8.5,6.5 8.5,3 6.5,0 3.5,0 1.5,2.5 1.5,4.5 3.5,5.5 6.5,5.2 8.2,3.2"],
  ".": [4.5, "4.5,9.6 5.5,9.6"], ",": [4.5, "5,9.5 4,11.5 3,12.5;4.5,9.6 5.5,9.6"],
  ":": [4.5, "4.6,3.4 5.4,3.4;4.6,8.4 5.4,8.4"], ";": [4.5, "4.6,3.4 5.4,3.4;5,8.5 4,10.5 3,11.5"],
  "'": [4, "5.5,0 4.5,2.5"], '"': [6, "4,0 3,2.5;7,0 6,2.5"],
  "‘": [4, "4.5,0 5.5,2.5"], "’": [4, "5.5,0 4.5,2.5"],
  "!": [4.5, "5,0 5,7;4.6,9.4 5.4,9.4"],
  "?": [8.5, "2,2.5 3.5,0.5 6.5,0.5 8,2 8,3.5 6.5,5 5,5.5 5,7;4.6,9.4 5.4,9.4"],
  "-": [7, "1.5,5.5 8.5,5.5"], "—": [11, "0.5,5.5 9.5,5.5"],
  "/": [8, "8,0 2,10"],
  "(": [5.5, "8,0.5 5,2.5 4,5 5,7.5 8,9.5"], ")": [5.5, "2,0.5 5,2.5 6,5 5,7.5 2,9.5"],
  "&": [10, "7.5,1 5,0.3 2.8,1.5 2,3.5 3,5.5 5.5,6.3 7.5,5.5 8,3.5 6.5,2 4,4.5 1.8,8 2.8,10.5 5.5,11 8,9.8"],
  "%": [12, null], "+": [9, "5,1.5 5,8.5;1.5,5 8.5,5"],
  "$": [9, S_PATH + ";5,-0.5 5,11"],
  "•": [5, null], "·": [4.5, "4.5,5 5.5,5"],
  "=": [9, "1.5,3.5 8.5,3.5;1.5,6.5 8.5,6.5"],
  "*": [8, "5,0.5 5,9.5;1,2.5 9,7.5;9,2.5 1,7.5"],
  "[": [5, "8,0 2,0 2,10 8,10"], "]": [5, "2,0 8,0 8,10 2,10"]
};
const GLYPHS = {};
for (const [ch, [adv, spec]] of Object.entries(RAW)) {
  let strokes = [];
  if (spec) {
    strokes = spec.split(";").map(s => s.trim().split(/\s+/).map(p => {
      const [a, b] = p.split(",").map(Number);
      return [a, b];
    }));
  }
  if (ch === "O" || ch === "Q") strokes = [E(5, 5, 4.6, 5, 24)];
  if (ch === "Q") strokes.push([[6.5, 7], [9.5, 10.5]]);
  if (ch === "o") strokes = [E(5, 6.6, 3.6, 3.4, 18)];
  if (ch === "0") strokes = [E(5, 5, 4.1, 5, 20)];
  if (ch === "8") strokes = [E(5, 2.9, 3.1, 2.6, 16), E(5, 7.2, 3.9, 2.7, 16)];
  if (ch === "i") strokes.push(E(5, 0.9, 0.9, 0.9, 8));
  if (ch === "j") strokes.push(E(6.5, 0.9, 0.9, 0.9, 8));
  if (ch === "%") strokes = [E(2.8, 2, 1.5, 1.5, 10), E(7.2, 8, 1.5, 1.5, 10), [[8.5, 0.5], [1.5, 9.5]]];
  if (ch === "•") strokes = [E(5, 5, 1.7, 1.7, 10)];
  GLYPHS[ch] = { adv, strokes };
}
const SPACE_ADV = 5;

// Text metrics + drawing. size = cap height in px. xs = horizontal condense.
function textWidth(s, size, xs, tracking) {
  xs = xs === undefined ? 0.72 : xs; tracking = tracking || 0;
  const sc = size / 10;
  let w = 0;
  for (const ch of s) {
    if (ch === " ") w += SPACE_ADV * xs * sc + tracking;
    else if (GLYPHS[ch]) w += GLYPHS[ch].adv * xs * sc + tracking;
    else w += 9 * xs * sc + tracking;
  }
  return w - (s.length ? tracking : 0);
}
function drawText(s, x, yTop, size, o) {
  o = o || {};
  const xs = o.xs === undefined ? 0.72 : o.xs;
  const track = o.tracking || 0;
  const col = o.color || INK;
  const wgt = o.weight === undefined ? 0.11 : o.weight;
  const sc = size / 10;
  let cx = x;
  const tw = textWidth(s, size, xs, track);
  if (o.align === "center") cx = x - tw / 2;
  if (o.align === "right") cx = x - tw;
  for (const ch of s) {
    if (ch === " ") { cx += SPACE_ADV * xs * sc + track; continue; }
    const g = GLYPHS[ch];
    if (!g) { cx += 9 * xs * sc + track; continue; }
    // Centre the glyph inside its advance slot: narrow glyphs (i, l, t)
    // are drawn near x=5 of a 10-unit cell, which otherwise leaves a
    // visible gap after wide letters (m, w) and before the stem.
    const off = (g.adv - 10) / 2;
    for (const stroke of g.strokes) {
      const pts = stroke.map(p => [cx + (p[0] + off) * xs * sc, yTop + p[1] * sc]);
      polyline(pts, size * wgt, col, 1);
    }
    if (o.serif) {
      // Small slab feet under vertical stems that meet the baseline or the
      // cap top — the newspaper-serif touch for the masthead.
      const seen = new Set();
      for (const stroke of g.strokes) {
        for (let i = 0; i < stroke.length; i++) {
          const p = stroke[i];
          if ((Math.abs(p[1]) < 0.01 || Math.abs(p[1] - 10) < 0.01)) {
            const nb = stroke[i === 0 ? 1 : i - 1];
            if (nb && Math.abs(nb[0] - p[0]) < 1.6 && Math.abs(nb[1] - p[1]) > 3) {
              const key = p[0].toFixed(1) + "," + p[1].toFixed(0);
              if (seen.has(key)) continue;
              seen.add(key);
              const fx = cx + (p[0] + off) * xs * sc, fy = yTop + p[1] * sc;
              line(fx - size * 0.085, fy, fx + size * 0.085, fy, size * 0.075, col, 1);
            }
          }
        }
      }
    }
    cx += g.adv * xs * sc + track;
  }
  return tw;
}
function wrapText(s, maxW, size, xs) {
  const words = s.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (textWidth(t, size, xs) <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
// Pill label: rounded-ish (rect + end discs) with centered text.
function pill(text, x, y, size, bg, fg) {
  const pad = size * 0.55, tw = textWidth(text, size, 0.72);
  const w = tw + pad * 2, h = size + size * 0.62;
  const r = h / 2;
  rect(x + r, y, w - 2 * r, h, bg, 1);
  disc(x + r, y + r, r, bg, 1);
  disc(x + w - r, y + r, r, bg, 1);
  drawText(text, x + w / 2, y + size * 0.31, size, { color: fg, align: "center", weight: 0.13 });
  return w;
}

// ---------------------------------------------------------------------------
// Smoke plume: irregular overlapping puffs + wisps, NEVER a row of circles.
// All puffs end above the horizon line passed in.
// ---------------------------------------------------------------------------
function plume(cx, baseY, topY, spread, big) {
  // Flame at the base first.
  const flame = hx("#f08a1d"), flame2 = hx("#f7c948");
  fillPoly([[cx - 9, baseY], [cx - 4, baseY - 16], [cx + 1, baseY - 24], [cx + 6, baseY - 14], [cx + 10, baseY], [cx, baseY + 2]], flame, 1);
  fillPoly([[cx - 5, baseY], [cx - 2, baseY - 11], [cx + 2, baseY - 15], [cx + 5, baseY - 9], [cx + 5, baseY]], flame2, 1);
  // Smoke puffs: rising, widening, jittered — an irregular cloud, not beads.
  // More puffs, smaller and more overlapping than v4, so no single circle
  // reads as a balloon; elliptical puffs + varied alpha blend the edges.
  // A faint broad wash behind the puffs unifies the cloud so individual
  // circles stop reading as balloons.
  ellipse(cx + spread * 0.12, (baseY + topY) / 2, spread * 0.62, (baseY - topY) * 0.52, hx("#a9aeb1"), 0.28);
  const grays = [hx("#8d9296"), hx("#a7adb0"), hx("#7b8084"), hx("#b9bec1")];
  const n = big ? 20 : 13;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const y = baseY - 6 - t * (baseY - topY) + rr(-3, 3);
    const drift = Math.sin(t * 2.2) * spread * 0.35 + rr(-spread * 0.28, spread * 0.28);
    const x = cx + drift + (t > 0.6 ? rr(-4, 10) : rr(-6, 4));
    const r = (big ? 6 : 4.5) + t * (big ? 11 : 8) + rr(-2, 3);
    const g = grays[Math.floor(rr(0, grays.length)) % grays.length];
    ellipse(x, y, r * rr(1.1, 1.45), r * rr(0.68, 0.92), g, 0.45 + rr(0, 0.25));
  }
  // Dark debris specks inside the cloud.
  for (let i = 0; i < (big ? 9 : 5); i++) {
    const t = rr(0.15, 0.9);
    ellipse(cx + rr(-spread * 0.5, spread * 0.5), baseY - t * (baseY - topY), rr(1, 2.2), rr(1, 2.2), hx("#3a3d3f"), 0.8);
  }
  // Thin smoke wisps curling off the top.
  for (let k = 0; k < 3; k++) {
    const pts = [];
    let wx = cx + rr(-8, 8), wy = topY + rr(2, 10);
    for (let j = 0; j < 5; j++) { pts.push([wx, wy]); wx += rr(-9, 11); wy -= rr(4, 9); }
    polyline(pts, big ? 2.2 : 1.8, hx("#9aa0a3"), 0.5);
  }
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
const M = 44, X0 = M, X1 = 1024 - M, CW = X1 - X0, CX = 512;
const PAPER_RGB = "#f7f2e7";

function rule(y, w) { rect(X0, y, CW, w || 2, INK, 1); }

function drawMasthead() {
  const size = 126;
  drawText("THE WORLD", CX, 18, size, { align: "center", xs: 0.88, weight: 0.10, serif: true });
  drawText("TUESDAY, 24 NOVEMBER 2026  •  IN ONE IMAGE", CX, 158, 18, { align: "center", weight: 0.12 });
  rect(X0, 190, CW, 3, INK, 1);
  rect(X0, 196, CW, 1, INK, 1);
}

function tanker(x, y, w, hull, deck) {
  // Hull with a lighter top edge and a red boot-top; deck boxes; funnel.
  const h = w * 0.16;
  fillPoly([[x, y], [x + w * 0.94, y], [x + w, y + h * 0.45], [x + w * 0.97, y + h], [x, y + h]], hull, 1);
  line(x + 2, y + 1, x + w * 0.94, y + 1, 2, hx("#c8cdd0"), 0.85);
  rect(x + w * 0.06, y + h * 0.72, w * 0.88, h * 0.28, hx("#7a1f1a"), 1);
  fillPoly([[x + w * 0.08, y - h * 0.5], [x + w * 0.3, y - h * 0.5], [x + w * 0.3, y], [x + w * 0.08, y]], deck, 1);
  fillPoly([[x + w * 0.36, y - h * 0.32], [x + w * 0.6, y - h * 0.32], [x + w * 0.6, y], [x + w * 0.36, y]], hx("#4a4640"), 1);
  rect(x + w * 0.68, y - h * 0.62, w * 0.05, h * 0.62, hx("#8a2f24"), 1);
  // Wake.
  polyline([[x - 14, y + h + 4], [x + w * 0.3, y + h + 7], [x + w * 0.7, y + h + 4]], 1.6, hx("#e8ecec"), 0.7);
}

function drawLead() {
  // Headline (fitted, one line).
  let hs = 54;
  while (textWidth("MINES IN THE STRAIT OF HORMUZ", hs, 0.72) > CW && hs > 30) hs -= 1;
  drawText("MINES IN THE STRAIT OF HORMUZ", X0, 210, hs, { weight: 0.13 });
  console.log("W lead-headline size=" + hs + " width=" + Math.round(textWidth("MINES IN THE STRAIT OF HORMUZ", hs, 0.72)));
  // Scene: sky, sea, land wedges, three tankers, mines, labels.
  const y0 = 272, yHor = 352, y1 = 460;
  vBands(X0, y0, CW, [[300, "#c3d5de"], [330, "#d8e4e8"], [yHor, "#e6edef"]]);
  // Sea.
  vBands(X0, yHor, CW, [[392, "#2e6f8e"], [428, "#27637f"], [y1, "#1f5570"]]);
  // Land wedges (Iran left, Oman right).
  fillPoly([[X0, yHor], [330, yHor], [252, y1], [X0, y1]], hx("#d9c49a"), 1);
  fillPoly([[700, yHor], [X1, yHor], [X1, y1], [792, y1]], hx("#d3bd8f"), 1);
  // Dune lines on the land.
  polyline([[X0 + 8, 392], [150, 380], [260, 398]], 1.6, hx("#b89a68"), 0.8);
  polyline([[760, 396], [880, 382], [X1 - 8, 398]], 1.6, hx("#b89a68"), 0.8);
  // Waves.
  for (const [wx, wy, wl] of [[380, 372, 60], [560, 382, 80], [700, 368, 56], [470, 420, 90], [640, 432, 70], [360, 440, 60]]) {
    polyline([[wx, wy], [wx + wl * 0.35, wy - 3], [wx + wl * 0.7, wy + 2], [wx + wl, wy]], 1.6, hx("#cfe0e6"), 0.55);
  }
  // Tankers: far left, burning centre, right.
  tanker(300, 392, 120, hx("#3a3733"), hx("#6b655c"));
  tanker(452, 384, 168, hx("#33302c"), hx("#6b655c"));
  tanker(660, 396, 128, hx("#3a3733"), hx("#6b655c"));
  // Fire + irregular smoke plume on the centre tanker (rises into the sky).
  plume(536, 384, 296, 46, true);
  // Sea mines: spiky dark circles.
  for (const [mx, my] of [[392, 440], [600, 446], [706, 436]]) {
    disc(mx, my, 7, hx("#22201d"), 1);
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2 + 0.4;
      line(mx + Math.cos(a) * 5, my + Math.sin(a) * 5, mx + Math.cos(a) * 11, my + Math.sin(a) * 11, 2, hx("#22201d"), 1);
    }
    disc(mx - 2, my - 2, 2, hx("#555049"), 1);
  }
  // Labels.
  pill("IRAN", 66, 292, 15, NAVY, hx("#ffffff"));
  pill("OMAN", 884, 292, 15, NAVY, hx("#ffffff"));
  pill("STRAIT OF HORMUZ", 512 - 108, 424, 14, hx("#f7f2e7"), INK);
  // Lead facts: 3 lines, 19 px, leading 36.
  const facts = [
    "Three tankers hit sea mines in the Strait of Hormuz and caught fire",
    "under US air escort; the IRGC claim is not independently verified.",
    "Qatar mediates; US Treasury sanctions 22 firms, 8 people, $14.7bn. JMIC: threat \u2018severe\u2019."
  ];
  let fy = 476;
  for (const f of facts) {
    const w = drawText(f, X0, fy, 19, { weight: 0.11 });
    console.log("W lead-fact " + JSON.stringify(f) + " width=" + Math.round(w));
    fy += 36;
  }
  rule(600, 2);
}

function drawNvidia(x, y, w) {
  // Chip + rising chart.
  pill("TECHNOLOGY", x + 4, y + 2, 12.5, NAVY, hx("#ffffff"));
  const chipX = x + 22, chipY = y + 26, cs = 62;
  rect(chipX, chipY, cs, cs, hx("#76b900"), 1);
  rect(chipX + 8, chipY + 8, cs - 16, cs - 16, hx("#5a9400"), 1);
  rect(chipX + 16, chipY + 16, cs - 32, cs - 32, hx("#76b900"), 1);
  for (let i = 0; i < 5; i++) {
    const px0 = chipX + 8 + i * 12;
    rect(px0, chipY - 7, 4, 7, hx("#c9a227"), 1);
    rect(px0, chipY + cs, 4, 7, hx("#c9a227"), 1);
    rect(chipX - 7, chipY + 8 + i * 12, 7, 4, hx("#c9a227"), 1);
    rect(chipX + cs, chipY + 8 + i * 12, 7, 4, hx("#c9a227"), 1);
  }
  drawText("NVDA", chipX + cs / 2, chipY + cs / 2 - 6, 12, { align: "center", color: hx("#ffffff"), weight: 0.13 });
  // Chart: axes + rising line + arrow.
  const ax = x + 116, ay = y + 88, aw = w - 130, ah = 62;
  line(ax, ay, ax + aw, ay, 1.6, MUTED, 1);
  line(ax, ay, ax, ay - ah, 1.6, MUTED, 1);
  polyline([[ax + 4, ay - 8], [ax + aw * 0.3, ay - 18], [ax + aw * 0.55, ay - 16], [ax + aw * 0.8, ay - 40], [ax + aw - 4, ay - 56]], 3, GREEN, 1);
  fillPoly([[ax + aw - 12, ay - 56], [ax + aw + 2, ay - 56], [ax + aw - 5, ay - 66]], GREEN, 1);
  drawText("+33%", ax + aw * 0.52, y + 8, 26, { color: GREEN, weight: 0.13 });
  drawText("Nasdaq +6% · S&P +4%", ax, y + 96, 12.5, { weight: 0.11 });
}

function drawLibya(x, y, w) {
  // Sky + sea, horizon at y+54. Corvette ~280 px wide with depth:
  // hull gradient bands, top-edge highlight, deck details, water reflection.
  const hor = y + 54;
  vBands(x, y, w, [[hor, "#cfdde6"], [y + 100, "#2a5d78"]]);
  // Reflection streaks under the hull (drawn before the hull).
  // Corvette hull: bow right.
  const hx0 = x + 12, hx1 = x + w - 8, hy = y + 30, hh = 30;
  // Hull gradient: three bands, lighter on top.
  fillPoly([[hx0, hy], [hx1 - 18, hy], [hx1, hy + 10], [hx1 - 8, hy + hh], [hx0, hy + hh]], hx("#2c4356"), 1);
  fillPoly([[hx0, hy + 11], [hx1 - 13, hy + 11], [hx1 - 6, hy + hh], [hx0, hy + hh]], hx("#1d2f40"), 1);
  fillPoly([[hx0, hy + 21], [hx1 - 9, hy + 21], [hx1 - 6, hy + hh], [hx0, hy + hh]], hx("#12202d"), 1);
  // Top-edge highlight (sun on the sheer line).
  line(hx0 + 2, hy + 1, hx1 - 18, hy + 1, 2.2, hx("#aebfce"), 0.9);
  // Waterline + reflection streaks below the hull.
  line(hx0, hy + hh, hx1 - 8, hy + hh, 1.6, hx("#8fa8b5"), 0.7);
  for (let i = 0; i < 7; i++) {
    const rx = hx0 + 14 + i * 36 + rr(-6, 6);
    rect(rx, hy + hh + 2, 5, rr(6, 16), hx("#1d2f40"), 0.35);
  }
  // Deck details: turret, funnel, mast, radar, deck line.
  line(hx0 + 4, hy + 3, hx1 - 22, hy + 3, 1.4, hx("#5a7386"), 0.9);
  ellipse(hx0 + 34, hy - 2, 12, 5, hx("#22384a"), 1); // turret
  line(hx0 + 44, hy - 2, hx0 + 62, hy - 2, 2.4, hx("#22384a"), 1); // gun barrel
  rect(hx0 + 108, hy - 16, 22, 16, hx("#263c4e"), 1); // funnel
  rect(hx0 + 108, hy - 19, 22, 3, hx("#c8a24a"), 1); // funnel cap
  line(hx0 + 168, hy - 26, hx0 + 168, hy, 2.4, hx("#22384a"), 1); // mast
  line(hx0 + 158, hy - 20, hx0 + 178, hy - 20, 2, hx("#22384a"), 1);
  line(hx0 + 160, hy - 26, hx0 + 176, hy - 14, 1.6, hx("#22384a"), 1);
  ellipse(hx0 + 168, hy - 28, 5, 3, hx("#22384a"), 1); // radar
  for (let i = 0; i < 5; i++) rect(hx0 + 196 + i * 9, hy - 6, 4, 6, hx("#31485c"), 1); // deck boxes
  // Plume at the bow + small fire on the foredeck. All smoke stays above horizon.
  plume(hx1 - 26, hy + 2, y + 6, 30, false);
  // Sea drone (52 px) with dotted path + orange light, bottom right.
  const dx = x + w - 66, dy = y + 84;
  fillPoly([[dx, dy], [dx + 52, dy], [dx + 46, dy + 9], [dx + 6, dy + 9]], hx("#22201d"), 1);
  line(dx + 8, dy - 2, dx + 44, dy - 2, 2, hx("#3a3d3f"), 1);
  disc(dx + 46, dy - 4, 3.2, hx("#f08a1d"), 1);
  disc(dx + 46, dy - 4, 5.5, hx("#f08a1d"), 0.35);
  for (let i = 0; i < 7; i++) disc(dx - 8 - i * 7, dy + 5 + Math.sin(i * 1.2) * 2, 1.6, hx("#dfe7ea"), 0.9);
  pill("LIBYA", x + 4, y + 2, 13, NAVY, hx("#ffffff"));
}

function drawEstonia(x, y, w) {
  // Sky, ground, striped barrier, warning triangle, labels 18 px below posts.
  const gnd = y + 50;
  vBands(x, y, w, [[gnd, "#d7e2e8"], [y + 100, "#9aa78f"]]);
  // Warning triangle on its pole (left of the barrier).
  const tx = x + 62, ty = y + 8;
  line(tx, ty + 26, tx, gnd + 22, 2.4, INK, 1);
  fillPoly([[tx - 16, ty + 26], [tx + 16, ty + 26], [tx, ty]], hx("#f7c948"), 1);
  polyline([[tx - 16, ty + 26], [tx + 16, ty + 26], [tx, ty], [tx - 16, ty + 26]], 2, INK, 1);
  drawText("!", tx, ty + 8, 15, { align: "center", weight: 0.13 });
  // Barrier: striped bar on two posts. Posts end at y+72.
  const bx0 = x + 96, bx1 = x + w - 30, by = y + 30, bh = 12, postEnd = y + 72;
  rect(bx0, by, bx1 - bx0, bh, hx("#f7f2e7"), 1);
  for (let sx = bx0; sx < bx1; sx += 16) {
    const x0 = sx, x1 = Math.min(sx + 8, bx1);
    fillPoly([[x0, by], [x1, by], [x1 - 6, by + bh], [x0 - 6, by + bh]], hx("#c0392b"), 1);
  }
  rect(bx0 - 2, by - 2, bx1 - bx0 + 4, 2, INK, 1);
  rect(bx0 - 2, by + bh, bx1 - bx0 + 4, 2, INK, 1);
  rect(bx0 + 6, by + bh, 8, postEnd - (by + bh), INK, 1);
  rect(bx1 - 14, by + bh, 8, postEnd - (by + bh), INK, 1);
  // Labels 18 px below the post ends, kept apart so they cannot touch.
  drawText("ESTONIA", x + 30, postEnd + 18, 13, { weight: 0.12 });
  drawText("RUSSIA", x + w - 30, postEnd + 18, 13, { align: "right", weight: 0.12 });
  pill("EUROPE", x + w - 78, y + 2, 12.5, NAVY, hx("#ffffff"));
}

function drawSecondary() {
  const cols = [
    { x: X0, tag: "TECHNOLOGY", head: "HUANG RETURNS AS NVIDIA CEO", facts: "Huang returns as CEO 11 days after resigning; shares +33%. Trump pressed the board.", draw: drawNvidia },
    { x: X0 + 318, tag: "LIBYA", head: "SEA DRONES SINK RUSSIAN CORVETTE", facts: "Seven sea drones sank corvette Merkury off Benghazi; MV Angara also hit, Ka-27 destroyed.", draw: drawLibya },
    { x: X0 + 636, tag: "EUROPE", head: "ESTONIA TO SHUT BORDER WITH RUSSIA", facts: "Tallinn shuts its land border from 1 Dec for 6 months; Moscow: \u2018on the verge of triggering open war\u2019.", draw: drawEstonia }
  ];
  const pw = 300;
  for (const c of cols) {
    c.draw(c.x, 612, pw);
    const hl = wrapText(c.head, pw, 21, 0.72);
    let hy = 724;
    for (const ln of hl) {
      drawText(ln, c.x, hy, 21, { weight: 0.13 });
      hy += 26;
    }
    const fl = wrapText(c.facts, pw, 16.5, 0.72);
    let fy = 780;
    for (const ln of fl) {
      const w = drawText(ln, c.x, fy, 16.5, { weight: 0.11 });
      console.log("W sec-fact " + JSON.stringify(ln) + " width=" + Math.round(w));
      fy += 24;
    }
    console.log("W sec head=" + JSON.stringify(c.head) + " lines=" + hl.length + " factLines=" + fl.length);
  }
  rule(858, 2);
}

function drawBriefs() {
  drawText("IN BRIEF", X0, 870, 19, { weight: 0.13 });
  const items = [
    "GAZA — Israeli strikes kill at least 3, incl. UNRWA worker Adel al-Helo",
    "INDONESIA — 26 body bags identified, 28 still missing after Banten factory fire",
    "MEGASPEED — US blacklists 7 firms in Nvidia case",
    "ZELENSKY — Urges 4-way Russia–US–Europe talks \u2018as soon as possible\u2019",
    "S. KOREA — Russian jets enter air defence zone; fighters scrambled",
    "BANGLADESH — Mass typhoid vaccination of 50m children begins"
  ];
  const colW = 458, colX = [X0, X0 + 478];
  items.forEach((it, i) => {
    const cx = colX[i % 2], cy = 890 + Math.floor(i / 2) * 40;
    const lines = wrapText(it, colW, 16.5, 0.72);
    let ly = cy;
    for (const ln of lines) {
      const w = drawText(ln, cx, ly, 16.5, { weight: 0.11 });
      console.log("W brief " + JSON.stringify(ln) + " width=" + Math.round(w));
      ly += 19;
    }
    console.log("W brief-item lines=" + lines.length + " " + JSON.stringify(it));
  });
  drawText("Sources: Reuters · AP · AFP · The Times · Le Monde · TRENDS MENA · JMIC · UNSMIL — 24 Nov 2026", CX, 1010, 9.5, { align: "center", color: MUTED, weight: 0.11 });
}

// ---------------------------------------------------------------------------
// PNG encoder (filter 0, zlib level 9) + CRC32
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(rgb) {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    rgb.copy(raw, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))
  ]);
}
function downsample() {
  const rgb = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const i = ((y * SS + sy) * SW + (x * SS + sx)) * 3;
      r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
    }
    const o = (y * W + x) * 3, d = SS * SS;
    rgb[o] = Math.round(r / d); rgb[o + 1] = Math.round(g / d); rgb[o + 2] = Math.round(b / d);
  }
  return rgb;
}

// ---------------------------------------------------------------------------
// Dossier: facts + sources (deterministic JSON)
// ---------------------------------------------------------------------------
function dossier() {
  return {
    title: "THE WORLD — Tuesday, 24 November 2026",
    competition: "news-image-20261124",
    version: "v5",
    date: "2026-11-24",
    lead: {
      headline: "MINES IN THE STRAIT OF HORMUZ",
      facts: [
        "Three tankers hit sea mines in the Strait of Hormuz and caught fire under US air escort; the IRGC claim is not independently verified.",
        "Qatar PM met VP Vance and Secretary Rubio in Washington to mediate; Qatar: the region 'could not withstand another escalation'.",
        "US Treasury sanctioned 22 firms and 8 people over Iran shadow banking, $14.7bn in suspicious transactions. JMIC: threat 'severe', further attacks 'highly likely'."
      ],
      sources: ["TRENDS MENA (2026-11-24T03:37:47Z)", "Dubai Standard", "AJVC sitrep 24 Nov 02:31 UTC"]
    },
    secondary: [
      {
        headline: "HUANG RETURNS AS NVIDIA CEO",
        facts: [
          "Board restores Jensen Huang as CEO 11 days after he stepped down; shares +33%, Nasdaq +6%, S&P 500 +4%.",
          "Trump pressed the board; board: 'no national security risk' after US government input."
        ],
        sources: ["Reuters", "CNN", "WSJ (announced 23 Nov)"]
      },
      {
        headline: "SEA DRONES SINK RUSSIAN CORVETTE",
        facts: [
          "Ukrainian sea drones sank the Russian corvette Merkury off Benghazi and hit cargo ship MV Angara; 7 drones, a Ka-27 helicopter also destroyed.",
          "UNSMIL calls for an independent, immediate, transparent investigation."
        ],
        sources: ["The Times", "Le Monde", "AFP / UN News (attack 22 Nov; probe calls 23 Nov; headline 24 Nov)"]
      },
      {
        headline: "ESTONIA TO SHUT BORDER WITH RUSSIA",
        facts: [
          "Tallinn to close its land border from 1 December for at least 6 months; Moscow: the move is 'on the verge of triggering open war'.",
          "Estonia denies letting its territory be used for military operations by other states."
        ],
        sources: ["Reuters (23 Nov; headline 24 Nov)"]
      }
    ],
    briefs: [
      { label: "GAZA", fact: "Israeli strikes kill at least 3, incl. UNRWA worker Adel al-Helo at a Jabalia well.", source: "Reuters, 23 Nov" },
      { label: "INDONESIA", fact: "26 body bags identified, 28 still missing after the Banten candy factory fire.", source: "ThedailyID, 24 Nov" },
      { label: "MEGASPEED", fact: "US blacklists 7 firms in the Nvidia spy case.", source: "first reported 24 Nov 00:52 UTC" },
      { label: "ZELENSKY", fact: "Urges 4-way Russia–US–Europe talks 'as soon as possible'.", source: "24 Nov 00:30 UTC" },
      { label: "S. KOREA", fact: "Russian jets enter the air defence zone; fighters scrambled.", source: "24 Nov 01:04 UTC" },
      { label: "BANGLADESH", fact: "Mass typhoid vaccination of 50 million children begins.", source: "24 Nov" }
    ],
    note: "Lead story first reported 24 Nov UTC. Secondary stories first reported 23 Nov (US time) and dominated the 24 Nov news cycle; briefs Megaspeed, Zelensky, South Korea are 24 Nov UTC."
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const out = process.argv[2] || "/output";
  fs.mkdirSync(out, { recursive: true });
  fillPaper();
  drawMasthead();
  drawLead();
  drawSecondary();
  drawBriefs();
  const png = encodePNG(downsample());
  fs.writeFileSync(path.join(out, "entry.png"), png);
  const dj = JSON.stringify(dossier(), null, 2) + "\n";
  fs.writeFileSync(path.join(out, "dossier.json"), dj);
  console.log("DONE entry.png bytes=" + png.length + " dossier.json bytes=" + dj.length);
}
main();
