// THE WORLD — Tuesday, 24 November 2026.
// A program that draws one newspaper front page summing up the day's world
// news and writes it to /output/entry.png (1024x1024, <=1 MiB) plus a
// dossier of the verified facts behind it to /output/dossier.json.
//
// Facts were verified live on 24 Nov 2026 from Reuters, TRENDS MENA,
// The Times, Le Monde, Al Jazeera, The Daily Edition and other outlets.
// See dossier.json for the source of every fact.
//
// Node 22 stdlib only. No network at run time. Fully deterministic:
// the same bytes on every run (no clock, no randomness, fixed palette).

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

// ---------------------------------------------------------------- palette
const PAPER: RGB = [246, 241, 229];
const INK: RGB = [23, 19, 14];
const RED: RGB = [169, 31, 22];
const BLUE: RGB = [20, 69, 110];
const TEAL: RGB = [24, 92, 102];
const TEAL_D: RGB = [16, 66, 76];
const SAND: RGB = [217, 196, 154];
const SAND_D: RGB = [198, 172, 122];
const GOLD: RGB = [185, 138, 29];
const GREEN: RGB = [26, 120, 62];
const GREY: RGB = [110, 108, 100];
const WHITE: RGB = [250, 248, 242];
const ORANGE: RGB = [224, 110, 30];
const SMOKE: RGB = [140, 138, 130];

type RGB = [number, number, number];

// ---------------------------------------------------------------- canvas
const W = 1024;
const H = 1024;
const SS = 2; // supersampling factor
const PW = W * SS;
const PH = H * SS;
const px = new Uint8Array(PW * PH * 3);

function setPx(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= PW || y >= PH) return;
  const i = (y * PW + x) * 3;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
}

// Final (1024-space) coordinates; internally scaled by SS.
function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.round(x * SS);
  const y0 = Math.round(y * SS);
  const x1 = Math.round((x + w) * SS);
  const y1 = Math.round((y + h) * SS);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) setPx(xx, yy, c);
  }
}

function hline(x: number, y: number, w: number, t: number, c: RGB): void {
  rect(x, y - t / 2, w, t, c);
}

// Bresenham line with square thickness.
function line(x0: number, y0: number, x1: number, y1: number, t: number, c: RGB): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  const r = t / 2;
  for (let i = 0; i <= steps; i++) {
    const x = x0 + (dx * i) / steps;
    const y = y0 + (dy * i) / steps;
    rect(x - r, y - r, t, t, c);
  }
}

function circle(cx: number, cy: number, r: number, c: RGB): void {
  const x0 = Math.round((cx - r) * SS);
  const x1 = Math.round((cx + r) * SS);
  const y0 = Math.round((cy - r) * SS);
  const y1 = Math.round((cy + r) * SS);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const fx = xx / SS;
      const fy = yy / SS;
      const ddx = fx - cx;
      const ddy = fy - cy;
      if (ddx * ddx + ddy * ddy <= r * r) setPx(xx, yy, c);
    }
  }
}

function ring(cx: number, cy: number, r: number, t: number, c: RGB): void {
  const x0 = Math.round((cx - r - t) * SS);
  const x1 = Math.round((cx + r + t) * SS);
  const y0 = Math.round((cy - r - t) * SS);
  const y1 = Math.round((cy + r + t) * SS);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const fx = xx / SS;
      const fy = yy / SS;
      const d = Math.sqrt((fx - cx) ** 2 + (fy - cy) ** 2);
      if (d >= r - t / 2 && d <= r + t / 2) setPx(xx, yy, c);
    }
  }
}

// Scanline polygon fill. pts: [x, y][] in final coordinates.
function poly(pts: Array<[number, number]>, c: RGB): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of pts) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  for (let yy = Math.round(minY * SS); yy <= Math.round(maxY * SS); yy++) {
    const y = yy / SS;
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      rect(xs[k], y, xs[k + 1] - xs[k], 1 / SS + 0.6, c);
    }
  }
}

function tri(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
  poly(
    [
      [x0, y0],
      [x1, y1],
      [x2, y2],
    ],
    c,
  );
}

// ---------------------------------------------------------------- 5x7 font
// Each glyph: 7 rows, 5 bits each (bit 4 = leftmost column).
const FONT: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  "0": [14, 17, 19, 21, 25, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 6, 8, 16, 31],
  "3": [31, 2, 4, 2, 1, 17, 14],
  "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [6, 8, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 2, 12],
  " ": [0, 0, 0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 12, 12],
  ",": [0, 0, 0, 0, 12, 12, 4],
  ":": [0, 12, 12, 0, 12, 12, 0],
  ";": [0, 12, 12, 0, 12, 12, 4],
  "!": [4, 4, 4, 4, 4, 0, 4],
  "?": [14, 17, 1, 2, 4, 0, 4],
  "-": [0, 0, 0, 14, 0, 0, 0],
  "—": [0, 0, 0, 14, 0, 0, 0],
  "/": [1, 2, 2, 4, 8, 8, 16],
  "(": [2, 4, 8, 8, 8, 4, 2],
  ")": [8, 4, 2, 2, 2, 4, 8],
  $: [4, 15, 20, 14, 5, 30, 4],
  "%": [25, 26, 2, 4, 8, 22, 19],
  "&": [12, 18, 20, 8, 21, 18, 13],
  "+": [0, 4, 4, 31, 4, 4, 0],
  "=": [0, 0, 31, 0, 31, 0, 0],
  "'": [4, 4, 8, 0, 0, 0, 0],
  '"': [10, 10, 0, 0, 0, 0, 0],
  "•": [0, 0, 12, 12, 12, 0, 0],
};

function glyph(ch: string): number[] {
  return FONT[ch] ?? FONT["?"];
}

// Width of one character cell (5 glyph cols + 1 gap col) at a given size.
function charW(size: number): number {
  return (6 * size) / 7;
}

// Extra gap between words, as a fraction of size (wide on purpose: the
// word gap must read clearly wider than the gap between letters).
const WORD_GAP = 0.45;

function textW(s: string, size: number): number {
  let w = 0;
  for (const ch of s) {
    w += ch === " " ? charW(size) + size * WORD_GAP : charW(size);
  }
  return w;
}

function drawGlyph(x: number, y: number, size: number, ch: string, c: RGB, bold: boolean): void {
  const rows = glyph(ch);
  const unit = (size * SS) / 7;
  const x0 = Math.round(x * SS);
  const y0 = Math.round(y * SS);
  const passes = bold ? [0, Math.max(1, Math.round(unit * 0.28))] : [0];
  for (const dx of passes) {
    for (let r = 0; r < 7; r++) {
      for (let col = 0; col < 5; col++) {
        if ((rows[r] >> (4 - col)) & 1) {
          const gx = x0 + dx + Math.round(col * unit);
          const gy = y0 + Math.round(r * unit);
          const gw = Math.ceil(unit);
          const gh = Math.ceil(unit);
          for (let yy = gy; yy < gy + gh; yy++) {
            for (let xx = gx; xx < gx + gw; xx++) setPx(xx, yy, c);
          }
        }
      }
    }
  }
}

interface TextOpts {
  size: number;
  color: RGB;
  bold?: boolean;
  align?: "left" | "center" | "right";
  maxW?: number;
  lh?: number; // line height multiplier
}

// Draw text with word wrap. Returns the y just below the last line.
function text(
  x: number,
  y: number,
  s: string,
  o: TextOpts,
): number {
  const size = o.size;
  const lh = size * (o.lh ?? 1.32);
  const maxW = o.maxW ?? Infinity;
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur === "" ? w : cur + " " + w;
    if (textW(trial, size) <= maxW || cur === "") {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  let yy = y;
  for (const ln of lines) {
    const w = textW(ln, size);
    let xx = x;
    if (o.align === "center") xx = x + (maxW === Infinity ? 0 : (maxW - w) / 2);
    if (o.align === "right") xx = x + (maxW === Infinity ? 0 : maxW - w);
    let cx = xx;
    for (const ch of ln) {
      if (ch !== " ") drawGlyph(cx, yy, size, ch, o.color, o.bold ?? false);
      cx += ch === " " ? charW(size) + size * WORD_GAP : charW(size);
    }
    yy += lh;
  }
  return yy;
}

// ---------------------------------------------------------------- scenes
// LEAD: the Strait of Hormuz. Sand coast of Iran along the top, the strait
// as a teal band, three tankers (the middle one burning), naval mines,
// and the Omani shore at bottom right.
function drawStrait(x: number, y: number, w: number, h: number): void {
  // sea
  rect(x, y, w, h, TEAL);
  // lighter sea band
  rect(x, y + h * 0.42, w, h * 0.2, [32, 108, 118]);
  // Iran coast (top)
  poly(
    [
      [x, y],
      [x + w, y],
      [x + w, y + 52],
      [x + w * 0.72, y + 66],
      [x + w * 0.55, y + 44],
      [x + w * 0.34, y + 62],
      [x + w * 0.16, y + 40],
      [x, y + 58],
    ],
    SAND,
  );
  // Oman shore (bottom right)
  poly(
    [
      [x + w * 0.62, y + h],
      [x + w, y + h],
      [x + w, y + h - 46],
      [x + w * 0.86, y + h - 58],
      [x + w * 0.7, y + h - 34],
    ],
    SAND_D,
  );
  // wave lines
  for (let i = 0; i < 5; i++) {
    const wy = y + h * 0.5 + i * 16;
    line(x + 30 + i * 12, wy, x + 190 + i * 12, wy + 5, 2, [90, 160, 170]);
    line(x + w - 260 + i * 8, wy + 26, x + w - 90 + i * 8, wy + 30, 2, [90, 160, 170]);
  }
  // tankers
  drawTanker(x + 120, y + 128, 190, false);
  drawTanker(x + 380, y + 150, 210, true);
  drawTanker(x + 660, y + 122, 180, false);
  // naval mines (spiked circles)
  drawMine(x + 400, y + 205, 11);
  drawMine(x + 560, y + 96, 10);
  drawMine(x + 740, y + 180, 11);
  drawMine(x + 180, y + 92, 9);
  // labels
  text(x + 22, y + 14, "IRAN", { size: 17, color: [90, 70, 40], bold: true });
  text(x + w - 118, y + h - 34, "OMAN", { size: 17, color: [90, 70, 40], bold: true });
  text(x + 30, y + h - 40, "STRAIT OF HORMUZ", { size: 19, color: WHITE, bold: true });
  // frame
  rect(x, y, w, 3, INK);
  rect(x, y + h - 3, w, 3, INK);
  rect(x, y, 3, h, INK);
  rect(x + w - 3, y, 3, h, INK);
}

function drawTanker(x: number, y: number, len: number, burning: boolean): void {
  const hullH = 26;
  // hull
  poly(
    [
      [x, y],
      [x + len - 26, y],
      [x + len, y + hullH * 0.55],
      [x + len - 14, y + hullH],
      [x + 8, y + hullH],
      [x, y + hullH * 0.7],
    ],
    [32, 36, 42],
  );
  // deck line
  line(x + 6, y + 4, x + len - 30, y + 4, 2, [120, 124, 130]);
  // bridge tower
  rect(x + len * 0.62, y - 26, 26, 26, WHITE);
  rect(x + len * 0.62, y - 26, 26, 5, RED);
  // funnel
  rect(x + len * 0.3, y - 14, 12, 14, [200, 60, 40]);
  if (burning) {
    // flame
    tri(x + len * 0.42, y - 6, x + len * 0.52, y - 52, x + len * 0.6, y - 6, ORANGE);
    tri(x + len * 0.46, y - 6, x + len * 0.52, y - 34, x + len * 0.57, y - 6, [255, 200, 60]);
    // smoke
    circle(x + len * 0.52, y - 62, 13, SMOKE);
    circle(x + len * 0.58, y - 80, 16, SMOKE);
    circle(x + len * 0.5, y - 98, 12, [160, 158, 150]);
  }
}

function drawMine(cx: number, cy: number, r: number): void {
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    line(cx, cy, cx + Math.cos(a) * (r + 7), cy + Math.sin(a) * (r + 7), 2, INK);
  }
  circle(cx, cy, r, INK);
  circle(cx - 2, cy - 2, 3, [70, 72, 76]);
}

// SECONDARY 1: Nvidia — dark chip panel, rising chart, +33%.
function drawNvidia(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [16, 22, 34]);
  // chip
  const cx = x + 52;
  const cy = y + h / 2 - 4;
  rect(cx - 30, cy - 30, 60, 60, [30, 44, 66]);
  for (let i = -1; i <= 1; i++) {
    line(cx - 40, cy + i * 18, cx - 30, cy + i * 18, 3, GREEN);
    line(cx + 30, cy + i * 18, cx + 40, cy + i * 18, 3, GREEN);
    line(cx + i * 18, cy - 40, cx + i * 18, cy - 30, 3, GREEN);
    line(cx + i * 18, cy + 30, cx + i * 18, cy + 40, 3, GREEN);
  }
  rect(cx - 22, cy - 22, 44, 44, [20, 32, 52]);
  text(cx - 21, cy - 8, "NVDA", { size: 13, color: [120, 230, 150], bold: true });
  // rising chart
  const pts: Array<[number, number]> = [
    [x + 118, y + h - 22],
    [x + 158, y + h - 34],
    [x + 196, y + h - 26],
    [x + 234, y + h - 46],
    [x + 272, y + 22],
  ];
  for (let i = 0; i + 1 < pts.length; i++) {
    line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 4, GREEN);
  }
  tri(pts[4][0] - 12, pts[4][1] + 4, pts[4][0] + 8, pts[4][1] + 2, pts[4][0] - 2, pts[4][1] - 14, GREEN);
  text(x + 118, y + 8, "+33%", { size: 26, color: GREEN, bold: true });
}

// SECONDARY 2: Libya — sea, coast, a sinking corvette, sea drones.
function drawLibya(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, BLUE);
  rect(x, y, w, 8, [120, 170, 200]);
  // coast at bottom
  poly(
    [
      [x, y + h],
      [x + w, y + h],
      [x + w, y + h - 26],
      [x + w * 0.6, y + h - 38],
      [x + w * 0.3, y + h - 24],
      [x, y + h - 34],
    ],
    SAND,
  );
  // corvette, listing
  const sx = x + 96;
  const sy = y + 40;
  poly(
    [
      [sx, sy],
      [sx + 130, sy + 6],
      [sx + 138, sy + 16],
      [sx + 120, sy + 24],
      [sx + 10, sy + 20],
    ],
    [52, 56, 62],
  );
  rect(sx + 44, sy - 12, 10, 14, [52, 56, 62]);
  line(sx + 48, sy - 26, sx + 50, sy - 12, 3, [52, 56, 62]);
  // smoke + fire at the bow
  circle(sx + 132, sy - 8, 10, SMOKE);
  circle(sx + 142, sy - 20, 13, SMOKE);
  tri(sx + 118, sy + 2, sx + 132, sy - 26, sx + 142, sy + 2, ORANGE);
  // sea drones: small dots with dashed approach lines
  for (let i = 0; i < 3; i++) {
    const dx = x + 34 + i * 16;
    const dy = y + h - 52 + i * 6;
    circle(dx, dy, 4, WHITE);
    line(dx + 6, dy, dx + 26, dy - 8, 2, WHITE);
  }
  text(x + 12, y + 8, "BENGHAZI", { size: 14, color: WHITE, bold: true });
  text(x + w - 92, y + h - 22, "LIBYA", { size: 14, color: [90, 70, 40], bold: true });
}

// SECONDARY 3: Estonia — a striped border barrier and a warning triangle.
function drawEstonia(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [232, 226, 210]);
  // ground
  rect(x, y + h - 22, w, 22, [190, 182, 160]);
  // barrier: striped bar on two posts
  const by = y + 30;
  for (let i = 0; i < 12; i++) {
    rect(x + 16 + i * 24, by, 24, 12, i % 2 === 0 ? RED : WHITE);
  }
  rect(x + 20, by + 12, 8, h - 52, INK);
  rect(x + w - 28, by + 12, 8, h - 52, INK);
  // warning triangle
  const tx = x + w - 78;
  const ty = y + h - 58;
  tri(tx, ty - 26, tx - 22, ty + 12, tx + 22, ty + 12, GOLD);
  tri(tx, ty - 20, tx - 17, ty + 8, tx + 17, ty + 8, [240, 200, 60]);
  rect(tx - 2, ty - 12, 4, 14, INK);
  circle(tx, ty + 4, 2, INK);
  text(x + 14, y + 8, "ESTONIA", { size: 14, color: INK, bold: true });
  text(x + 40, y + h - 18, "RUSSIA", { size: 14, color: INK, bold: true });
}

// ---------------------------------------------------------------- compose
function compose(): void {
  rect(0, 0, W, H, PAPER);
  const MX = 26; // side margin
  const CW = W - MX * 2; // content width = 972

  // ---- masthead
  const mast = "THE WORLD";
  text((W - textW(mast, 96)) / 2, 22, mast, { size: 96, color: INK, bold: true });
  hline(MX, 126, CW, 4, INK);
  hline(MX, 134, CW, 2, INK);
  const dateLine = "TUESDAY, 24 NOVEMBER 2026  •  IN ONE IMAGE";
  text((W - textW(dateLine, 20)) / 2, 142, dateLine, { size: 20, color: INK, bold: true });

  // ---- lead story
  const leadY = 168;
  const leadH = 230;
  drawStrait(MX, leadY, CW, leadH);
  let cy = leadY + leadH + 14;
  text(MX, cy, "THE GULF  •  IRAN SAYS", { size: 18, color: RED, bold: true });
  cy += 26;
  cy = text(MX, cy, "THREE TANKERS HIT MINES IN HORMUZ", {
    size: 44,
    color: INK,
    bold: true,
    maxW: CW,
    lh: 1.12,
  });
  cy += 6;
  cy = text(MX, cy, "FIRES AFTER BLASTS UNDER U.S. AIR ESCORT", {
    size: 19,
    color: INK,
    maxW: CW,
  });
  cy = text(MX, cy, "QATAR MEDIATES IN WASHINGTON; VANCE, RUBIO MEET PM", {
    size: 19,
    color: INK,
    maxW: CW,
  });
  cy = text(MX, cy, "U.S. SANCTIONS 22 FIRMS, 8 PEOPLE OVER $14.7BN", {
    size: 19,
    color: INK,
    maxW: CW,
  });
  hline(MX, cy + 8, CW, 2, INK);

  // ---- secondaries: three columns
  const secY = cy + 24;
  const secW = 310;
  const secGap = (CW - secW * 3) / 2;
  const cols: Array<{
    label: string;
    labelColor: RGB;
    headline: string;
    fact: string;
    draw: (x: number, y: number, w: number, h: number) => void;
  }> = [
    {
      label: "TECH  •  MARKETS",
      labelColor: GREEN,
      headline: "NVIDIA BRINGS BACK HUANG",
      fact: "SHARES +33% AFTER TRUMP PUSH",
      draw: drawNvidia,
    },
    {
      label: "LIBYA  •  WAR AT SEA",
      labelColor: BLUE,
      headline: "UKRAINE SINKS SHIP IN LIBYA",
      fact: "UN SEEKS PROBE; 7 SEA DRONES",
      draw: drawLibya,
    },
    {
      label: "NATO  •  ESTONIA",
      labelColor: RED,
      headline: "RUSSIA WARNS ESTONIA OF WAR",
      fact: "BORDER SHUTS 1 DEC; TALLINN DENIES",
      draw: drawEstonia,
    },
  ];
  const illH = 80;
  let secBottom = 0;
  cols.forEach((c, i) => {
    const x = MX + i * (secW + secGap);
    text(x, secY, c.label, { size: 14, color: c.labelColor, bold: true });
    c.draw(x, secY + 20, secW, illH);
    let yy = secY + 20 + illH + 8;
    yy = text(x, yy, c.headline, { size: 22, color: INK, bold: true, maxW: secW, lh: 1.15 });
    yy += 2;
    yy = text(x, yy, c.fact, { size: 15, color: INK, maxW: secW, lh: 1.25 });
    if (yy > secBottom) secBottom = yy;
  });
  hline(MX, secBottom + 8, CW, 2, INK);

  // ---- footer: IN BRIEF
  const footY = secBottom + 20;
  text(MX, footY, "IN BRIEF", { size: 18, color: INK, bold: true });
  text(MX, footY + 2, "SOURCES: REUTERS, TRENDS MENA, THE TIMES, AL JAZEERA", {
    size: 12,
    color: GREY,
    align: "right",
    maxW: CW,
  });
  const briefs = [
    "GAZA — ISRAELI STRIKES KILL 3, INCLUDING UNRWA WORKER",
    "INDONESIA — 26 BODY BAGS FOUND, 28 MISSING AFTER FIRE",
    "U.S. BLACKLISTS MEGASPEED, 7 FIRMS IN SPY CASE",
    "ZELENSKY SEEKS 4-WAY TALKS WITH RUSSIA, U.S., EUROPE",
    "S. KOREA SCRAMBLES JETS AS RUSSIAN PLANES ENTER ZONE",
    "BANGLADESH BEGINS TYPHOID DRIVE FOR 50M CHILDREN",
  ];
  const colW = (CW - 24) / 2;
  briefs.forEach((b, i) => {
    const bx = MX + (i % 2) * (colW + 24);
    const by = footY + 30 + Math.floor(i / 2) * 40;
    rect(bx, by + 3, 8, 8, RED);
    text(bx + 14, by, b, { size: 15, color: INK, maxW: colW - 14, lh: 1.25 });
  });
}

// ---------------------------------------------------------------- PNG out
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
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

function encodePNG(w: number, h: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter: none
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (1 + w * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Box-downsample the 2x buffer to 1024x1024.
function downsample(): Uint8Array {
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let ch = 0; ch < 3; ch++) {
        let s = 0;
        for (let dy = 0; dy < SS; dy++) {
          for (let dx = 0; dx < SS; dx++) {
            s += px[((y * SS + dy) * PW + x * SS + dx) * 3 + ch];
          }
        }
        out[(y * W + x) * 3 + ch] = Math.round(s / (SS * SS));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- dossier
const DOSSIER = {
  title: "THE WORLD — Tuesday, 24 November 2026",
  edition: "news-image-20261124 v1",
  lead: {
    headline: "THREE TANKERS HIT MINES IN HORMUZ",
    facts: [
      "Iran's Revolutionary Guard says three oil tankers caught fire after striking naval mines in the Strait of Hormuz while sailing under US air escort; the claim has not been independently verified.",
      "Qatar's prime minister met US Vice President JD Vance and Secretary of State Marco Rubio in Washington to mediate; Qatar said the region could not withstand another escalation.",
      "The US Treasury sanctioned 22 companies and 8 individuals tied to Iran's shadow banking network, flagging $14.7 billion in suspicious transactions.",
    ],
    sources: [
      "TRENDS MENA, 'IRGC says 3 oil tankers caught fire after striking naval mines in Strait of Hormuz', published 2026-11-24T03:37:47Z",
      "Dubai Standard, 'Middle East War: IRGC Claims, JMIC Reports and What Residents Need to Know Today (November 24, 2026)'",
      "ME Crisis Live, 2026-11-24 situation page",
    ],
  },
  secondary: [
    {
      headline: "NVIDIA BRINGS BACK HUANG",
      facts: [
        "Nvidia's board reinstated Jensen Huang as chief executive, 11 days after he resigned; shares jumped about 33% in early trading, the Nasdaq rose 6% and the S&P 500 rose 4%.",
        "President Trump pressed the board for Huang's return; the board said it received input from senior levels of the US government and saw no national security risk.",
      ],
      sources: [
        "Reuters, 'Nvidia reinstates Jensen Huang as CEO', 2026-11-23",
        "Reuters, 'At AI speed, Nvidia's Jensen Huang finds exoneration', 2026-11-24",
        "CNN, 'Nvidia board reinstates Jensen Huang as CEO', 2026-11-23",
      ],
    },
    {
      headline: "UKRAINE SINKS SHIP IN LIBYA",
      facts: [
        "Ukrainian naval drones sank the Russian corvette Merkury at Benghazi and hit the cargo vessel MV Angara; President Zelensky said seven drones were used and a Ka-27 helicopter was destroyed with the corvette.",
        "The UN Support Mission in Libya called for an immediate, independent and transparent investigation.",
      ],
      sources: [
        "The Times, 'Zelensky hails exemplary mission as Russian warships sunk in Libya', 2026-11-24",
        "Le Monde, 'Attacks on two Russian ships in Libyan waters mark new turn in Ukraine war', 2026-11-23",
        "AFP via UN News, 'UN urges probe after Russian ship attacked off Libya', 2026-11-23",
      ],
    },
    {
      headline: "RUSSIA WARNS ESTONIA OF WAR",
      facts: [
        "Russia's Foreign Ministry said Estonia's actions were 'on the verge of triggering open war' after Tallinn announced it will close its land border crossings with Russia from 1 December for at least six months.",
        "Estonia denied it allows its territory to be used for military operations by another country.",
      ],
      sources: [
        "Reuters, 'Moscow accuses Estonia of hostile actions on verge of triggering open war', 2026-11-23",
        "The Independent, Ukraine-Russia war live blog, 24 November 2026",
      ],
    },
  ],
  briefs: [
    {
      text: "GAZA — Israeli strikes kill 3, including UNRWA worker Adel al-Helo",
      source: "Reuters, 'Israeli strike kills worker with UN Palestinian agency in Gaza', 2026-11-23",
    },
    {
      text: "INDONESIA — 26 body bags identified, 28 still missing after factory fire",
      source: "ThedailyID, 'Banten Candy Factory Fire: 26 Body Bags Identified, 28 Workers Still Missing', Tuesday 24 November 2026",
    },
    {
      text: "U.S. BLACKLISTS MEGASPEED, 7 FIRMS IN NVIDIA SPY CASE",
      source: "Daily Summary Of, 'World News November 24, 2026: US blacklists Megaspeed', first reported 24 Nov 00:52 UTC",
    },
    {
      text: "ZELENSKY SEEKS 4-WAY TALKS WITH RUSSIA, U.S., EUROPE",
      source: "Daily Summary Of, 24 November 2026, first reported 24 Nov 00:30 UTC",
    },
    {
      text: "S. KOREA SCRAMBLES JETS AS RUSSIAN PLANES ENTER AIR ZONE",
      source: "Daily Summary Of, 24 November 2026, first reported 24 Nov 01:04 UTC",
    },
    {
      text: "BANGLADESH BEGINS TYPHOID DRIVE FOR 50 MILLION CHILDREN",
      source: "Access24, 'Bangladesh Launches Mass Typhoid Vaccination Drive', updated 24 November 2026",
    },
  ],
  notes:
    "Stories first reported late Monday 23 November in US time but during 24 November UTC are counted as 24 November news; the lead Hormuz story was first reported on 24 November UTC. The IRGC mine claim is reported as a claim, not as confirmed fact.",
};

// ---------------------------------------------------------------- main
function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  mkdirSync(outDir, { recursive: true });
  compose();
  const rgb = downsample();
  const png = encodePNG(W, H, rgb);
  writeFileSync(`${outDir}/entry.png`, png);
  writeFileSync(`${outDir}/dossier.json`, JSON.stringify(DOSSIER, null, 2) + "\n");
  console.log(`wrote ${outDir}/entry.png (${png.length} bytes)`);
  console.log(`wrote ${outDir}/dossier.json`);
}

main();
