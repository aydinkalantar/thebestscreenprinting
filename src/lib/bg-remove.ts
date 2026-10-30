// Background removal for uploaded artwork, in the browser (no outside service, nothing uploaded).
// Most uploads with a background are a logo on a plain white box (a JPG, a screenshot): that box
// would print as a white rectangle. checkBackground() looks at the image's border:
//
//   'white'  the border is (near) white → removed right away (the visitor can undo it)
//   'plain'  the border is one other solid color → offered as a "Remove background" button only,
//            since a solid square can be the design itself (a black badge with white text)
//   'busy'   no single border color (a photo, a pattern) → never cut automatically; a note says our
//            designer will look at it on the proof
//   'none'   already transparent, or not a raster image
//
// removeBackground() floods the background in from the edges, so the design's own colors stay even
// when they match the background (a white logo detail). Small enclosed holes of the exact background
// color (the inside of an O or an A) are removed too; larger enclosed areas are kept as part of the
// design. Edges are softened and un-mixed from the background so no white halo is left. The cleaned
// file is named "… (background removed).png", so the shop sees what happened on every order and proof.

export type BgCheck =
  | { kind: 'none' }
  | { kind: 'white' | 'plain'; rgb: [number, number, number] }
  | { kind: 'busy' };

const RASTER = /^image\/(png|jpeg|webp)$/;
/** Hard and soft color distance (squared RGB distance) from the background. */
const HARD = 38 * 38, SOFT = 95 * 95;
/** Enclosed holes of the background color up to this share of the image are removed (letter counters). */
const HOLE = 0.04;

const canvasFor = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const d2 = (d: Uint8ClampedArray, i: number, bg: number[]) => { const r = d[i] - bg[0], g = d[i + 1] - bg[1], b = d[i + 2] - bg[2]; return r * r + g * g + b * b; };

export function canClean(file: File) { return RASTER.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name); }

/** What kind of background the image has (looked at small, so it's quick). */
export function checkBackground(img: HTMLImageElement): BgCheck {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!iw || !ih) return { kind: 'none' };
  const s = Math.min(1, 300 / Math.max(iw, ih));
  const W = Math.max(2, Math.round(iw * s)), H = Math.max(2, Math.round(ih * s));
  const ctx = canvasFor(W, H).getContext('2d', { willReadFrequently: true });
  if (!ctx) return { kind: 'none' };
  ctx.drawImage(img, 0, 0, W, H);
  let d: Uint8ClampedArray;
  try { d = ctx.getImageData(0, 0, W, H).data; } catch { return { kind: 'none' }; }
  // Already cut out: leave it alone.
  let clear = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 128) clear++;
  if (clear > W * H * 0.02) return { kind: 'none' };
  // The border's most common color (coarse bins), averaged.
  const border: number[] = [];
  for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x);
  for (let y = 1; y < H - 1; y++) border.push(y * W, y * W + W - 1);
  const bins = new Map<number, { n: number; sum: [number, number, number] }>();
  for (const p of border) {
    const i = p * 4, k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    const b = bins.get(k) ?? { n: 0, sum: [0, 0, 0] };
    b.n++; b.sum[0] += d[i]; b.sum[1] += d[i + 1]; b.sum[2] += d[i + 2];
    bins.set(k, b);
  }
  const top = [...bins.values()].sort((a, b) => b.n - a.n)[0];
  const rgb = top.sum.map((v) => Math.round(v / top.n)) as [number, number, number];
  // Plain only when nearly the whole border is that color (JPEG noise allowed).
  const near = border.filter((p) => d2(d, p * 4, rgb) < HARD).length / border.length;
  if (near < 0.9) return { kind: 'busy' };
  // A border that is the whole image (a blank or nearly blank file): nothing to cut out.
  let bgPx = 0;
  for (let i = 0; i < d.length; i += 4) if (d2(d, i, rgb) < HARD) bgPx++;
  if (bgPx > W * H * 0.985 || bgPx < W * H * 0.04) return { kind: 'none' };
  const white = rgb.every((v) => v >= 225) && Math.max(...rgb) - Math.min(...rgb) <= 18;
  return { kind: white ? 'white' : 'plain', rgb };
}

/** The image with its background made transparent, as a PNG file (up to 4096 px on the long side). */
export async function removeBackground(img: HTMLImageElement, name: string, rgb: [number, number, number]): Promise<File | null> {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const s = Math.min(1, 4096 / Math.max(iw, ih));
  const W = Math.round(iw * s), H = Math.round(ih * s);
  const canvas = canvasFor(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, W, H);
  let data: ImageData;
  try { data = ctx.getImageData(0, 0, W, H); } catch { return null; }
  const d = data.data, n = W * H;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  const edge: number[] = [];

  /** Clears a region from the queue's seeds: background pixels go, near-background edge pixels fade. */
  const flood = (head: number, tail: number) => {
    const visit = (q: number) => {
      if (seen[q]) return;
      const dist = d2(d, q * 4, rgb);
      if (dist < HARD) { seen[q] = 1; queue[tail++] = q; }
      else if (dist < SOFT) { seen[q] = 2; edge.push(q); }
    };
    while (head < tail) {
      const p = queue[head++], x = p % W;
      if (x > 0) visit(p - 1);
      if (x < W - 1) visit(p + 1);
      if (p >= W) visit(p - W);
      if (p < n - W) visit(p + W);
    }
    return tail;
  };
  // 1. Everything connected to the border.
  let tail = 0;
  for (let x = 0; x < W; x++) for (const p of [x, (H - 1) * W + x]) if (!seen[p] && d2(d, p * 4, rgb) < HARD) { seen[p] = 1; queue[tail++] = p; }
  for (let y = 1; y < H - 1; y++) for (const p of [y * W, y * W + W - 1]) if (!seen[p] && d2(d, p * 4, rgb) < HARD) { seen[p] = 1; queue[tail++] = p; }
  tail = flood(0, tail);
  for (let k = 0; k < tail; k++) d[queue[k] * 4 + 3] = 0;
  // 2. Small enclosed holes of the background color (letter counters). Bigger ones are part of the design.
  for (let p = 0; p < n; p++) {
    if (seen[p] || d2(d, p * 4, rgb) >= HARD) continue;
    const edgeStart = edge.length;
    seen[p] = 1; queue[0] = p;
    const end = flood(0, 1);
    if (end <= n * HOLE) { for (let k = 0; k < end; k++) d[queue[k] * 4 + 3] = 0; }
    else { for (let k = edgeStart; k < edge.length; k++) seen[edge[k]] = 0; edge.length = edgeStart; }
  }
  // 3. Soft edges: partly transparent, with the background's tint taken out of the color.
  for (const q of edge) {
    const i = q * 4;
    const a = Math.min(1, (Math.sqrt(d2(d, i, rgb)) - Math.sqrt(HARD)) / (Math.sqrt(SOFT) - Math.sqrt(HARD)));
    if (a <= 0) { d[i + 3] = 0; continue; }
    for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, Math.round(rgb[c] + (d[i + c] - rgb[c]) / a)));
    d[i + 3] = Math.round(d[i + 3] * a);
  }
  ctx.putImageData(data, 0, 0);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) return null;
  const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/ \(background removed\)$/, '');
  return new File([blob], `${base} (background removed).png`, { type: 'image/png' });
}

/** Loads a file as an image (for checking and cleaning). */
export function imageOf(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
    img.src = url;
  });
}
