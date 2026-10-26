// Print-area placement measured on the product photo, the way a print shop measures a garment:
// find the collar, measure the body across the chest, turn that into a pixels-per-inch scale,
// then place each print area a set number of inches below the collar (table in areas.ts).
//
// Pure functions on raw RGBA pixels, so the product page (design.ts) and the review harness run
// exactly the same code. Everything here works on a downscaled copy of the photo (~240 px wide);
// results are returned as fractions of the photo.

import { PLACEMENT, NECK, CHEST_FLAT_IN, YOUTH_SCALE, PHOTO_WIDTH_SHARE, PHOTO_LENGTH_RATIO, type DesignSpot, type PlaceConfig, type Side } from './areas';

export type Box = { x: number; y: number; w: number; h: number };

/** What the photo analysis found, in analysis-grid pixels (W × H). */
export interface Analysis {
  W: number; H: number;
  /** Garment bounding box. */
  x0: number; x1: number; y0: number; y1: number;
  /** Horizontal center of the torso. */
  cx: number;
  /** First garment pixel going down the center column (back collar on a tee, neckline on a tank). */
  top: number;
  /** Bottom hem at the center. */
  hem: number;
  /** Row where the garment first gets close to full body width (shoulder line). */
  shoulder: number;
  /** Torso width at chest level, and its left/right edges there. */
  body: number; bodyL: number; bodyR: number;
  /** Underarm row if sleeves were seen leaving the torso, else -1. */
  armpit: number;
  /** True when `body` is the torso alone (sleeves seen leaving it, or a gap between sleeves and body). */
  torso: boolean;
  /** Center column is solid from the very top, far above the shoulder line: a hood. */
  hoodLike: boolean;
  /** For each row, the run of garment pixels that contains the center column ([-1, -1] when none). */
  runL: Int16Array; runR: Int16Array;
  mask: Uint8Array;
  /** Full width of the garment in each row (leftmost to rightmost garment pixel). */
  span: Int16Array;
  /** Brightness down the center column (median of a few columns), for finding the front neckline. */
  lum: Float32Array;
}

export const ANALYSIS_WIDTH = 240;

/** Garment mask, chest width and collar from an RGBA image (already downscaled). */
export function analyze(d: Uint8ClampedArray, W: number, H: number): Analysis | null {
  const n = W * H;
  // Background color: median-ish of the four corners.
  const corner = (x: number, y: number) => { const k = (y * W + x) * 4; return [d[k], d[k + 1], d[k + 2]]; };
  const cs = [corner(1, 1), corner(W - 2, 1), corner(1, H - 2), corner(W - 2, H - 2)];
  const bg = [0, 1, 2].map((c) => cs.map((v) => v[c]).sort((a, b) => a - b)[1]);
  const diff = (i: number) => {
    const k = i * 4;
    return Math.max(Math.abs(d[k] - bg[0]), Math.abs(d[k + 1] - bg[1]), Math.abs(d[k + 2] - bg[2]));
  };
  // Flood-fill the background from the border, so light areas inside the garment stay garment.
  const T = 14;
  const seen = new Uint8Array(n); // 1 = background
  const stack = new Int32Array(n);
  let sp = 0;
  const push = (i: number) => { if (!seen[i] && diff(i) <= T) { seen[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (sp) {
    const i = stack[--sp];
    const x = i % W;
    if (x > 0) push(i - 1);
    if (x < W - 1) push(i + 1);
    if (i >= W) push(i - W);
    if (i < n - W) push(i + W);
  }
  // Keep the largest connected garment region (drops specks and stray shadows).
  const label = new Int32Array(n);
  let best = 0, bestSize = 0, cur = 0;
  for (let s = 0; s < n; s++) {
    if (seen[s] || label[s]) continue;
    cur++;
    let size = 0;
    sp = 0; stack[sp++] = s; label[s] = cur;
    while (sp) {
      const i = stack[--sp];
      size++;
      const x = i % W;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < n - W ? i + W : -1];
      for (const j of nb) if (j >= 0 && !seen[j] && !label[j]) { label[j] = cur; stack[sp++] = j; }
    }
    if (size > bestSize) { bestSize = size; best = cur; }
  }
  if (bestSize < n * 0.04) return null;
  const mask = new Uint8Array(n);
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let i = 0; i < n; i++) if (label[i] === best) {
    mask[i] = 1;
    const x = i % W, y = (i - x) / W;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  if (bw < W * 0.2 || bh < H * 0.2) return null;

  const m = (x: number, y: number) => mask[y * W + x] === 1;
  const runL = new Int16Array(H).fill(-1), runR = new Int16Array(H).fill(-1);
  const runAt = (cx: number) => {
    for (let y = 0; y < H; y++) {
      let c = cx;
      if (!m(c, y)) { if (c > 0 && m(c - 1, y)) c--; else if (c < W - 1 && m(c + 1, y)) c++; else { runL[y] = runR[y] = -1; continue; } }
      let l = c, r = c;
      while (l > 0 && m(l - 1, y)) l--;
      while (r < W - 1 && m(r + 1, y)) r++;
      runL[y] = l; runR[y] = r;
    }
  };
  let cx = Math.round((x0 + x1) / 2);
  runAt(cx);
  const width = (y: number) => (runL[y] < 0 ? 0 : runR[y] - runL[y] + 1);
  const median = (a: number[]) => { const s = [...a].sort((p, q) => p - q); return s.length ? s[s.length >> 1] : 0; };

  // Center column: first and last garment pixel (median over a few columns, ignores a stray drawstring).
  const colTop = (x: number) => { for (let y = y0; y <= y1; y++) if (m(x, y) && m(x, Math.min(H - 1, y + 1)) && m(x, Math.min(H - 1, y + 2))) return y; return -1; };
  const colBot = (x: number) => { for (let y = y1; y >= y0; y--) if (m(x, y)) return y; return -1; };
  const hem = median([-2, -1, 0, 1, 2].map((k) => colBot(cx + k)));
  const L = hem - y0;
  if (L < bh * 0.5) return null;

  // Underarm: the biggest sudden drop of the center run's width (sleeves leaving the torso).
  let armpit = -1, drop = 0;
  for (let y = y0 + Math.round(L * 0.1); y < y0 + L * 0.62; y++) {
    const a = width(y), b = width(y + 3);
    if (a && b && a - b > drop) { drop = a - b; armpit = y + 3; }
  }
  let body: number, rows: number[] = [];
  const sawArmpit = armpit >= 0 && drop > 0.12 * width(armpit);
  if (sawArmpit) {
    // Let the underarm curve finish, then measure just below it (a chest flat is measured 1" below).
    let a = armpit;
    while (a < hem && width(a) - width(a + 2) > width(a) * 0.015) a++;
    armpit = a;
    for (let y = a + Math.round(L * 0.02); y <= a + L * 0.09; y++) rows.push(y);
  } else {
    armpit = -1;
    for (let y = y0 + Math.round(L * 0.38); y <= y0 + L * 0.55; y++) rows.push(y);
  }
  rows = rows.filter((y) => width(y) > 0);
  if (!rows.length) return null;
  body = median(rows.map(width));
  const bodyL = median(rows.map((y) => runL[y])), bodyR = median(rows.map((y) => runR[y]));
  // Recenter on the torso and redo the center column. Flats are symmetric: a torso that sits well
  // off the middle has a sleeve stuck to one side, so its width can't be trusted.
  const ncx = Math.round((bodyL + bodyR) / 2);
  const lopsided = Math.abs(ncx - cx) > bw * 0.04;
  if (!lopsided && Math.abs(ncx - cx) > 1) { cx = ncx; runAt(cx); }
  const top = median([-2, -1, 0, 1, 2].map((k) => colTop(cx + k)));
  const span = new Int16Array(H);
  for (let y = y0; y <= y1; y++) {
    let l = -1, r = -1;
    for (let x = x0; x <= x1; x++) if (m(x, y)) { if (l < 0) l = x; r = x; }
    span[y] = l < 0 ? 0 : r - l + 1;
  }
  // Shoulder line: first row at least 70% of the body width (full row span, so tank straps count).
  let shoulder = y0;
  while (shoulder < hem && span[shoulder] < body * 0.7) shoulder++;
  if (body < bw * 0.25 || top < 0) return null;
  const torso = !lopsided && (sawArmpit || body < bw * 0.8);
  const hoodLike = top - y0 < L * 0.03 && shoulder - y0 > L * 0.12;
  const lum = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    const v: number[] = [];
    for (let x = cx - 3; x <= cx + 3; x++) { const k = (y * W + x) * 4; v.push(0.3 * d[k] + 0.59 * d[k + 1] + 0.11 * d[k + 2]); }
    lum[y] = median(v);
  }
  return { W, H, x0, x1, y0, y1, cx, top, hem, shoulder, body, bodyL, bodyR, armpit, torso, hoodLike, runL, runR, mask, span, lum };
}

/** Analysis of an <img> (must be same-origin or CORS-enabled). Null when it can't be read. */
export function analyzeImage(img: HTMLImageElement | HTMLCanvasElement, w = ANALYSIS_WIDTH): Analysis | null {
  try {
    const nw = 'naturalWidth' in img ? img.naturalWidth : img.width;
    const nh = 'naturalHeight' in img ? img.naturalHeight : img.height;
    if (!nw || !nh) return null;
    const W = w, H = Math.max(1, Math.round((w * nh) / nw));
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, W, H);
    return analyze(ctx.getImageData(0, 0, W, H).data, W, H);
  } catch {
    return null;
  }
}

/** Plain bounding box (as fractions), for the template fallback. */
export function boxOf(a: Analysis | null): Box | null {
  return a ? { x: a.x0 / a.W, y: a.y0 / a.H, w: (a.x1 - a.x0 + 1) / a.W, h: (a.y1 - a.y0 + 1) / a.H } : null;
}

/** One placed print area: rectangle as fractions of the photo, and its real size in inches. */
export interface Placed { x: number; y: number; w: number; h: number; wIn: number; hIn: number; how: 'measured' | 'template' | 'manual' }

export interface Collar { y: number; how: 'neckline' | 'collar' | 'hood' }

/** Where the collar point is on this photo (analysis-grid rows), and how it was found. */
export function collarOf(a: Analysis, side: Side, cfg: PlaceConfig, sc: Scale): Collar {
  const neck = NECK[cfg.template] ?? NECK.tee;
  const { ppi } = sc;
  // Hood: the garment stays about hood-wide for a few inches, then widens sharply where the
  // shoulders start. The collar point is measured from that shoulder line.
  if (neck.hood && a.top - a.y0 < 2.5 * ppi) {
    const sh = shoulderJump(a, sc);
    const min = (cfg.youth ? 1.5 : 2) * ppi;
    const hooded = cfg.hood || sh - a.y0 > min * 1.25;
    if (hooded) {
      // The hood drapes lower at the center than its outline shows, so never above minShare of the length.
      const byShoulder = sh - a.y0 > min ? sh + (side === 'front' ? neck.hood.front : neck.hood.back) * ppi : 0;
      const byLength = a.y0 + (a.hem - a.y0) * neck.hood.minShare * (cfg.crop ? 1.3 : 1);
      return { y: Math.max(byShoulder, byLength), how: 'hood' };
    }
  }
  const open = a.top - a.y0 > 1.5 * ppi;
  if (side === 'back') return { y: a.top, how: open ? 'neckline' : 'collar' };
  const c = frontCollar(a, cfg, ppi, open, neck);
  // Tanks: a deep scoop can show the inside of the back all the way down, looking just like the
  // front. The front neckline is never far above the armholes' lowest point, so keep it near that.
  if (cfg.template === 'tank' && neck.tankArmhole !== undefined) {
    // Lowest point of the armholes: where the garment is widest (the underarm points) in its top half.
    let max = 0;
    const end = a.y0 + (a.hem - a.y0) * 0.55;
    for (let y = a.y0; y < end; y++) max = Math.max(max, a.span[y]);
    let arm = a.y0;
    while (arm < end && a.span[arm] < max * 0.98) arm++;
    const floor = arm - neck.tankArmhole * ppi;
    if (floor > c.y) return { y: floor, how: c.how };
  }
  return c;
}

function frontCollar(a: Analysis, cfg: PlaceConfig, ppi: number, open: boolean, neck: (typeof NECK)[string]): Collar {
  // Front photo: going down the center, the first garment is usually the INSIDE of the back neck
  // (in shadow, often with the neck label); the front neckline is where it turns into the front. Look for that
  // edge; if there's no clear one, use a typical neck drop (closed collars) or the first pixel
  // (open necklines, where the back neck isn't visible).
  const edge = neckEdge(a, ppi, open || cfg.template === 'tank' ? 7 : 4.5);
  // On a closed collar the front neckline is never right at the top: an "edge" there just means
  // the inside of the neck looks like the front (light colors, no shadow), so use the typical drop.
  if (edge > 0 && (open || edge - a.top > 1.2 * ppi)) return { y: edge + (open ? 0 : 0.4) * ppi, how: open ? 'neckline' : 'collar' };
  // Open neckline with no visible edge (dark colors): the inside of the back may be showing, so
  // stay a little lower to keep the print off the neck opening.
  if (open) return { y: a.top + neck.openDrop * ppi, how: 'neckline' };
  return { y: a.top + neck.frontDrop * ppi, how: 'collar' };
}

/** Start of the sharpest widening of the garment within its top 10" (where the shoulders begin). */
export function shoulderJump(a: Analysis, sc: Scale): number {
  const { ppi } = sc;
  const w = Math.max(2, Math.round(ppi));
  // Skip the rounded top of the hood: start once the garment is hood-wide.
  let start = a.y0;
  while (start < a.hem && a.span[start] < sc.body * 0.55) start++;
  let best = a.y0, bestGain = 0;
  for (let y = Math.round(start + 0.5 * ppi); y < Math.min(a.hem - w, a.y0 + 10 * ppi); y++) {
    const gain = a.span[y + w] - a.span[y];
    if (gain > bestGain) { bestGain = gain; best = y; }
  }
  return bestGain > 1.5 * ppi ? best : a.y0;
}

/**
 * Row of the front neckline on a front photo, or -1: the first row below which the center column
 * looks like the front of the garment for at least 1.2", with something clearly different just
 * above it (the shadowed inside of the back neck, or the printed neck label).
 */
export function neckEdge(a: Analysis, ppi: number, maxIn: number): number {
  const L = a.lum;
  const at = (inch: number) => Math.round(a.top + inch * ppi);
  const body: number[] = [];
  for (let y = at(5); y <= Math.min(a.hem - 2, at(9)); y++) body.push(L[y]);
  if (body.length < 4) return -1;
  body.sort((p, q) => p - q);
  const F = body[body.length >> 1];
  const tol = Math.max(10, F * 0.1);
  const run = Math.max(3, Math.round(1.2 * ppi)), above = Math.max(2, Math.round(0.5 * ppi));
  for (let y = at(0.3); y <= Math.min(at(maxIn), a.hem - run - 1); y++) {
    let off = 0;
    for (let k = 1; k <= above; k++) off += L[y - k];
    if (Math.abs(off / above - F) < tol * 1.5) continue;
    let ok = 0;
    for (let k = 0; k < run; k++) if (Math.abs(L[y + k] - F) < tol) ok++;
    if (ok >= run * 0.85) return y;
  }
  return -1;
}

export interface Scale {
  /** Photo pixels (analysis grid) per inch. */
  ppi: number;
  /** Torso width in pixels and its edges. */
  body: number; left: number; right: number;
  /** 'chest' = measured across the chest; 'length' = from the garment length (sleeves hide the torso edges). */
  from: 'chest' | 'length';
}

/** Pixels per inch for this photo: from the chest width, or from the length when the chest can't be measured. */
export function scaleOf(a: Analysis, cfg: PlaceConfig): Scale | null {
  const g = cfg.overrides?.['*'] ?? {};
  const chestIn = g.chestIn ?? cfg.chestIn ?? CHEST_FLAT_IN.adult;
  const R = PHOTO_LENGTH_RATIO;
  const typical = (R[cfg.template] ?? R.tee) * (cfg.womens ? R.womens : 1) * (cfg.youth ? R.youth : 1) * (cfg.crop ? R.crop : 1);
  const L = a.hem - a.y0;
  const torso = a.torso || cfg.template === 'tank';
  const ratio = L / a.body;
  let body = a.body, from: Scale['from'] = 'chest';
  if (!torso || ratio < typical * 0.72 || ratio > typical * 1.4) { body = L / typical; from = 'length'; }
  if (body < (a.x1 - a.x0) * 0.25 || body > (a.x1 - a.x0) * 1.02) return null;
  const left = from === 'chest' ? a.bodyL : a.cx - body / 2;
  const right = from === 'chest' ? a.bodyR + 1 : a.cx + body / 2;
  return { ppi: body / (chestIn * PHOTO_WIDTH_SHARE), body, left, right, from };
}

const q = (n: number) => Math.floor(n * 4 + 1e-6) / 4; // round down to 1/4"

/**
 * Print areas for one photo. Spots on `side` are placed from the analysis; a spot it can't place
 * is left out (the caller uses the template there).
 */
export function placeSpots(a: Analysis | null, side: Side, spots: DesignSpot[], cfg: PlaceConfig): Map<string, Placed> {
  const out = new Map<string, Placed>();
  const table = PLACEMENT[cfg.template];
  const ov = cfg.overrides ?? {};
  const g = ov['*'] ?? {};
  if (!a || !table || g.fallback) return out;
  const sc = scaleOf(a, cfg);
  if (!sc) return out;
  const { ppi } = sc;
  const youth = cfg.youth ? YOUTH_SCALE : 1;
  // Implausible measurements: let the template handle it.
  const lengthIn = (a.hem - a.y0) / ppi;
  if (lengthIn < 8 || lengthIn > 45) return out;
  const collar = collarOf(a, side, cfg, sc);
  const cy = collar.y + (side === 'front' ? g.frontCollarDy ?? 0 : g.backCollarDy ?? 0) * ppi;
  const inner = (y0: number, y1: number) => {
    // Narrowest torso run across these rows (rows with no run at the center are skipped).
    let l = sc.left, r = sc.right;
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(a.H - 1, Math.ceil(y1)); y++) {
      if (a.runL[y] < 0) continue;
      l = Math.max(l, a.runL[y]); r = Math.min(r, a.runR[y] + 1);
    }
    return [l, r];
  };
  const hemLimit = a.hem - 0.75 * ppi;
  for (const sp of spots) {
    if (sp.side !== side) continue;
    const t = table[sp.id];
    if (!t) continue;
    const o = ov[sp.id] ?? {};
    if (o.fallback) continue;
    const dy = cfg.crop && t.crop !== undefined ? t.crop : t.dy;
    let wIn = sp.wIn * (o.scale ?? 1), hIn = sp.hIn * (o.scale ?? 1);
    let x: number, y: number;
    if (t.sleeve) {
      const s = sleeveSpot(a, sc, sp.id === 'left-sleeve' ? 1 : -1, wIn, hIn, t.sleeve === 'long');
      if (!s) continue;
      ({ x, y, wIn, hIn } = s);
      x += (o.dx ?? 0) * ppi; y += (o.dy ?? 0) * ppi;
    } else {
      y = cy + (dy * youth + (o.dy ?? 0)) * ppi;
      const ccx = a.cx + ((t.dx ?? 0) * youth + (o.dx ?? 0)) * ppi;
      // Never below the hem (0.75" clear): shorten the area.
      if (y + hIn * ppi > hemLimit) hIn = (hemLimit - y) / ppi;
      if (hIn < 1) continue;
      // Keep inside the torso (0.5" clear each side): shrink proportionally.
      const [l, r] = inner(y, y + hIn * ppi);
      const room = (t.dx ? Math.min(ccx - l, r - ccx) * 2 : r - l) / ppi - 1;
      if (wIn > room) { const k = Math.max(0.25, room / wIn); wIn *= k; hIn *= k; }
      if (hIn < 1 || wIn < 1) continue;
      wIn = q(wIn); hIn = q(hIn);
      x = ccx - (wIn * ppi) / 2;
    }
    out.set(sp.id, { x: x / a.W, y: y / a.H, w: (wIn * ppi) / a.W, h: (hIn * ppi) / a.H, wIn, hIn, how: 'measured' });
  }
  return out;
}

/** A sleeve print, centered on the sleeve where it leaves the torso. dir: +1 = viewer's right. */
function sleeveSpot(a: Analysis, sc: Scale, dir: 1 | -1, wIn: number, hIn: number, long: boolean) {
  const { W, mask } = a;
  const { ppi } = sc;
  const edge = dir > 0 ? sc.right + 0.4 * ppi : sc.left - 0.4 * ppi;
  const yEnd = a.armpit > 0 && !long ? a.armpit : a.hem;
  // Per row: the stretch of sleeve outside the torso edge.
  const rows: { y: number; c: number; w: number }[] = [];
  for (let y = a.y0; y <= yEnd; y++) {
    let s = -1, e = -1;
    if (dir > 0) { for (let x = Math.ceil(edge); x < W; x++) if (mask[y * W + x]) { if (s < 0) s = x; e = x; } }
    else { for (let x = Math.floor(edge); x >= 0; x--) if (mask[y * W + x]) { if (s < 0) s = x; e = x; } }
    if (s >= 0 && Math.abs(e - s) + 1 >= 1.5 * ppi) rows.push({ y, c: (s + e) / 2, w: Math.abs(e - s) + 1 });
  }
  if (rows.length < 3 * ppi * (long ? 2 : 0.6)) return null;
  if (long) {
    // From the front only part of a long sleeve shows, but the print wraps the outer sleeve:
    // keep a usable width (3"+, up to the full size) rather than the visible strip.
    wIn = q(Math.min(wIn, Math.max(3, Math.min(...rows.map((r) => r.w)) / ppi - 0.5)));
    // Long sleeve: runs down the sleeve from just below the shoulder seam.
    const first = rows[0].y + 1.5 * ppi;
    const span = rows.filter((r) => r.y >= first);
    if (!span.length) return null;
    const last = span[span.length - 1].y;
    hIn = q(Math.min(hIn, (last - first) / ppi - 1.5));
    if (hIn < 2) return null;
    const used = span.filter((r) => r.y <= first + hIn * ppi);
    const c = used.reduce((s, r) => s + r.c, 0) / used.length;
    return { x: c - (wIn * ppi) / 2, y: first, wIn, hIn };
  }
  // Short sleeve: centered on the part of the sleeve outside the torso, sized to fit across it.
  let sx = 0, sy = 0, cnt = 0;
  for (const r of rows) { sx += r.c * r.w; sy += r.y * r.w; cnt += r.w; }
  const mx = sx / cnt, my = sy / cnt;
  const mid = rows.reduce((p, r) => (Math.abs(r.y - my) < Math.abs(p.y - my) ? r : p), rows[0]);
  // Height of the sleeve at its center column.
  const col = Math.round(mx);
  let t = Math.round(my), b = t;
  while (t > 0 && mask[(t - 1) * W + col]) t--;
  while (b < a.H - 1 && mask[(b + 1) * W + col]) b++;
  wIn = q(Math.min(wIn, mid.w / ppi - 0.6));
  hIn = q(Math.min(hIn, (b - t + 1) / ppi - 0.6));
  if (hIn < 1 || wIn < 1) return null;
  return { x: mx - (wIn * ppi) / 2, y: (t + b) / 2 - (hIn * ppi) / 2, wIn, hIn };
}

/** Template placement (fractions of the garment's bounding box), kept inside the garment. */
export function templateRect(sp: DesignSpot, b: Box, aspect: number): Placed {
  let w = sp.w * b.w;
  let h = (w * aspect * sp.hIn) / sp.wIn; // photo-height fraction
  // Never taller than the garment, and never hanging below it (wide bags, short duffels).
  let y = b.y + b.h * sp.top;
  const bottom = b.y + b.h * 0.97;
  const k = Math.min(1, Math.max((bottom - y) / h, Math.min(0.6, (b.h * 0.9) / h)));
  w *= k; h *= k;
  if (y + h > bottom) y = Math.max(b.y + b.h * 0.03, bottom - h);
  const wIn = k < 1 ? q(sp.wIn * k) : sp.wIn, hIn = k < 1 ? q(sp.hIn * k) : sp.hIn;
  return { x: b.x + b.w * sp.cx - w / 2, y, w, h, wIn, hIn, how: 'template' };
}
