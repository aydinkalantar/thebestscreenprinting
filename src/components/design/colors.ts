// Ink color count of uploaded artwork, for screen print pricing (customers don't pick it).
//
// The image is drawn small (max 240 px), transparent pixels are dropped, and when the art has
// no transparency the color touching most of the border is treated as the background. The rest
// is grouped into ink colors: pixels are binned on a coarse RGB grid, bins are merged when their
// colors are close (perceptual-ish distance), and clusters smaller than ~1% of the art are
// treated as anti-aliasing between two inks. Lots of small, scattered bins (gradients, photos)
// or more than MAX_SPOT clusters mean full color.
//
// The studio admin re-counts the stored file; the proof is the final word.

export const MAX_SPOT = 6;

export type InkCount =
  | { kind: 'spot'; count: number; colors: string[]; widthPx: number; heightPx: number; vector: boolean }
  | { kind: 'full'; widthPx: number; heightPx: number; vector: boolean }
  | { kind: 'unknown' };

const READABLE = /^image\/(png|jpeg|webp|gif|svg\+xml)$/;

async function loadBitmap(file: Blob): Promise<{ img: CanvasImageSource; w: number; h: number } | null> {
  if (!READABLE.test(file.type)) return null;
  if (file.type === 'image/svg+xml') {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const w = img.naturalWidth || 1000, h = img.naturalHeight || 1000;
      return { img, w, h };
    } catch { return null; } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  try {
    const bmp = await createImageBitmap(file);
    return { img: bmp, w: bmp.width, h: bmp.height };
  } catch { return null; }
}

// Weighted RGB distance ("redmean"), close enough to perceived difference for grouping inks.
function dist(a: number[], b: number[]) {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}
/** True when c lies between a and b (a blend of the two), away from both ends. */
function nearSegment(c: number[], a: number[], b: number[]) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  if (!len2) return false;
  const t = ((c[0] - a[0]) * ab[0] + (c[1] - a[1]) * ab[1] + (c[2] - a[2]) * ab[2]) / len2;
  if (t < 0.08 || t > 0.92) return false;
  return dist(c, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]) < 50;
}
const hex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

export async function countInks(file: Blob): Promise<InkCount> {
  const src = await loadBitmap(file);
  if (!src) return { kind: 'unknown' };
  const scale = Math.min(1, 240 / Math.max(src.w, src.h));
  const W = Math.max(1, Math.round(src.w * scale)), H = Math.max(1, Math.round(src.h * scale));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { kind: 'unknown' };
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src.img, 0, 0, W, H);
  let data: Uint8ClampedArray;
  try { data = ctx.getImageData(0, 0, W, H).data; } catch { return { kind: 'unknown' }; }

  // Background: with no transparency, the most common color on the border (if it covers most of it).
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 128) transparent++;
  const key = (i: number) => ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
  let bg: number[] | null = null;
  if (transparent < W * H * 0.02) {
    const border = new Map<number, { n: number; sum: number[] }>();
    const add = (x: number, y: number) => {
      const i = (y * W + x) * 4;
      const k = key(i);
      const b = border.get(k) ?? { n: 0, sum: [0, 0, 0] };
      b.n++; b.sum[0] += data[i]; b.sum[1] += data[i + 1]; b.sum[2] += data[i + 2];
      border.set(k, b);
    };
    for (let x = 0; x < W; x++) { add(x, 0); add(x, H - 1); }
    for (let y = 1; y < H - 1; y++) { add(0, y); add(W - 1, y); }
    const top = [...border.values()].sort((a, b) => b.n - a.n)[0];
    const total = 2 * W + 2 * Math.max(0, H - 2);
    if (top && top.n > total * 0.6) bg = top.sum.map((v) => v / top.n);
  }

  // Bin the artwork pixels on a 16-level grid per channel.
  const bins = new Map<number, { n: number; sum: number[] }>();
  let art = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const c = [data[i], data[i + 1], data[i + 2]];
    if (bg && dist(c, bg) < 40) continue;
    art++;
    const k = key(i);
    const b = bins.get(k) ?? { n: 0, sum: [0, 0, 0] };
    b.n++; b.sum[0] += c[0]; b.sum[1] += c[1]; b.sum[2] += c[2];
    bins.set(k, b);
  }
  const size = { widthPx: src.w, heightPx: src.h, vector: file.type === 'image/svg+xml' };
  if (art < 20) return { kind: 'spot', count: 1, colors: [], ...size };

  // Merge bins into clusters, biggest first.
  const sorted = [...bins.values()].map((b) => ({ n: b.n, c: b.sum.map((v) => v / b.n) })).sort((a, b) => b.n - a.n);
  const clusters: { n: number; c: number[] }[] = [];
  for (const b of sorted) {
    const near = clusters.find((cl) => dist(cl.c, b.c) < 90);
    if (near) {
      const n = near.n + b.n;
      near.c = near.c.map((v, j) => (v * near.n + b.c[j] * b.n) / n);
      near.n = n;
    } else clusters.push({ n: b.n, c: b.c });
  }
  // Anti-aliasing: a color sitting between two bigger inks (or an ink and the background) is
  // the blend along their shared edge, not an ink of its own.
  const big = clusters.filter((cl) => cl.n >= art * 0.012);
  const main: typeof clusters = [];
  for (const cl of big) {
    // Blends are thin edges: much smaller than the inks on either side.
    const anchors = [...main, ...(bg ? [{ n: Infinity, c: bg }] : [])];
    const blend = anchors.some((a, i) => anchors.some((b, j) => j > i && cl.n < 0.4 * Math.min(a.n, b.n) && nearSegment(cl.c, a.c, b.c)));
    if (!blend) main.push(cl);
  }
  const covered = big.reduce((s, cl) => s + cl.n, 0) / art;
  // Gradients and photos: many mid-sized bins and a lot of pixels outside the main inks.
  const busyBins = sorted.filter((b) => b.n >= art * 0.002).length;
  if (main.length > MAX_SPOT || covered < 0.9 || (busyBins > 60 && main.length > 3)) return { kind: 'full', ...size };
  return { kind: 'spot', count: Math.max(1, main.length), colors: main.map((cl) => hex(cl.c)), ...size };
}

const rgbOf = (css: string): number[] | null => {
  const h = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (h) return [0, 2, 4].map((i) => parseInt(h[1].slice(i, i + 2), 16));
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(css);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

/**
 * Inks that actually print on this garment color: an ink matching the garment
 * (black on a black tee) isn't printed, so it isn't counted. At least one.
 */
export function inksOn(found: Extract<InkCount, { kind: 'spot' }>, garment: string): string[] {
  const g = rgbOf(garment);
  const kept = g ? found.colors.filter((c) => { const r = rgbOf(c); return !r || Math.hypot(r[0] - g[0], r[1] - g[1], r[2] - g[2]) >= 40; }) : found.colors;
  return kept.length ? kept : found.colors.slice(0, 1);
}

/** Effective print resolution: under ~150 DPI prints look soft. */
export const dpiFor = (widthPx: number, widthIn: number) => (widthIn > 0 ? Math.round(widthPx / widthIn) : 0);
