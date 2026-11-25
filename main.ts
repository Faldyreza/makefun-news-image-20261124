// THE WORLD — Tuesday, 24 November 2026
// make.fun news-image-20261124, v10. A program that draws one newspaper front
// page summing up the world's news of 24 November 2026 and writes it to
// /output/entry.png (plus /output/dossier.json with the same facts + sources).
// Node 22 stdlib only, no network at run time, fully deterministic:
// two runs write byte-identical files.
//
// FACTS (all events of, or first reported on, 24 November 2026, any timezone;
// secondary stories first reported late 23 Nov US time but dominating the
// morning news cycle of 24 Nov — see honesty_note in dossier.json):
// LEAD — STRAIT OF HORMUZ: IRGC says three tankers were hit by sea mines in
//   the Strait of Hormuz, burning, while sailing under U.S. air escort; the
//   claim is NOT independently verified. Qatar's PM met VP Vance and
//   Secretary Rubio in Washington to mediate; Qatar says the region could
//   not withstand another escalation. U.S. Treasury sanctioned 22 firms and
//   8 people linked to Iranian shadow banking, $14.7bn in suspicious
//   transactions. JMIC threat level "severe", further attacks highly likely.
//   Sources: TRENDS MENA 2026-11-24T03:37:47Z, Dubai Standard, AJVC sitrep
//   24 Nov 02:31 UTC, Reuters.
// NVIDIA: board reinstated Jensen Huang as CEO 11 days after he stepped
//   down; shares +33% in early trading, Nasdaq +6%, S&P 500 +4%; Trump
//   pressed the board; board: "no national security risk" after U.S.
//   government input. Sources: Reuters, CNN, WSJ.
// LIBYA: Ukrainian sea drones sank the Russian corvette Merkury off Benghazi
//   and hit cargo ship MV Angara; Zelensky: seven drones, a Ka-27 helicopter
//   also destroyed; UNSMIL called for an independent investigation; Tripoli
//   demanded explanations from Kyiv. Sources: The Times, Le Monde, AFP,
//   UN News.
// ESTONIA: Russia's foreign ministry said Estonia's actions are "on the
//   verge of triggering open war" after Tallinn announced it will close its
//   land border from 1 December for at least six months; Estonia denies
//   letting its territory be used for military operations. Source: Reuters.
// BRIEFS (24 Nov, sources in dossier.json): Indonesia — 26 body bags
//   identified, 28 missing after the Banten candy factory fire (ThedailyID);
//   South Korea — a Russian aircraft entered the air defence zone, jets
//   scrambled (24 Nov 01:04 UTC); Bangladesh — mass typhoid vaccination of
//   50 million children began; Nepal — quake struck Koshi province near the
//   China border; Tiangong — China opened its station to its first foreign
//   astronaut, Pakistan's Zeeshan Ali; Megaspeed — the U.S. blacklisted seven
//   firms in the Nvidia spy case (first reported 24 Nov 00:52 UTC); Gaza —
//   Israeli strikes killed at least 3, including UNRWA worker Adel al-Helo
//   at a well in Jabalia (Reuters, 23 Nov); Rohingya — 14 countries backed
//   the ICJ ruling on Myanmar; UN AI — Guterres wants an AI-risk framework
//   within a year; Riyadh — Houthi drone hit the PIF Tower, 11 injured
//   (Al Jazeera, 24 Nov 21:33); Cartagena — gunmen held hostages in a
//   supermarket; Huawei — guilty of stealing trade secrets, acquitted of
//   racketeering (BBC); Measles — ninth death in the Pennsylvania outbreak;
//   COP31 — talks ended with no fossil-fuel transition call; DOJ — $8bn
//   recovered, 800+ charged in the largest anti-scam surge; Trump —
//   toppling Iran's regime "probably doable", but not his goal; China —
//   ex-official Ma sentenced to death for spying; Yemen — Houthis say
//   dozens dead in Saudi airstrikes; Libya — Tripoli demanded answers from
//   Kyiv; Venezuela — $237.5bn public debt disclosed ahead of
//   restructuring; NATO — detection aircraft to Poland after a missile
//   fell; UK — disability benefit shake-up could hit hundreds of thousands;
//   Hasina — ousted PM Sheikh Hasina set 16 December for her Bangladesh
//   return; Zelensky — urged four-party Russia-U.S.-Europe talks as soon
//   as possible (24 Nov 00:30 UTC). Markets close 24 Nov: S&P 500 +4.7% to
//   7,237, Nasdaq +6.5%, Brent crude -3% to $86.70, gold $3,620. Sport:
//   Ronaldo reached 987 career goals; Senegal regained the AFCON title
//   after a CAS appeal.
//
// Rendering: a small software rasteriser (2x supersampling + box
// downsample), a hand-built vector stroke font (8x14 grid, baseline y=11,
// cap top y=1, x-height top y=4, descender to y=14), and a self-written
// PNG encoder (zlib deflate + CRC32). No external assets, no fonts.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

// ---------------------------------------------------------------- palette
const PAPER = [246, 241, 229];
const INK = [23, 19, 14];
const MUTED = [90, 82, 72];
const FAINT = [168, 158, 143];
const RED = [163, 39, 27];
const REDDK = [122, 28, 19];
const NAVY = [30, 74, 110];
const TEAL = [15, 107, 92];
const OLIVE = [92, 107, 31];
const GOLD = [185, 138, 31];
const SKY = [191, 211, 222];
const SKY2 = [214, 228, 235];
const SEA = [46, 90, 116];
const SEA2 = [33, 66, 88];
const SAND = [217, 201, 163];
const SMOKE1 = [201, 194, 180];
const SMOKE2 = [169, 161, 147];
const SMOKE3 = [126, 119, 107];
const FIRE = [226, 112, 29];
const FIRE2 = [242, 160, 7];
const HULL = [110, 47, 36];
const HULL2 = [84, 36, 28];
const STEEL = [58, 65, 72];
const STEEL2 = [40, 46, 52];
const WHITE = [255, 255, 255];
const CREAM = [250, 246, 236];

// ---------------------------------------------------------------- rng (seeded)
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- rasteriser
const W = 1024, H = 1024, SS = 2, W2 = W * SS, H2 = H * SS;
const buf = new Uint8Array(W2 * H2 * 3);

function setPx(sx, sy, c) {
  if (sx < 0 || sy < 0 || sx >= W2 || sy >= H2) return;
  const i = (sy * W2 + sx) * 3;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
}
function rect(x, y, w, h, c) {
  const x0 = Math.max(0, Math.round(x * SS)), y0 = Math.max(0, Math.round(y * SS));
  const x1 = Math.min(W2, Math.round((x + w) * SS)), y1 = Math.min(H2, Math.round((y + h) * SS));
  for (let sy = y0; sy < y1; sy++) {
    const base = sy * W2 * 3;
    for (let sx = x0; sx < x1; sx++) {
      const i = base + sx * 3;
      buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
    }
  }
}
function disc(cx, cy, r, c) {
  const R = Math.max(0.5, r * SS);
  const x0 = Math.max(0, Math.floor((cx - r) * SS)), x1 = Math.min(W2 - 1, Math.ceil((cx + r) * SS));
  const y0 = Math.max(0, Math.floor((cy - r) * SS)), y1 = Math.min(H2 - 1, Math.ceil((cy + r) * SS));
  const ccx = cx * SS, ccy = cy * SS, rr = R * R;
  for (let sy = y0; sy <= y1; sy++) {
    const dy = sy + 0.5 - ccy;
    for (let sx = x0; sx <= x1; sx++) {
      const dx = sx + 0.5 - ccx;
      if (dx * dx + dy * dy <= rr) setPx(sx, sy, c);
    }
  }
}
function line(x0, y0, x1, y1, w, c) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil((len * SS) / Math.max(0.6, (w * SS) / 2.5)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    disc(x0 + dx * t, y0 + dy * t, w / 2, c);
  }
}
function poly(pts, w, c, closed) {
  const n = pts.length / 2;
  for (let i = 0; i + 1 < n; i++) {
    line(pts[i * 2], pts[i * 2 + 1], pts[(i + 1) * 2], pts[(i + 1) * 2 + 1], w, c);
  }
  if (closed && n > 2) line(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1], pts[0], pts[1], w, c);
}
function fillPoly(pts, c) {
  const n = pts.length / 2;
  let ymin = 1e9, ymax = -1e9;
  for (let i = 0; i < n; i++) { ymin = Math.min(ymin, pts[i * 2 + 1]); ymax = Math.max(ymax, pts[i * 2 + 1]); }
  for (let y = Math.max(0, Math.floor(ymin)); y <= Math.min(H - 1, Math.ceil(ymax)); y++) {
    const xs = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = pts[i * 2], ay = pts[i * 2 + 1], bx = pts[j * 2], by = pts[j * 2 + 1];
      if ((ay <= y + 0.5 && by > y + 0.5) || (by <= y + 0.5 && ay > y + 0.5)) {
        xs.push(ax + ((y + 0.5 - ay) / (by - ay)) * (bx - ax));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      rect(xs[k], y, xs[k + 1] - xs[k], 1, c);
    }
  }
}
function ellipseFill(cx, cy, rx, ry, c) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    const t = (y + 0.5 - cy) / ry;
    if (Math.abs(t) > 1) continue;
    const hw = rx * Math.sqrt(1 - t * t);
    rect(cx - hw, y, hw * 2, 1, c);
  }
}
function ellipsePts(cx, cy, rx, ry, n) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    pts.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
  }
  return pts;
}

// ---------------------------------------------------------------- stroke font
// Grid 8 wide x 14 tall. Baseline y=11, cap top y=1, x-height top y=4,
// descender bottom y=14. Each glyph: list of strokes; each stroke is a flat
// list of numbers [x0,y0,x1,y1,...]. el() returns one closed ellipse stroke.
function el(cx, cy, rx, ry) {
  const pts = [];
  for (let k = 0; k <= 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    pts.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
  }
  return pts;
}
const FONT = {
  "A": [[1, 11, 4, 1, 7, 11], [2.6, 7, 5.4, 7]],
  "B": [[1, 1, 1, 11], [1, 1, 5, 1, 6.5, 3, 5, 5.5, 1, 5.5], [1, 5.5, 5.5, 5.5, 7, 8, 5.5, 11, 1, 11]],
  "C": [[6.5, 3, 5, 1, 2, 1, 0.5, 4, 0.5, 8, 2, 11, 5, 11, 6.5, 9]],
  "D": [[1, 1, 1, 11], [1, 1, 5, 1, 7, 4, 7, 8, 5, 11, 1, 11]],
  "E": [[1, 1, 1, 11], [1, 1, 6, 1], [1, 6, 5, 6], [1, 11, 6, 11]],
  "F": [[1, 1, 1, 11], [1, 1, 6, 1], [1, 6, 5, 6]],
  "G": [[6.5, 3, 5, 1, 2, 1, 0.5, 4, 0.5, 8, 2, 11, 5, 11, 6.5, 9, 6.5, 7, 4, 7]],
  "H": [[1, 1, 1, 11], [7, 1, 7, 11], [1, 6, 7, 6]],
  "I": [[2, 1, 6, 1], [4, 1, 4, 11], [2, 11, 6, 11]],
  "J": [[6.5, 1, 6.5, 9, 4.5, 11, 2.5, 11, 1.5, 10]],
  "K": [[1, 1, 1, 11], [6.5, 1, 1.5, 6], [3.5, 5, 6.5, 11]],
  "L": [[1, 1, 1, 11], [1, 11, 6.5, 11]],
  "M": [[1, 11, 1, 1, 4, 7, 7, 1, 7, 11]],
  "N": [[1, 11, 1, 1, 7, 11, 7, 1]],
  "O": [el(4, 6, 3.5, 5)],
  "P": [[1, 1, 1, 11], [1, 1, 5, 1, 6.5, 3, 5, 5.5, 1, 5.5]],
  "Q": [el(4, 6, 3.5, 5), [5.5, 8.5, 7.5, 11.5]],
  "R": [[1, 1, 1, 11], [1, 1, 5, 1, 6.5, 3, 5, 5.5, 1, 5.5], [4.5, 5.5, 7, 11]],
  "S": [[6, 2.5, 5, 1, 2.5, 1, 1, 3, 1, 4.5, 2, 6, 6, 6, 7, 7.5, 7, 9, 5.5, 11, 2.5, 11, 1, 9.5]],
  "T": [[1, 1, 7, 1], [4, 1, 4, 11]],
  "U": [[1, 1, 1, 8, 2, 11, 6, 11, 7, 8, 7, 1]],
  "V": [[1, 1, 4, 11, 7, 1]],
  "W": [[1, 1, 1, 11, 2.5, 8, 4, 3.5, 5.5, 8, 7, 11, 7, 1]],
  "X": [[1, 1, 7, 11], [7, 1, 1, 11]],
  "Y": [[1, 1, 4, 6, 7, 1], [4, 6, 4, 11]],
  "Z": [[1, 1, 7, 1, 1, 11, 7, 11]],
  "a": [el(4.5, 7.5, 2.5, 3.5), [7, 4, 7, 11]],
  "b": [[1, 1, 1, 11], el(4, 8, 2.5, 3)],
  "c": [[6.5, 5.5, 5, 4, 2.5, 4, 1, 6, 1, 9, 2.5, 11, 5, 11, 6.5, 9.5]],
  "d": [el(4, 8, 2.5, 3), [7, 1, 7, 11]],
  "e": [[6.5, 9, 5, 11, 2.5, 11, 1, 8.5, 1, 6, 2.5, 4, 5, 4, 6.5, 6], [1, 7.5, 6.5, 7.5]],
  "f": [[5.5, 3, 4, 1, 2, 2, 2, 11], [1, 5, 6, 5]],
  "g": [el(4, 7.5, 2.5, 3), [7, 4, 7, 12, 5.5, 14, 2.5, 14, 1.5, 12.5]],
  "h": [[1, 1, 1, 11], [1, 6, 2.5, 4, 5, 4, 6.5, 6, 6.5, 11]],
  "i": [[4, 4, 4, 11], [3.6, 1.5, 4.4, 1.5]],
  "j": [[5, 4, 5, 12, 4, 14, 2.5, 14, 1.5, 13], [4.6, 1.5, 5.4, 1.5]],
  "k": [[1, 1, 1, 11], [6, 4, 2, 7.5], [3.5, 6.5, 6, 11]],
  "l": [[4, 1, 4, 11]],
  "m": [[1, 4, 1, 11], [1, 5.5, 2.5, 4, 4, 5.5, 4, 11], [4, 5.5, 5.5, 4, 7, 5.5, 7, 11]],
  "n": [[1, 4, 1, 11], [1, 5.5, 2.5, 4, 5, 4, 6.5, 6, 6.5, 11]],
  "o": [el(4, 7.5, 3, 3.5)],
  "p": [el(4, 8, 2.5, 3), [1, 4, 1, 14]],
  "q": [el(4, 8, 2.5, 3), [7, 4, 7, 14]],
  "r": [[1, 4, 1, 11], [1, 5.5, 2.5, 4, 4.5, 4, 5.5, 5]],
  // Small s: deep lower bowl and an inward terminal flick, so it stays
  // legible even at thumbnail size.
  "s": [[5.8, 5.2, 4.2, 4, 2.2, 4, 1, 5.3, 1, 6.6, 2.2, 7.6, 5, 7.6, 6.6, 8.6, 6.6, 9.6, 5, 11, 2.4, 11, 1.2, 9.6]],
  "t": [[4, 1.5, 4, 11], [1.5, 5.5, 6, 5.5], [4, 11, 5.5, 10]],
  "u": [[1, 4, 1, 8.5, 2.5, 11, 5, 11, 6.5, 8.5, 6.5, 4]],
  "v": [[1, 4, 3.5, 11, 6.5, 4]],
  "w": [[1, 4, 1.8, 11, 3.2, 6.5, 4, 9, 4.8, 6.5, 6.2, 11, 7, 4]],
  "x": [[1, 4, 6.5, 11], [6.5, 4, 1, 11]],
  "y": [[1, 4, 3, 10.5, 6.5, 4], [3, 10.5, 2.5, 13.5, 1, 13.5]],
  "z": [[1, 4, 6.5, 4, 1, 11, 6.5, 11]],
  "0": [el(4, 6, 3, 5)],
  "1": [[2, 3, 4, 1, 4, 11], [2.5, 11, 5.5, 11]],
  "2": [[1.5, 3, 3, 1, 5.5, 1, 6.5, 3, 6.5, 4.5, 2, 11, 6.5, 11]],
  "3": [[2, 2.5, 3.5, 1, 5.5, 1, 6.5, 3, 5, 5.5, 6, 6.5, 6.5, 8.5, 5, 11, 2.5, 11, 1.5, 9]],
  "4": [[5.5, 1, 1, 7.5, 6.5, 7.5], [5.5, 1, 5.5, 11]],
  "5": [[6.5, 1, 1.5, 1, 1.5, 6, 3, 6, 6, 6, 6.5, 8, 5, 11, 2, 11, 1, 9.5]],
  "6": [[6, 3, 4.5, 1, 2, 2.5, 1, 5, 1, 8, 2.5, 11, 5, 11, 6.5, 9, 6.5, 7, 5, 5, 2.5, 5]],
  "7": [[1, 1, 7, 1, 4, 11]],
  "8": [el(4, 4, 2.5, 3), el(4, 8.7, 2.8, 2.7)],
  "9": [el(4, 4.5, 2.8, 3), [6.5, 4, 6.5, 9, 5, 11, 2.5, 11, 1.5, 9.5]],
  ".": [[3.5, 10.5, 4.5, 10.5]],
  ",": [[3.5, 10.5, 4.5, 10.5], [4, 11, 3, 13]],
  ":": [[3.5, 4, 4.5, 4], [3.5, 10, 4.5, 10]],
  ";": [[3.5, 4, 4.5, 4], [3.5, 10, 4.5, 10], [4, 11, 3, 13]],
  "!": [[4, 1, 4, 8.5], [3.5, 10.5, 4.5, 10.5]],
  "?": [[2, 3.5, 3, 1.5, 5.5, 1.5, 6.5, 3.5, 6, 5, 4, 6.5, 4, 8], [3.5, 10.5, 4.5, 10.5]],
  "'": [[4, 1, 3.5, 4]],
  '"': [[2.5, 1, 2, 4], [5.5, 1, 5, 4]],
  "-": [[1, 6.5, 7, 6.5]],
  "–": [[1, 6.5, 7, 6.5]],
  "—": [[0.5, 6.5, 7.5, 6.5]],
  "(": [[6, 1, 4, 3, 4, 9, 6, 11]],
  ")": [[2, 1, 4, 3, 4, 9, 2, 11]],
  // Ampersand: two stacked loops crossed by a diagonal sweep. Drawn 1.38x
  // in text so "S&P" reads as an elegant, full-size &.
  "&": [[5.5, 1, 3.5, 1, 2, 2.5, 2, 4.5, 3.5, 6, 5.5, 6, 6.5, 4.5, 6, 2.5],
        [3.5, 6, 2, 8, 2, 10, 4, 11, 6, 11, 7, 9.5, 6.5, 8],
        [6.5, 1, 1, 11]],
  "%": [el(2, 3.5, 1.8, 2.2), el(6, 8.5, 1.8, 2.2), [1.5, 10.5, 6.5, 1.5]],
  "$": [[6, 2.5, 5, 1, 2.5, 1, 1, 3, 1, 4.5, 2, 6, 6, 6, 7, 7.5, 7, 9, 5.5, 11, 2.5, 11, 1, 9.5], [4, 0.5, 4, 12]],
  "#": [[2.5, 1, 2.5, 11], [5.5, 1, 5.5, 11], [1, 4, 7, 4], [1, 8, 7, 8]],
  "/": [[6, 1, 2, 11]],
  "+": [[4, 2, 4, 10], [1, 6, 7, 6]],
  "=": [[1, 4, 7, 4], [1, 8, 7, 8]],
  "*": [[4, 1, 4, 11], [1, 3.5, 7, 8.5], [7, 3.5, 1, 8.5]],
  "<": [[6, 2, 2, 6, 6, 10]],
  ">": [[2, 2, 6, 6, 2, 10]],
  "_": [[1, 12.5, 7, 12.5]],
  "·": [[3.5, 6.5, 4.5, 6.5]],
  "•": [[3, 6, 5, 6]],
  " ": [],
};
const ADV = 8.6, SPACE_ADV = 4.6;

function glyphWidth(ch, size) {
  const u = size / 14;
  if (ch === " ") return SPACE_ADV * u;
  return ADV * u;
}
function textWidth(str, size) {
  let w = 0;
  for (const ch of str) w += glyphWidth(ch, size);
  return w;
}
function drawGlyph(ch, x, y, size, color, lw) {
  const g = FONT[ch];
  if (!g) return;
  const u = size / 14;
  for (const st of g) {
    for (let i = 0; i + 3 < st.length; i += 2) {
      line(x + st[i] * u, y + st[i + 1] * u, x + st[i + 2] * u, y + st[i + 3] * u, lw, color);
    }
  }
}
// y = top of the em box. '&' is drawn 1.38x so it reads full-size.
function drawText(str, x, y, size, color, opts) {
  opts = opts || {};
  const lw = Math.max(0.9, size * 0.11 * (opts.weight || 1));
  let cx = x;
  if (opts.align === "center") cx = x - textWidth(str, size) / 2;
  if (opts.align === "right") cx = x - textWidth(str, size);
  for (const ch of str) {
    if (ch === "&") {
      const s2 = size * 1.38;
      drawGlyph(ch, cx, y - 0.19 * size, s2, color, Math.max(0.9, s2 * 0.11 * (opts.weight || 1)));
    } else if (ch !== " ") {
      drawGlyph(ch, cx, y, size, color, lw);
    }
    cx += glyphWidth(ch, size);
  }
  return cx;
}
function wrap(str, size, maxW) {
  const words = str.split(" ");
  const lines = [];
  let cur = "";
  for (const wd of words) {
    const trial = cur ? cur + " " + wd : wd;
    if (textWidth(trial, size) <= maxW || !cur) cur = trial;
    else { lines.push(cur); cur = wd; }
  }
  if (cur) lines.push(cur);
  return lines;
}
function para(str, x, y, size, maxW, color, lh) {
  const lines = wrap(str, size, maxW);
  for (let i = 0; i < lines.length; i++) {
    drawText(lines[i], x, y + i * (lh || size * 1.32), size, color);
  }
  return lines.length;
}

// ---------------------------------------------------------------- scenes
// Natural smoke plume: many overlapping discs in three greys, silhouette
// irregular by construction, plus curling wisps rising to the upper left.
function plume(cx, baseY, topY, lean, seed) {
  const rnd = mulberry32(seed);
  const layers = [
    { n: 18, col: SMOKE1, r0: 10, r1: 24 },
    { n: 16, col: SMOKE2, r0: 7, r1: 17 },
    { n: 12, col: SMOKE3, r0: 5, r1: 11 },
  ];
  for (const L of layers) {
    for (let i = 0; i < L.n; i++) {
      const t = rnd();
      const y = baseY - t * (baseY - topY);
      const drift = lean * t * t + (rnd() - 0.5) * 34 * (0.4 + t);
      const r = L.r0 + rnd() * (L.r1 - L.r0);
      disc(cx + drift, y, r, L.col);
    }
  }
  // Wisps: dotted curls escaping up-left, clearly separated from the body.
  for (let wI = 0; wI < 6; wI++) {
    const t0 = 0.55 + rnd() * 0.4;
    const bx = cx + lean * t0 * t0, by = baseY - t0 * (baseY - topY);
    let px = bx, py = by;
    for (let s = 0; s < 7; s++) {
      const nx = px - 9 - rnd() * 7, ny = py - 8 - rnd() * 6;
      if (s % 2 === 0) line(px, py, nx, ny, 2.2, SMOKE2);
      px = nx; py = ny;
    }
  }
}
function tanker(x, y, w, burning, seed) {
  const rnd = mulberry32(seed);
  // Hull with a raked bow, deck line, bridge, funnels.
  fillPoly([x, y, x + w, y, x + w - 14, y + 24, x + 10, y + 24], HULL);
  rect(x + 8, y - 4, w - 22, 5, HULL2);
  rect(x + w * 0.62, y - 22, 26, 18, CREAM);
  rect(x + w * 0.62 + 3, y - 19, 20, 4, NAVY);
  rect(x + w * 0.2, y - 16, 12, 12, REDDK);
  rect(x + w * 0.34, y - 16, 12, 12, REDDK);
  for (let i = 0; i < 5; i++) disc(x + 22 + i * ((w - 44) / 4), y + 12, 2.2, SAND);
  if (burning) {
    for (let i = 0; i < 9; i++) {
      const fx = x + w * 0.3 + rnd() * w * 0.4;
      const fy = y - 4 - rnd() * 16;
      disc(fx, fy, 5 + rnd() * 7, i % 2 ? FIRE : FIRE2);
    }
    fillPoly([x + w * 0.42, y - 2, x + w * 0.5, y - 30, x + w * 0.58, y - 2], FIRE);
    fillPoly([x + w * 0.47, y - 2, x + w * 0.5, y - 20, x + w * 0.53, y - 2], FIRE2);
  }
}
function mine(x, y, r) {
  disc(x, y, r, STEEL2);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    line(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6,
      x + Math.cos(a) * (r + 5), y + Math.sin(a) * (r + 5), 1.6, STEEL2);
  }
  disc(x - r * 0.3, y - r * 0.3, r * 0.28, [120, 128, 134]);
}
function jet(x, y, s) {
  fillPoly([x, y, x + 34 * s, y + 5 * s, x, y + 10 * s], STEEL2);
  fillPoly([x + 8 * s, y + 2 * s, x + 16 * s, y - 8 * s, x + 20 * s, y + 2 * s], STEEL2);
  fillPoly([x + 8 * s, y + 8 * s, x + 16 * s, y + 18 * s, x + 20 * s, y + 8 * s], STEEL2);
}
function pill(x, y, str, size, bg, fg) {
  const w = textWidth(str, size) + 14;
  rect(x, y, w, size + 8, bg);
  drawText(str, x + 7, y + 4, size, fg, { weight: 1.2 });
  return w;
}
function chip(cx, cy, s, label) {
  rect(cx - 22 * s, cy - 22 * s, 44 * s, 44 * s, STEEL2);
  rect(cx - 17 * s, cy - 17 * s, 34 * s, 34 * s, [27, 34, 44]);
  for (let i = 0; i < 4; i++) {
    rect(cx - 26 * s, cy - 14 * s + i * 9 * s, 5 * s, 3 * s, GOLD);
    rect(cx + 21 * s, cy - 14 * s + i * 9 * s, 5 * s, 3 * s, GOLD);
    rect(cx - 14 * s + i * 9 * s, cy - 26 * s, 3 * s, 5 * s, GOLD);
    rect(cx - 14 * s + i * 9 * s, cy + 21 * s, 3 * s, 5 * s, GOLD);
  }
  drawText(label, cx, cy - 6 * s, 11 * s, GOLD, { align: "center", weight: 1.3 });
}
function corvette(x, y, w) {
  fillPoly([x, y, x + w, y, x + w - 16, y + 16, x + 8, y + 16], STEEL);
  rect(x + w * 0.42, y - 14, w * 0.2, 14, STEEL2);
  rect(x + w * 0.66, y - 10, 8, 10, GOLD);
  line(x + w * 0.5, y - 14, x + w * 0.5, y - 30, 2, STEEL2);
  line(x + w * 0.5 - 12, y - 28, x + w * 0.5 + 12, y - 28, 2, STEEL2);
  line(x + w * 0.18, y - 6, x + w * 0.3, y - 6, 2.5, STEEL2);
}
function seaDrone(x, y, s) {
  fillPoly([x, y, x + 26 * s, y, x + 22 * s, y + 7 * s, x + 4 * s, y + 7 * s], STEEL2);
  line(x + 13 * s, y, x + 13 * s, y - 12 * s, 1.6, STEEL2);
  disc(x + 13 * s, y - 13 * s, 1.8, RED);
}
function barrier(x, y, w) {
  rect(x, y, 4, 34, INK);
  rect(x + w - 4, y, 4, 34, INK);
  for (let i = 0; i < 5; i++) {
    rect(x + 4 + i * ((w - 8) / 5), y + 4, (w - 8) / 5, 7, i % 2 ? WHITE : RED);
  }
  rect(x + 4, y + 16, w - 8, 3, INK);
}
function warnTri(cx, cy, r) {
  fillPoly([cx, cy - r, cx + r, cy + r * 0.8, cx - r, cy + r * 0.8], GOLD);
  poly([cx, cy - r, cx + r, cy + r * 0.8, cx - r, cy + r * 0.8], 2, INK, true);
  drawText("!", cx, cy - r * 0.45, r * 1.1, INK, { align: "center", weight: 1.4 });
}

// ---------------------------------------------------------------- PNG encoder
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}
function encodePNG(rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- dossier data
const STORIES = [
  { label: "LEAD · HORMUZ", text: "IRGC says three tankers hit by sea mines in the Strait of Hormuz; claim not independently verified.", date: "2026-11-24", source: "TRENDS MENA, 2026-11-24T03:37:47Z" },
  { label: "LEAD · HORMUZ", text: "Tankers burning under U.S. air escort; Qatar mediates in Washington.", date: "2026-11-24", source: "Dubai Standard; AJVC sitrep, 24 Nov 02:31 UTC" },
  { label: "LEAD · HORMUZ", text: "U.S. Treasury sanctioned 22 firms and 8 people over Iran shadow banking, $14.7bn; JMIC threat 'severe'.", date: "2026-11-24", source: "Reuters" },
  { label: "NVIDIA", text: "Board reinstated Jensen Huang as CEO 11 days after he stepped down; shares +33%, Nasdaq +6%, S&P 500 +4%.", date: "2026-11-24", source: "Reuters; CNN; WSJ" },
  { label: "LIBYA", text: "Ukrainian sea drones sank the Russian corvette Merkury off Benghazi; MV Angara hit, Ka-27 destroyed; UNSMIL seeks probe.", date: "2026-11-24", source: "The Times; Le Monde; AFP; UN News" },
  { label: "ESTONIA", text: "Tallinn shuts its land border from 1 December; Moscow: 'on the verge of triggering open war'.", date: "2026-11-24", source: "Reuters" },
  { label: "INDONESIA", text: "26 body bags identified, 28 still missing after the Banten candy factory fire.", date: "2026-11-24", source: "ThedailyID, 24 Nov" },
  { label: "S. KOREA", text: "A Russian aircraft entered the air defence zone; jets were scrambled.", date: "2026-11-24", source: "First reported 24 Nov 01:04 UTC" },
  { label: "BANGLADESH", text: "Mass typhoid vaccination of 50 million children began.", date: "2026-11-24", source: "24 Nov" },
  { label: "NEPAL", text: "A quake struck Koshi province near the China border.", date: "2026-11-24", source: "Horizon, 24 Nov" },
  { label: "TIANGONG", text: "China opened its Tiangong station to its first foreign astronaut, Pakistan's Zeeshan Ali.", date: "2026-11-24", source: "The Straits Times, via Horizon 24 Nov" },
  { label: "MEGASPEED", text: "The U.S. blacklisted seven firms in the Nvidia spy case.", date: "2026-11-24", source: "First reported 24 Nov 00:52 UTC" },
  { label: "GAZA", text: "Israeli strikes killed at least 3 people, including UNRWA worker Adel al-Helo at a well in Jabalia.", date: "2026-11-23", source: "Reuters, 23 Nov" },
  { label: "ROHINGYA", text: "Fourteen countries backed the ICJ ruling on the Rohingya genocide by Myanmar.", date: "2026-11-24", source: "Horizon, 24 Nov" },
  { label: "UN AI", text: "Guterres called for a multilateral framework to limit AI risks within a year.", date: "2026-11-24", source: "Horizon, 24 Nov" },
  { label: "RIYADH", text: "A Houthi drone attack hit the PIF Tower; 11 people injured.", date: "2026-11-24", source: "Al Jazeera, 24 Nov 21:33" },
  { label: "CARTAGENA", text: "Armed men took hostages in a supermarket in Cartagena.", date: "2026-11-24", source: "NXplace evening edition, 24 Nov" },
  { label: "HUAWEI", text: "Huawei found guilty of stealing trade secrets, acquitted of racketeering.", date: "2026-11-24", source: "BBC, 24 Nov 21:32" },
  { label: "MEASLES", text: "A ninth death was recorded in the Pennsylvania measles outbreak.", date: "2026-11-24", source: "Horizon, 24 Nov" },
  { label: "COP31", text: "Climate talks ended with no fossil-fuel transition call.", date: "2026-11-24", source: "Peek-a-Daily, 24 Nov" },
  { label: "DOJ", text: "$8bn recovered and 800+ suspects charged in the largest anti-scam surge in history.", date: "2026-11-24", source: "Fox News, 24 Nov 16:29" },
  { label: "TRUMP", text: "Trump: toppling Iran's regime is 'probably doable', but not his goal.", date: "2026-11-24", source: "Breitbart, 24 Nov" },
  { label: "CHINA", text: "Former Chinese official surnamed Ma sentenced to death for spying.", date: "2026-11-24", source: "World News video digest, 24 Nov" },
  { label: "YEMEN", text: "Houthis reported dozens dead in Saudi airstrikes.", date: "2026-11-24", source: "Horizon, 24 Nov" },
  { label: "LIBYA", text: "Tripoli demanded explanations from Kyiv after the attack on Russian ships.", date: "2026-11-24", source: "Horizon, 24 Nov" },
  { label: "VENEZUELA", text: "Venezuela reported $237.5bn in public debt, a step toward massive restructuring.", date: "2026-11-24", source: "NXplace, 24 Nov" },
  { label: "NATO", text: "NATO deployed advanced detection aircraft in Poland after a missile fell.", date: "2026-11-24", source: "Horizon, 24 Nov" },
  { label: "UK", text: "Hundreds of thousands could lose disability benefits under the Timms shake-up.", date: "2026-11-24", source: "The Guardian, 24 Nov 21:24" },
  { label: "HASINA", text: "Ousted PM Sheikh Hasina set 16 December for her return to Bangladesh.", date: "2026-11-24", source: "Peek-a-Daily; Breitbart, 24 Nov" },
  { label: "ZELENSKY", text: "Zelensky urged four-party Russia-U.S.-Europe talks as soon as possible.", date: "2026-11-24", source: "First reported 24 Nov 00:30 UTC" },
  { label: "MARKETS", text: "Close of 24 Nov: S&P 500 +4.7% to 7,237, Nasdaq +6.5%, Brent crude -3% to $86.70, gold $3,620.", date: "2026-11-24", source: "Horizon indicators, 24 Nov" },
  { label: "SPORT", text: "Ronaldo reached 987 career goals; Senegal regained the AFCON title after a CAS appeal.", date: "2026-11-24", source: "Peek-a-Daily, 24 Nov" },
];

// ---------------------------------------------------------------- layout
function rule(x, y, w, c, t) { rect(x, y, w, t || 1.5, c || INK); }

function drawMasthead() {
  const word = "THE WORLD";
  const size = 84;
  const x0 = (W - textWidth(word, size)) / 2;
  drawText(word, x0, 0, size, INK, { weight: 1.5 });
  // Serif feet: short horizontal ticks at the feet (and tops) of vertical
  // stems, so the geometric stroke capitals read as a newspaper serif.
  const stems = { "T": { t: [], b: [4] }, "H": { t: [1, 7], b: [1, 7] }, "E": { t: [], b: [1] }, "W": { t: [1, 7], b: [1, 7] }, "O": { t: [], b: [] }, "R": { t: [], b: [1] }, "L": { t: [], b: [1] }, "D": { t: [], b: [1] } };
  const u = size / 14;
  let cx = x0;
  for (const ch of word) {
    const sp = stems[ch];
    if (sp) {
      for (const sx of sp.t) rect(cx + (sx - 1.2) * u, 1 * u - 0.8, 2.4 * u, 1.6, INK);
      for (const sx of sp.b) rect(cx + (sx - 1.2) * u, 11 * u - 0.8, 2.4 * u, 1.6, INK);
    }
    cx += glyphWidth(ch, size);
  }
  drawText("TUESDAY, 24 NOVEMBER 2026  ·  IN ONE IMAGE", 512, 70, 14, MUTED, { align: "center", weight: 1.2 });
  rule(16, 86, W - 32, INK, 2.5);
}

function drawLead() {
  // Headline band.
  drawText("MINES IN THE STRAIT OF HORMUZ", 16, 96, 30, REDDK, { weight: 1.35 });
  rule(16, 130, W - 32, INK, 1.5);
  // Scene: the strait, 16..640 x 136..330.
  const SX = 16, SY = 136, SW = 624, SH = 194;
  rect(SX, SY, SW, 96, SKY2);
  rect(SX, SY + 96, SW, 14, SAND);
  rect(SX, SY + 110, SW, SH - 110, SEA);
  rect(SX, SY + 110, SW, 3, SEA2);
  // Sun haze + distant shore.
  disc(SX + 560, SY + 34, 16, [240, 226, 196]);
  fillPoly([SX, SY + 96, SX + 150, SY + 70, SX + 300, SY + 96], [196, 188, 168]);
  // Three tankers; the middle one burns.
  tanker(SX + 30, SY + 148, 170, false, 11);
  tanker(SX + 225, SY + 142, 185, true, 22);
  tanker(SX + 430, SY + 150, 165, false, 33);
  // Natural plume over the burning tanker, spreading up-left.
  plume(SX + 315, SY + 138, SY + 8, -58, 20261124);
  // Mines in the foreground water.
  mine(SX + 90, SY + 178, 7);
  mine(SX + 250, SY + 182, 6);
  mine(SX + 420, SY + 180, 7);
  mine(SX + 545, SY + 176, 6);
  // U.S. air escort jet, top right.
  jet(SX + 500, SY + 22, 1.1);
  drawText("U.S. AIR ESCORT", SX + 468, SY + 44, 11, INK, { weight: 1.2 });
  // Scene labels.
  drawText("IRAN", SX + 14, SY + 8, 12, INK, { weight: 1.3 });
  drawText("OMAN", SX + SW - 52, SY + SH - 20, 12, WHITE, { weight: 1.3 });
  pill(SX + 12, SY + SH - 30, "STRAIT OF HORMUZ", 11, INK, WHITE);
  // Right column: the three dated facts, claim labelled up front.
  const FX = 656, FW = 352;
  let fy = 140;
  pill(FX, fy, "UNVERIFIED CLAIM", 11, RED, WHITE);
  fy += 26;
  fy += para("IRGC says three tankers hit by sea mines in the Strait of Hormuz.", FX, fy, 16, FW, INK) * 21 + 10;
  fy += para("Tankers burning under U.S. air escort; Qatar mediates in Washington.", FX, fy, 16, FW, INK) * 21 + 10;
  fy += para("U.S. sanctions 22 firms, 8 people over Iran shadow banking, $14.7bn; JMIC threat 'severe'.", FX, fy, 16, FW, INK) * 21;
  rule(16, 340, W - 32, INK, 1.5);
}

function secondaryPanel(x, y, w, kicker, kcolor, headline, fact, scene) {
  rect(x, y, w, 1.5, INK);
  drawText(kicker, x, y + 10, 12, kcolor, { weight: 1.4 });
  drawText("24 NOV", x + w, y + 10, 12, MUTED, { align: "right", weight: 1.2 });
  const hl = wrap(headline, 19, w);
  for (let i = 0; i < hl.length; i++) drawText(hl[i], x, y + 28 + i * 22, 19, INK, { weight: 1.3 });
  scene(x, y + 78, w);
  para(fact, x, y + 156, 14.5, w, INK);
}
function drawSecondary() {
  const y = 352, w = 322, gap = 14;
  secondaryPanel(16, y, w, "TECHNOLOGY", NAVY, "HUANG RETURNS AS NVIDIA CEO",
    "Board reinstates Jensen Huang 11 days after exit; shares +33%, Nasdaq +6%, S&P +4%.",
    (x, sy, pw) => {
      rect(x, sy, pw, 66, [232, 238, 240]);
      chip(x + 62, sy + 33, 0.85, "NVDA");
      // Rising market line.
      poly([x + 130, sy + 52, x + 165, sy + 44, x + 195, sy + 46, x + 225, sy + 30, x + 255, sy + 22, x + 300, sy + 10], 2.5, NAVY);
      fillPoly([x + 292, sy + 10, x + 302, sy + 10, x + 297, sy + 2], NAVY);
      drawText("+33%", x + 252, sy + 26, 15, NAVY, { weight: 1.4 });
      drawText("SHARES", x + 252, sy + 44, 10, MUTED, { weight: 1.2 });
    });
  secondaryPanel(16 + w + gap, y, w, "LIBYA", REDDK, "SEA DRONES SINK RUSSIAN CORVETTE",
    "Kyiv: seven drones sank corvette Merkury off Benghazi; MV Angara hit, Ka-27 destroyed. UNSMIL seeks probe.",
    (x, sy, pw) => {
      rect(x, sy, pw, 66, SKY);
      rect(x, sy + 44, pw, 22, SEA);
      corvette(x + 90, sy + 34, 210);
      seaDrone(x + 18, sy + 50, 0.9);
      for (let i = 0; i < 6; i++) disc(x + 48 + i * 7, sy + 52 - i * 1.5, 1.6, INK);
      drawText("KA-27 DOWN", x + 8, sy + 6, 10, INK, { weight: 1.2 });
    });
  secondaryPanel(16 + 2 * (w + gap), y, w, "ESTONIA", OLIVE, "RUSSIA WARNS ESTONIA OVER BORDER",
    "Tallinn shuts border 1 Dec; Moscow: 'on the verge of triggering open war'.",
    (x, sy, pw) => {
      rect(x, sy, pw, 66, [238, 234, 220]);
      barrier(x + 30, sy + 18, 150);
      warnTri(x + 240, sy + 30, 20);
      drawText("1 DEC", x + 196, sy + 52, 12, INK, { weight: 1.4 });
      drawText("TALLINN", x + 30, sy + 52, 11, MUTED, { weight: 1.2 });
    });
  rule(16, 578, W - 32, INK, 1.5);
}

function miniTile(x, y, w, label, color, fact, scene) {
  scene(x, y, w);
  drawText(label, x, y + 56, 11.5, color, { weight: 1.4 });
  para(fact, x, y + 72, 12, w, INK);
}
function drawMiniRow() {
  drawText("ALSO TODAY", 16, 588, 13, INK, { weight: 1.4 });
  drawText("ALL 24 NOVEMBER 2026", 16 + 108, 588, 13, MUTED, { weight: 1.2 });
  const y = 606, w = 158, gap = 8;
  const tiles = [
    { label: "INDONESIA", color: REDDK, fact: "26 identified, 28 missing in Banten fire.",
      scene: (x, sy, pw) => { rect(x, sy, pw, 50, [240, 232, 216]); rect(x + 12, sy + 22, 60, 28, STEEL); rect(x + 78, sy + 12, 34, 38, STEEL2); rect(x + 96, sy + 2, 8, 12, STEEL2); disc(x + 100, sy + 4, 5, SMOKE2); disc(x + 106, sy - 2, 4, SMOKE1); fillPoly([x + 30, sy + 22, x + 38, sy + 9, x + 46, sy + 22], FIRE); fillPoly([x + 35, sy + 22, x + 38, sy + 14, x + 41, sy + 22], FIRE2); } },
    { label: "S. KOREA", color: NAVY, fact: "Russian jet enters air zone; jets scrambled.",
      scene: (x, sy, pw) => { rect(x, sy, pw, 50, SKY2); jet(x + 34, sy + 14, 1.3); line(x + 120, sy + 8, x + 120, sy + 42, 1.6, NAVY); line(x + 108, sy + 14, x + 132, sy + 14, 1.6, NAVY); disc(x + 120, sy + 25, 2, RED); } },
    { label: "BANGLADESH", color: TEAL, fact: "Typhoid shots begin for 50m children.",
      scene: (x, sy, pw) => { rect(x, sy, pw, 50, [232, 240, 236]); rect(x + 58, sy + 12, 18, 30, WHITE); rect(x + 58, sy + 12, 18, 8, TEAL); line(x + 76, sy + 27, x + 100, sy + 27, 2, STEEL2); line(x + 100, sy + 27, x + 112, sy + 27, 1.4, STEEL2); drawText("+", x + 108, sy + 6, 16, TEAL, { weight: 1.4 }); } },
    { label: "NEPAL", color: OLIVE, fact: "Quake strikes Koshi near China border.",
      scene: (x, sy, pw) => { rect(x, sy, pw, 50, SKY2); fillPoly([x + 10, sy + 50, x + 55, sy + 6, x + 100, sy + 50], [96, 116, 128]); fillPoly([x + 44, sy + 16, x + 55, sy + 6, x + 66, sy + 16, x + 58, sy + 20, x + 52, sy + 20], WHITE); poly([x + 84, sy + 50, x + 92, sy + 34, x + 86, sy + 26, x + 96, sy + 12], 2, REDDK); } },
    { label: "TIANGONG", color: NAVY, fact: "China: first foreign astronaut on Tiangong.",
      scene: (x, sy, pw) => { rect(x, sy, pw, 50, [22, 30, 44]); fillPoly([x + 74, sy + 4, x + 80, sy + 14, x + 68, sy + 14], WHITE); rect(x + 68, sy + 14, 12, 20, WHITE); fillPoly([x + 68, sy + 34, x + 74, sy + 46, x + 80, sy + 34], FIRE); rect(x + 30, sy + 20, 26, 8, STEEL); rect(x + 14, sy + 22, 14, 4, GOLD); rect(x + 58, sy + 22, 14, 4, GOLD); } },
    { label: "MEGASPEED", color: REDDK, fact: "U.S. blacklists 7 firms in Nvidia spy case.",
      scene: (x, sy, pw) => { rect(x, sy, pw, 50, [232, 238, 240]); chip(x + 46, sy + 25, 0.62, ""); drawText("7", x + 108, sy + 8, 20, RED, { weight: 1.4 }); drawText("FIRMS", x + 100, sy + 30, 10, MUTED, { weight: 1.2 }); } },
  ];
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    miniTile(16 + i * (w + gap), y, w, t.label, t.color, t.fact, t.scene);
  }
  rule(16, 726, W - 32, INK, 1.5);
}

function drawBriefs() {
  drawText("THE DAY IN BRIEF", 16, 736, 13, INK, { weight: 1.4 });
  drawText("EVERY ITEM DATED 24 NOVEMBER 2026", 16 + 168, 736, 13, MUTED, { weight: 1.2 });
  const items = [
    ["GAZA", "Strikes kill 3, incl. UNRWA worker in Jabalia.", REDDK],
    ["ROHINGYA", "14 nations back ICJ ruling on Myanmar.", NAVY],
    ["UN AI", "Guterres wants AI-risk rules within a year.", TEAL],
    ["RIYADH", "Houthi drone hits PIF Tower; 11 injured.", REDDK],
    ["CARTAGENA", "Gunmen hold hostages in supermarket.", NAVY],
    ["HUAWEI", "Trade-secret theft guilty; racketeering cleared.", OLIVE],
    ["MEASLES", "Ninth death in Pennsylvania outbreak.", TEAL],
    ["COP31", "Talks end with no fossil-fuel transition call.", OLIVE],
    ["DOJ", "$8bn recovered; 800+ charged in anti-scam surge.", NAVY],
    ["TRUMP", "Toppling Iran regime 'probably doable', not goal.", REDDK],
    ["CHINA", "Ex-official Ma sentenced to death for spying.", REDDK],
    ["YEMEN", "Houthis say dozens dead in Saudi airstrikes.", OLIVE],
    ["LIBYA", "Tripoli demands answers from Kyiv over attack.", REDDK],
    ["VENEZUELA", "$237.5bn debt disclosed before restructuring.", NAVY],
    ["NATO", "Detection aircraft to Poland after missile falls.", NAVY],
    ["UK", "Disability shake-up could hit hundreds of thousands.", TEAL],
    ["HASINA", "Ousted PM sets 16 Dec return to Bangladesh.", OLIVE],
    ["ZELENSKY", "Urges four-party Russia-U.S.-Europe talks.", NAVY],
  ];
  const colX = [16, 520], colW = 488, rowH = 22;
  for (let i = 0; i < items.length; i++) {
    const col = i < 9 ? 0 : 1;
    const row = i % 9;
    const x = colX[col], y = 758 + row * rowH;
    const [label, fact, color] = items[i];
    drawText(label, x, y, 13.5, color, { weight: 1.4 });
    const lx = x + textWidth(label, 13.5) + 6;
    drawText("—", lx, y, 13.5, MUTED);
    drawText(fact, lx + textWidth("— ", 13.5), y, 13.5, INK);
  }
  rule(16, 962, W - 32, INK, 1.5);
}

function drawFooter() {
  drawText("MARKETS", 16, 970, 12.5, INK, { weight: 1.4 });
  drawText("S&P 500 +4.7%  ·  Nasdaq +6.5%  ·  Brent $86.70 -3%  ·  Gold $3,620", 16 + 84, 970, 12.5, INK);
  // Tiny rising sparkline for the market day.
  poly([880, 984, 905, 978, 925, 980, 950, 972, 975, 968, 1000, 962], 2, NAVY);
  fillPoly([996, 962, 1004, 962, 1000, 956], NAVY);
  drawText("SPORT — Ronaldo reaches 987 career goals; Senegal regain AFCON title after CAS appeal.", 16, 990, 12, MUTED);
  drawText("Sources: Reuters, CNN, WSJ, The Times, Le Monde, AFP, UN News, Al Jazeera, BBC, Fox News, Guardian, Straits Times.", 16, 1008, 11, FAINT);
}

// ---------------------------------------------------------------- main
function render() {
  rect(0, 0, W, H, PAPER);
  drawMasthead();
  drawLead();
  drawSecondary();
  drawMiniRow();
  drawBriefs();
  drawFooter();
}
function downsample() {
  const out = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const i = (((y * SS + dy) * W2) + (x * SS + dx)) * 3;
          r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
        }
      }
      const o = (y * W + x) * 3, n = SS * SS;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n);
    }
  }
  return out;
}
function main() {
  const outDir = process.env.OUTDIR || "/output";
  fs.mkdirSync(outDir, { recursive: true });
  render();
  const rgb = downsample();
  const png = encodePNG(rgb, W, H);
  const sha = crypto.createHash("sha256").update(png).digest("hex");
  fs.writeFileSync(path.join(outDir, "entry.png"), png);
  const dossier = {
    title: "THE WORLD — Tuesday, 24 November 2026",
    competition: "news-image-20261124",
    edition: "v10",
    lead: {
      headline: "MINES IN THE STRAIT OF HORMUZ",
      facts: STORIES.slice(0, 3).map((s) => s.text),
      sources: ["TRENDS MENA, 2026-11-24T03:37:47Z", "Dubai Standard", "AJVC sitrep, 24 Nov 02:31 UTC", "Reuters"],
    },
    secondary: [
      { kicker: "TECHNOLOGY", headline: "HUANG RETURNS AS NVIDIA CEO", fact: STORIES[3].text, sources: ["Reuters", "CNN", "WSJ"] },
      { kicker: "LIBYA", headline: "SEA DRONES SINK RUSSIAN CORVETTE", fact: STORIES[4].text, sources: ["The Times", "Le Monde", "AFP", "UN News"] },
      { kicker: "ESTONIA", headline: "RUSSIA WARNS ESTONIA OVER BORDER", fact: STORIES[5].text, sources: ["Reuters"] },
    ],
    mini_tiles: STORIES.slice(6, 12).map((s) => ({ label: s.label, fact: s.text, date: s.date, source: s.source })),
    briefs: STORIES.slice(12, 30).map((s) => ({ label: s.label, fact: s.text, date: s.date, source: s.source })),
    markets: STORIES[30],
    sport: STORIES[31],
    stories: STORIES,
    honesty_note: "Lead story (Hormuz) first reported 24 Nov UTC; briefs Megaspeed, Zelensky, South Korea are 24 Nov UTC. Secondary stories (Nvidia, Libya, Estonia) and the Gaza brief first reported Monday 23 Nov US time but dominated the morning news cycle of 24 Nov. The IRGC tanker claim is labelled UNVERIFIED CLAIM in the image; it is not independently verified.",
    entry_png_sha256: sha,
    width: W,
    height: H,
  };
  fs.writeFileSync(path.join(outDir, "dossier.json"), JSON.stringify(dossier, null, 2) + "\n");
  console.log("wrote " + path.join(outDir, "entry.png") + " " + png.length + " bytes sha256=" + sha);
}
main();
