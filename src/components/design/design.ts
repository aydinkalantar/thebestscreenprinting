// Design preview on product pages: place artwork per location on the garment photo, then send the
// whole request (files, rendered mockups, placements) to /api/quote. Markup: DesignPreview.astro
// and DesignRequestSheet.astro. Print areas and inch sizes: areas.ts.
import { openSheet, wireSheet } from '../../lib/sheet';
import { garmentFor, MAX_ARTWORK_BYTES, MAX_TOTAL_BYTES, MAX_PLACEMENTS } from '../../lib/quote';
import { business } from '../../data/business';
import type { DesignSpot, Side } from './areas';

type Box = { x: number; y: number; w: number; h: number };
interface Art {
  loc: string; file: File; kind: 'image' | 'file'; ext: string; url?: string; img?: HTMLImageElement;
  /** Height / width of the artwork itself. */
  aspect: number;
  /** Position and width as fractions of the print area. */
  x: number; y: number; w: number;
  decoration: string; notes: string; el?: HTMLElement;
}
export interface Order {
  name: string; style: string; brand: string; color: string; cat: string; sub: string; url: string;
  sizes: { size: string; n: number }[]; total: number;
}
interface Options { summary: HTMLElement | null; sheet: HTMLElement | null; getOrder: () => Order; onChange: () => void }
type Config = { spots: DesignSpot[]; decorations: string[]; name: string };

/** File types we accept, by extension, with the MIME type the API expects. */
const TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml',
  pdf: 'application/pdf', ai: 'application/postscript', psd: 'image/vnd.adobe.photoshop',
};
const DRAWABLE = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg']);
const DEFAULT_BOX: Box = { x: 0.12, y: 0.06, w: 0.76, h: 0.88 };
const MB = (n: number) => `${(n / 1024 / 1024).toFixed(n < 1024 * 1024 ? 2 : 1)} MB`;
const inch = (n: number) => `${(Math.round(n * 10) / 10).toString()}"`;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const extOf = (name: string) => (name.split('.').pop() || '').toLowerCase();
const ICON = {
  pencil: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
};

/** Bounding box of the garment in a product photo: trims the plain background around it. */
function findBox(img: HTMLImageElement): Box {
  try {
    const W = 160, H = Math.max(1, Math.round((160 * img.naturalHeight) / img.naturalWidth));
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const bg = [d[0], d[1], d[2]];
    const cols = new Array(W).fill(0), rows = new Array(H).fill(0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4;
      if (Math.abs(d[k] - bg[0]) + Math.abs(d[k + 1] - bg[1]) + Math.abs(d[k + 2] - bg[2]) > 30) { cols[x]++; rows[y]++; }
    }
    const span = (a: number[], min: number) => { const s = a.findIndex((v) => v >= min); let e = a.length - 1; while (e >= 0 && a[e] < min) e--; return [s, e]; };
    const [x0, x1] = span(cols, Math.max(2, H * 0.015));
    const [y0, y1] = span(rows, Math.max(2, W * 0.015));
    if (x0 < 0 || x1 - x0 < W * 0.2 || y1 - y0 < H * 0.2) return DEFAULT_BOX;
    return { x: x0 / W, y: y0 / H, w: (x1 - x0 + 1) / W, h: (y1 - y0 + 1) / H };
  } catch {
    return DEFAULT_BOX; // photo without CORS: fall back to a typical framing
  }
}

function loadImage(src: string, cors: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

export function mountDesign(root: HTMLElement, opts: Options) {
  const cfg = JSON.parse(root.dataset.config || '{}') as Config;
  const spots = cfg.spots;
  const spotById = new Map(spots.map((s) => [s.id, s]));
  const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const qa = <T extends Element = HTMLElement>(sel: string) => [...root.querySelectorAll<T>(sel)];

  const stage = q('[data-stage]');
  const stageWrap = q('[data-stage-wrap]');
  const zoomer = q('[data-zoomer]');
  const photoEl = q<HTMLImageElement>('[data-photo]');
  const layer = q('[data-layer]');
  const note = q('[data-stage-note]');
  const zoomBtn = q<HTMLButtonElement>('[data-zoom]');
  const tabs = qa<HTMLButtonElement>('[data-side]');
  const chips = qa<HTMLButtonElement>('[data-loc]');
  const fileInput = q<HTMLInputElement>('[data-file-input]');
  const errorEl = q('[data-error]');
  const announcer = q('[data-announce]');
  const panel = {
    empty: q('[data-empty]'), filled: q('[data-filled]'),
    names: qa('[data-loc-name]'), size: q('[data-loc-size]'), addLabel: q('[data-add-label]'),
    file: q('[data-file]'), readout: q('[data-readout]'),
    decoration: q<HTMLSelectElement>('[data-decoration]'), notes: q<HTMLInputElement>('[data-notes]'),
  };

  const arts = new Map<string, Art>();
  const boxes = new Map<string, Box>();
  const aspects = new Map<string, number>(); // photo width / height
  let colorName = '';
  let front = photoEl.currentSrc || photoEl.src;
  let back = '';
  let side: Side = 'front';
  let active = spots[0]?.id ?? '';
  let zoomed = false;

  // ── geometry ───────────────────────────────────────────────────────────────
  const photoFor = (s: Side) => (s === 'back' ? back || front : front);
  const ratio = (a: Art, sp: DesignSpot) => (a.aspect * sp.wIn) / sp.hIn; // art height / width, in print-area fractions
  const artH = (a: Art) => a.w * ratio(a, spotById.get(a.loc)!);
  /** A location's print area on a photo, as fractions of the photo. */
  const areaRect = (sp: DesignSpot, url: string): Box => {
    const b = boxes.get(url) ?? DEFAULT_BOX;
    const aspect = aspects.get(url) ?? 0.8;
    const w = sp.w * b.w;
    const h = (w * aspect * sp.hIn) / sp.wIn;
    return { x: b.x + b.w * sp.cx - w / 2, y: b.y + b.h * sp.top, w, h };
  };
  const minW = (sp: DesignSpot) => Math.max(0.04, 0.4 / sp.wIn);
  const maxW = (a: Art, x = a.x, y = a.y) => Math.max(0.01, Math.min(1 - x, (1 - y) / ratio(a, spotById.get(a.loc)!)));
  /** Largest fit inside the area; full-size areas start at the top, small ones centered. */
  const fit = (a: Art) => {
    const sp = spotById.get(a.loc)!;
    a.w = Math.min(1, 1 / ratio(a, sp));
    a.x = (1 - a.w) / 2;
    a.y = sp.hIn >= 10 ? 0 : (1 - artH(a)) / 2;
  };
  const measure = (a: Art) => {
    const sp = spotById.get(a.loc)!;
    const h = artH(a);
    return {
      widthIn: a.w * sp.wIn, heightIn: h * sp.hIn, fromTopIn: a.y * sp.hIn,
      fromCenterIn: (a.x + a.w / 2 - 0.5) * sp.wIn,
    };
  };
  const describe = (a: Art) => {
    const m = measure(a);
    const off = Math.abs(m.fromCenterIn) < 0.15 ? 'centered' : `${inch(Math.abs(m.fromCenterIn))} ${m.fromCenterIn < 0 ? 'left' : 'right'} of center`;
    return `≈ ${inch(m.widthIn)} × ${inch(m.heightIn)} · ${inch(m.fromTopIn)} from top of print area, ${off}`;
  };
  const sizeText = (a: Art) => { const m = measure(a); return `≈ ${inch(m.widthIn)} × ${inch(m.heightIn)}`; };
  const totalBytes = (skip?: string) => [...arts.values()].reduce((n, a) => n + (a.loc === skip ? 0 : a.file.size), 0);
  const ordered = () => spots.map((s) => arts.get(s.id)).filter((a): a is Art => !!a);

  // ── messages ───────────────────────────────────────────────────────────────
  const setError = (msg = '') => { errorEl.textContent = msg; };
  let announceTimer = 0;
  const announce = (msg: string) => {
    clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => { announcer.textContent = msg; }, 250);
  };

  // ── stage ──────────────────────────────────────────────────────────────────
  const hasBack = () => !!back || spots.some((s) => s.side === 'back' && arts.has(s.id));

  function onPhotoLoad() {
    const url = photoEl.currentSrc || photoEl.src;
    if (!photoEl.naturalWidth) return;
    aspects.set(url, photoEl.naturalWidth / photoEl.naturalHeight);
    if (!boxes.has(url)) boxes.set(url, findBox(photoEl));
    const a = aspects.get(url)!;
    stage.style.aspectRatio = String(a);
    stageWrap.style.width = `min(100%, calc(var(--stage-h) * ${a}))`;
    renderLayer();
    applyZoom();
  }
  photoEl.addEventListener('load', onPhotoLoad);
  if (photoEl.complete) onPhotoLoad();

  function artElement(a: Art) {
    if (a.el) return a.el;
    const el = document.createElement('div');
    el.className = 'd-art';
    el.tabIndex = 0;
    el.dataset.loc = a.loc;
    el.setAttribute('aria-roledescription', 'movable artwork');
    if (a.kind === 'image' && a.url) {
      const img = document.createElement('img');
      img.src = a.url;
      img.alt = '';
      img.draggable = false;
      el.append(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'd-ph';
      const b = document.createElement('b'); b.textContent = a.ext.toUpperCase();
      const s = document.createElement('span'); s.textContent = a.file.name;
      ph.append(b, s);
      el.append(ph);
    }
    const handle = document.createElement('div');
    handle.className = 'd-handle';
    handle.dataset.handle = '';
    handle.setAttribute('aria-hidden', 'true');
    el.append(handle);
    a.el = el;
    return el;
  }
  function placeArt(a: Art) {
    const el = artElement(a);
    el.style.left = `${a.x * 100}%`;
    el.style.top = `${a.y * 100}%`;
    el.style.width = `${a.w * 100}%`;
    el.style.height = `${artH(a) * 100}%`;
    // Tiny artwork: push the resize handle off its corner so the artwork itself stays grabbable.
    if (el.isConnected) el.classList.toggle('is-tiny', el.getBoundingClientRect().width < 52);
    const sp = spotById.get(a.loc)!;
    el.setAttribute('aria-label', `${sp.label} artwork, ${a.file.name}. ${sizeText(a)}. Arrow keys move it, plus and minus resize it.`);
  }

  function renderLayer() {
    const url = photoFor(side);
    layer.replaceChildren();
    for (const sp of spots) {
      if (sp.side !== side) continue;
      const r = areaRect(sp, url);
      const area = document.createElement('div');
      area.className = 'd-area';
      area.dataset.area = sp.id;
      Object.assign(area.style, { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });
      const isActive = sp.id === active;
      if (isActive) {
        area.classList.add('is-active');
        const label = document.createElement('span');
        label.className = 'd-area-label';
        label.textContent = sp.label;
        area.append(label);
      }
      const a = arts.get(sp.id);
      if (a) {
        placeArt(a);
        a.el!.classList.toggle('is-active', isActive);
        (a.el!.querySelector('[data-handle]') as HTMLElement).hidden = !isActive;
        area.append(a.el!);
      }
      layer.append(area);
    }
  }

  function applyZoom() {
    const sp = spotById.get(active);
    const r = sp && sp.side === side ? areaRect(sp, photoFor(side)) : null;
    const zoomable = !!r && r.w < 0.5;
    zoomBtn.hidden = !zoomable && !zoomed;
    zoomBtn.setAttribute('aria-pressed', String(zoomed));
    zoomBtn.setAttribute('aria-label', zoomed ? 'Show the whole garment' : 'Zoom in on the print area');
    zoomBtn.querySelector('[data-zoom-in]')?.classList.toggle('hidden', zoomed);
    zoomBtn.querySelector('[data-zoom-out]')?.classList.toggle('hidden', !zoomed);
    if (!zoomed || !r) { zoomer.style.transform = ''; zoomer.style.setProperty('--z', '1'); return; }
    const s = clamp(0.6 / r.w, 1, 3.2);
    const tx = clamp(0.5 - (r.x + r.w / 2) * s, 1 - s, 0);
    const ty = clamp(0.5 - (r.y + r.h / 2) * s, 1 - s, 0);
    zoomer.style.transform = `translate(${tx * 100}%, ${ty * 100}%) scale(${s})`;
    zoomer.style.setProperty('--z', String(s));
  }
  zoomBtn.addEventListener('click', () => { zoomed = !zoomed; applyZoom(); });

  function renderPanel() {
    const sp = spotById.get(active);
    if (!sp) return;
    const a = arts.get(active);
    panel.names.forEach((n) => { n.textContent = sp.label; });
    panel.size.textContent = `Print area up to ${inch(sp.wIn)} × ${inch(sp.hIn)}`;
    panel.addLabel.textContent = `Add artwork to ${sp.label.toLowerCase()}`;
    panel.empty.hidden = !!a;
    panel.filled.hidden = !a;
    if (a) {
      panel.file.textContent = a.kind === 'file' ? `${a.file.name} (preview not available, we'll use the file)` : a.file.name;
      panel.readout.textContent = describe(a);
      panel.decoration.value = a.decoration;
      if (document.activeElement !== panel.notes) panel.notes.value = a.notes;
    }
  }

  function render() {
    const showBack = hasBack();
    tabs.forEach((t) => {
      if (t.dataset.side === 'back') t.hidden = !showBack;
      t.setAttribute('aria-selected', String(t.dataset.side === side));
      t.tabIndex = t.dataset.side === side ? 0 : -1;
    });
    chips.forEach((c) => {
      const id = c.dataset.loc!;
      c.hidden = c.dataset.sideOf === 'back' && !showBack;
      c.setAttribute('aria-pressed', String(id === active));
      c.querySelector('[data-dot]')!.classList.toggle('hidden', !arts.has(id));
      c.querySelector('[data-has]')!.textContent = arts.has(id) ? ' (artwork added)' : ' (no artwork)';
    });
    const url = photoFor(side);
    if (photoEl.getAttribute('src') !== url) {
      photoEl.src = url;
      photoEl.alt = `${cfg.name}${colorName ? `, ${colorName}` : ''}, ${side}`;
    }
    note.hidden = !(side === 'back' && !back);
    note.textContent = 'No back photo for this color. Showing the front for placement.';
    renderLayer();
    renderPanel();
    applyZoom();
    renderSummary();
    opts.onChange();
  }

  function select(id: string, { zoom = true, scroll = false } = {}) {
    const sp = spotById.get(id);
    if (!sp) return;
    active = id;
    side = sp.side;
    if (zoom) { const r = areaRect(sp, photoFor(side)); zoomed = r.w < 0.2; }
    setError();
    render();
    if (scroll) root.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  tabs.forEach((t) => t.addEventListener('click', () => {
    const s = t.dataset.side as Side;
    const first = spots.find((sp) => sp.side === s && arts.has(sp.id)) ?? spots.find((sp) => sp.side === s);
    if (first) select(first.id);
  }));
  root.querySelector('[data-tabs]')!.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k !== 'ArrowLeft' && k !== 'ArrowRight') return;
    const visible = tabs.filter((t) => !t.hidden);
    const i = visible.findIndex((t) => t.dataset.side === side);
    const next = visible[(i + (k === 'ArrowRight' ? 1 : visible.length - 1)) % visible.length];
    next?.click();
    next?.focus();
  });
  chips.forEach((c) => c.addEventListener('click', () => select(c.dataset.loc!)));

  // ── drag, resize, keyboard ─────────────────────────────────────────────────
  let drag: null | { a: Art; mode: 'move' | 'resize'; id: number; px: number; py: number; x: number; y: number; r: DOMRect } = null;
  layer.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement;
    const el = target.closest<HTMLElement>('.d-art');
    if (!el || e.button > 0) return;
    const a = arts.get(el.dataset.loc!);
    if (!a) return;
    e.preventDefault();
    if (active !== a.loc) { active = a.loc; render(); }
    el.focus({ preventScroll: true });
    const r = el.parentElement!.getBoundingClientRect();
    drag = { a, mode: target.closest('[data-handle]') ? 'resize' : 'move', id: e.pointerId, px: e.clientX, py: e.clientY, x: a.x, y: a.y, r };
    el.setPointerCapture(e.pointerId);
  });
  layer.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { a, r } = drag;
    const sp = spotById.get(a.loc)!;
    if (drag.mode === 'move') {
      a.x = clamp(drag.x + (e.clientX - drag.px) / r.width, 0, 1 - a.w);
      a.y = clamp(drag.y + (e.clientY - drag.py) / r.height, 0, Math.max(0, 1 - artH(a)));
    } else {
      const fromX = (e.clientX - r.left) / r.width - a.x;
      const fromY = ((e.clientY - r.top) / r.height - a.y) / ratio(a, sp);
      a.w = clamp(Math.max(fromX, fromY), Math.min(minW(sp), maxW(a)), maxW(a));
    }
    placeArt(a);
    panel.readout.textContent = describe(a);
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const a = drag.a;
    drag = null;
    renderPanel();
    renderSummary();
    announce(`${spotById.get(a.loc)!.label} artwork ${sizeText(a)}.`);
  };
  layer.addEventListener('pointerup', endDrag);
  layer.addEventListener('pointercancel', endDrag);

  layer.addEventListener('keydown', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.d-art');
    const a = el && arts.get(el.dataset.loc!);
    if (!a) return;
    const sp = spotById.get(a.loc)!;
    const step = e.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      a.x = clamp(a.x + moves[e.key][0], 0, 1 - a.w);
      a.y = clamp(a.y + moves[e.key][1], 0, Math.max(0, 1 - artH(a)));
    } else if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
      const grow = e.key === '+' || e.key === '=' ? 1.06 : 1 / 1.06;
      const cx = a.x + a.w / 2, cy = a.y + artH(a) / 2;
      const r = ratio(a, sp);
      const w = clamp(a.w * grow, minW(sp), Math.min(1, 1 / r));
      a.w = w;
      a.x = clamp(cx - w / 2, 0, 1 - w);
      a.y = clamp(cy - (w * r) / 2, 0, Math.max(0, 1 - w * r));
    } else return;
    e.preventDefault();
    if (active !== a.loc) { active = a.loc; render(); el!.focus(); }
    placeArt(a);
    renderPanel();
    renderSummary();
    announce(`${sizeText(a)}, ${describe(a).split(' · ')[1]}`);
  });

  // ── files ──────────────────────────────────────────────────────────────────
  q('[data-add]').addEventListener('click', () => fileInput.click());
  q('[data-replace]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) await addFile(active, file);
  });

  async function addFile(loc: string, file: File) {
    setError();
    const sp = spotById.get(loc);
    if (!sp) return;
    const ext = extOf(file.name);
    if (!TYPES[ext]) { setError(`${file.name} isn't a file type we can use. Please upload PNG, JPG, WEBP, SVG, PDF, AI or PSD.`); return; }
    if (file.size > MAX_ARTWORK_BYTES) { setError(`${file.name} is ${MB(file.size)}. Please keep each file under 10 MB.`); return; }
    if (file.size === 0) { setError(`${file.name} is empty. Please choose another file.`); return; }
    const total = totalBytes(loc) + file.size;
    if (total > MAX_TOTAL_BYTES) { setError(`That would make ${MB(total)} of artwork. Please keep all files under 25 MB in total (try a smaller PNG or a PDF).`); return; }
    if (!arts.has(loc) && arts.size >= MAX_PLACEMENTS) { setError(`You can place up to ${MAX_PLACEMENTS} artworks.`); return; }

    const prev = arts.get(loc);
    const a: Art = {
      loc, file, ext, kind: 'file', aspect: 1, x: 0, y: 0, w: 1,
      decoration: prev?.decoration ?? cfg.decorations[0], notes: prev?.notes ?? '',
    };
    if (DRAWABLE.has(ext)) {
      const url = URL.createObjectURL(file);
      try {
        const img = await loadImage(url, false);
        const w = img.naturalWidth || 1, h = img.naturalHeight || 1;
        Object.assign(a, { kind: 'image', url, img, aspect: clamp(h / w, 0.05, 20) });
      } catch {
        URL.revokeObjectURL(url); // unreadable image: keep it as a file placeholder
      }
    }
    if (prev?.url) URL.revokeObjectURL(prev.url);
    fit(a);
    arts.set(loc, a);
    active = loc;
    side = sp.side;
    render();
    announce(`Added ${file.name} to ${sp.label}. ${sizeText(a)}.`);
  }

  function remove(loc: string) {
    const a = arts.get(loc);
    if (!a) return;
    if (a.url) URL.revokeObjectURL(a.url);
    arts.delete(loc);
    if (side === 'back' && !hasBack()) { side = 'front'; active = spots.find((s) => s.side === 'front')?.id ?? active; }
    render();
    announce(`Removed the ${spotById.get(loc)!.label.toLowerCase()} artwork.`);
  }

  q('[data-remove]').addEventListener('click', () => { remove(active); q<HTMLButtonElement>('[data-add]').focus(); });
  q('[data-center]').addEventListener('click', () => {
    const a = arts.get(active);
    if (!a) return;
    a.x = (1 - a.w) / 2;
    render();
    announce(`Centered. ${describe(a)}`);
  });
  q('[data-reset]').addEventListener('click', () => {
    const a = arts.get(active);
    if (!a) return;
    fit(a);
    render();
    announce(`Reset. ${describe(a)}`);
  });
  panel.decoration.addEventListener('change', () => {
    const a = arts.get(active);
    if (a) { a.decoration = panel.decoration.value; renderSummary(); opts.onChange(); }
  });
  panel.notes.addEventListener('input', () => {
    const a = arts.get(active);
    if (a) a.notes = panel.notes.value.slice(0, 300);
  });

  // ── summary in the quote panel ─────────────────────────────────────────────
  function renderSummary() {
    const box = opts.summary;
    if (!box) return;
    const list = ordered();
    box.hidden = !list.length;
    const ul = box.querySelector('[data-list]')!;
    ul.replaceChildren();
    for (const a of list) {
      const sp = spotById.get(a.loc)!;
      const li = document.createElement('li');
      li.className = 'flex items-center gap-3 py-2.5';
      const thumb = document.createElement('span');
      thumb.className = 'w-12 h-12 shrink-0 rounded-lg border border-zinc-200/80 dark:border-white/10 bg-zinc-50 dark:bg-white/[0.04] grid place-items-center overflow-hidden text-[11px] font-bold text-violet-700 dark:text-violet-300';
      if (a.kind === 'image' && a.url) {
        const img = document.createElement('img');
        img.src = a.url; img.alt = ''; img.className = 'max-w-full max-h-full object-contain';
        thumb.append(img);
      } else thumb.textContent = a.ext.toUpperCase();
      const text = document.createElement('span');
      text.className = 'min-w-0 flex-1 leading-snug';
      const t1 = document.createElement('span');
      t1.className = 'block text-[13.5px] font-semibold text-zinc-900 dark:text-white';
      t1.textContent = `${sp.label} · ${a.decoration}`;
      const t2 = document.createElement('span');
      t2.className = 'block text-[12.5px] muted truncate';
      t2.textContent = `${sizeText(a)} · ${a.file.name}`;
      text.append(t1, t2);
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'icon-btn w-10 h-10 shrink-0';
      edit.innerHTML = ICON.pencil;
      edit.setAttribute('aria-label', `Edit ${sp.label.toLowerCase()} artwork`);
      edit.addEventListener('click', () => { select(a.loc, { scroll: true }); a.el?.focus({ preventScroll: true }); });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'icon-btn w-10 h-10 shrink-0 hover:!text-red-600';
      del.innerHTML = ICON.trash;
      del.setAttribute('aria-label', `Remove ${sp.label.toLowerCase()} artwork`);
      del.addEventListener('click', () => { remove(a.loc); (box.querySelector('[data-list] button') as HTMLElement | null ?? q('[data-add]')).focus({ preventScroll: true }); });
      li.append(thumb, text, edit, del);
      ul.append(li);
    }
    const bytes = box.querySelector('[data-bytes]');
    if (bytes) bytes.textContent = `${list.length} file${list.length === 1 ? '' : 's'} · ${MB(totalBytes())} of 25 MB`;
  }

  // ── mockups ────────────────────────────────────────────────────────────────
  async function renderMockup(s: Side, maxWidth: number): Promise<Blob | null> {
    try {
      const url = photoFor(s);
      const photo = await loadImage(url, true);
      if (!aspects.has(url)) aspects.set(url, photo.naturalWidth / photo.naturalHeight);
      if (!boxes.has(url)) boxes.set(url, findBox(photo));
      const W = Math.min(maxWidth, photo.naturalWidth || maxWidth);
      const H = Math.round((W * (photo.naturalHeight || 1250)) / (photo.naturalWidth || 1000));
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(photo, 0, 0, W, H);
      for (const sp of spots) {
        const a = arts.get(sp.id);
        if (!a || sp.side !== s) continue;
        const r = areaRect(sp, url);
        const x = (r.x + a.x * r.w) * W, y = (r.y + a.y * r.h) * H;
        const w = a.w * r.w * W, h = artH(a) * r.h * H;
        if (a.kind === 'image' && a.img) {
          ctx.drawImage(a.img, x, y, w, h);
        } else {
          ctx.save();
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = '#7c3aed';
          ctx.lineWidth = Math.max(1.5, W / 500);
          ctx.setLineDash([W / 120, W / 200]);
          ctx.strokeRect(x, y, w, h);
          ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
          ctx.fillStyle = '#4c1d95';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const big = clamp(w / 5, 8, 36);
          ctx.font = `700 ${big}px system-ui, sans-serif`;
          ctx.fillText(a.ext.toUpperCase(), x + w / 2, y + h / 2 - big * 0.35);
          const small = clamp(w / 12, 7, 18);
          ctx.font = `600 ${small}px system-ui, sans-serif`;
          let name = a.file.name;
          while (name.length > 4 && ctx.measureText(name).width > w - 8) name = `${name.slice(0, -2)}`;
          if (name !== a.file.name) name = `${name.slice(0, -1)}…`;
          ctx.fillText(name, x + w / 2, y + h / 2 + big * 0.55);
          ctx.restore();
        }
      }
      return await new Promise<Blob | null>((res) => cv.toBlob(res, 'image/png'));
    } catch {
      return null; // tainted canvas or a photo that failed to load: send without this mockup
    }
  }

  async function mockups(budget: number) {
    const sides = (['front', 'back'] as Side[]).filter((s) => spots.some((sp) => sp.side === s && arts.has(sp.id)));
    for (const w of [1200, 900, 640]) {
      const out: { side: Side; blob: Blob }[] = [];
      for (const s of sides) { const blob = await renderMockup(s, w); if (blob) out.push({ side: s, blob }); }
      if (out.reduce((n, m) => n + m.blob.size, 0) <= budget) return out;
    }
    return [];
  }

  // ── contact step + submit ──────────────────────────────────────────────────
  const sheet = opts.sheet;
  const form = sheet?.querySelector<HTMLFormElement>('[data-dr-form]');
  const msg = sheet?.querySelector<HTMLElement>('[data-dr-msg]');
  const send = sheet?.querySelector<HTMLButtonElement>('[data-dr-send]');
  const done = sheet?.querySelector<HTMLElement>('[data-dr-done]');
  const actions = sheet?.querySelector<HTMLElement>('[data-dr-actions]');
  let sending = false;
  if (sheet) wireSheet(sheet);

  const showMsg = (text: string, tone: 'error' | 'info', call = false) => {
    if (!msg) return;
    msg.className = `rounded-xl px-4 py-3 text-sm font-medium ${tone === 'error' ? 'bg-red-500/10 text-red-700 dark:text-red-300' : 'bg-violet-500/10 text-violet-700 dark:text-violet-300'}`;
    msg.textContent = text;
    const tpl = sheet!.querySelector<HTMLTemplateElement>('[data-dr-call]');
    if (call && tpl) { const p = document.createElement('p'); p.append(tpl.content.cloneNode(true)); msg.append(p); }
    msg.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const setFieldErrors = (fields: Record<string, string> = {}) => {
    form?.querySelectorAll<HTMLElement>('.err[data-for]').forEach((el) => {
      const text = fields[el.dataset.for!] || '';
      el.textContent = text;
      const input = form.elements.namedItem(el.dataset.for!) as HTMLInputElement | null;
      input?.setAttribute('aria-invalid', String(!!text));
    });
  };

  function details(o: Order, list: Art[]) {
    const sizes = o.sizes.map((s) => `${s.size} ${s.n}`).join(', ');
    return [
      `Product: ${o.name}${o.style ? ` (style ${o.style})` : ''}${o.brand ? `, ${o.brand}` : ''}`,
      o.color && `Color: ${o.color}`,
      `Sizes: ${sizes} (${o.total} pieces)`,
      '',
      'Artwork placed in the design preview:',
      ...list.map((a, i) => `${i + 1}. ${spotById.get(a.loc)!.label} · ${a.decoration} · ${a.file.name} · ${sizeText(a)}${a.notes ? ` · ${a.notes}` : ''}`),
      '',
      `Page: ${o.url}`,
    ].filter((l) => l !== false && l !== undefined).join('\n');
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!send || sending) return;
    setFieldErrors();
    msg!.className = 'hidden';
    const name = (form.elements.namedItem('name') as HTMLInputElement).value.trim();
    const email = (form.elements.namedItem('email') as HTMLInputElement).value.trim();
    const local: Record<string, string> = {};
    if (!name) local.name = 'Please tell us your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) local.email = 'Enter a valid email so we can send your quote.';
    if (Object.keys(local).length) {
      setFieldErrors(local);
      (form.elements.namedItem(Object.keys(local)[0]) as HTMLInputElement).focus();
      return;
    }
    const list = ordered();
    const o = opts.getOrder();
    const label = send.querySelector('span')!;
    // Not `disabled`: that would drop focus out of the dialog while sending.
    sending = true;
    send.setAttribute('aria-disabled', 'true');
    send.setAttribute('aria-busy', 'true');
    label.textContent = 'Preparing mockups…';
    try {
      const fd = new FormData(form);
      fd.set('garment', garmentFor(o.cat, o.sub, o.name));
      fd.set('quantity', String(o.total));
      for (const d of new Set(list.map((a) => a.decoration))) fd.append('decorations', d);
      fd.set('details', details(o, list));
      let bytes = 0;
      list.forEach((a, i) => {
        const typed = new File([a.file], a.file.name, { type: TYPES[a.ext] || '' });
        bytes += typed.size;
        fd.append(`artwork_${i + 1}`, typed, a.file.name);
      });
      fd.set('placements', JSON.stringify(list.map((a) => {
        const m = measure(a);
        const r1 = (n: number) => Math.round(n * 10) / 10;
        return {
          location: spotById.get(a.loc)!.label, decoration: a.decoration, file: a.file.name,
          widthIn: r1(m.widthIn), heightIn: r1(m.heightIn), fromTopIn: r1(m.fromTopIn), fromCenterIn: r1(m.fromCenterIn),
          notes: a.notes || undefined,
        };
      })));
      for (const m of await mockups(MAX_TOTAL_BYTES - bytes - 150_000)) fd.append(`mockup_${m.side}`, m.blob, `mockup-${m.side}.png`);

      label.textContent = 'Sending…';
      const res = await fetch('/api/quote', { method: 'POST', body: fd });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; ref?: string; error?: string; fields?: Record<string, string>; fallback?: boolean };
      if (res.ok && data.ok) {
        const refEl = done!.querySelector<HTMLElement>('[data-dr-ref]');
        if (refEl) { refEl.hidden = !data.ref; refEl.querySelector('span')!.textContent = data.ref ?? ''; }
        form.hidden = true;
        actions!.hidden = true;
        done!.hidden = false;
        done!.focus();
        return;
      }
      setFieldErrors(data.fields);
      const other = Object.entries(data.fields ?? {}).filter(([k]) => k !== 'name' && k !== 'email').map(([, v]) => v);
      const fallback = !!data.fallback || res.status >= 500;
      showMsg([data.error || 'Something went wrong. Please try again.', ...other].join(' '), 'error', fallback);
      const firstBad = Object.keys(data.fields ?? {}).find((k) => k === 'name' || k === 'email');
      if (firstBad) (form.elements.namedItem(firstBad) as HTMLInputElement).focus();
    } catch {
      showMsg(`We couldn't reach our server. Please try again, or call ${business.phoneDisplay}.`, 'error', true);
    } finally {
      sending = false;
      send.removeAttribute('aria-disabled');
      send.removeAttribute('aria-busy');
      label.textContent = 'Send request';
    }
  });

  function openRequest() {
    if (!sheet || !form) return;
    const o = opts.getOrder();
    const list = ordered();
    const summary = sheet.querySelector('[data-dr-summary]');
    if (summary) summary.textContent = `${o.name}${o.color ? ` · ${o.color}` : ''} · ${o.total} pieces · ${list.length} artwork${list.length === 1 ? '' : 's'}`;
    form.hidden = false;
    actions!.hidden = false;
    done!.hidden = true;
    msg!.className = 'hidden';
    openSheet(sheet, { focus: form.elements.namedItem('name') as HTMLInputElement });
  }

  // ── public API for the product page ────────────────────────────────────────
  return {
    count: () => arts.size,
    decorations: () => [...new Set(ordered().map((a) => a.decoration))],
    locations: () => ordered().map((a) => spotById.get(a.loc)!.label),
    openRequest,
    setColor(c: { name: string; front: string; back: string }) {
      colorName = c.name;
      front = c.front || front;
      back = c.back || '';
      if (side === 'back' && !hasBack()) { side = 'front'; active = spots.find((s) => s.side === 'front')?.id ?? active; }
      render();
    },
    init(c: { name: string; front: string; back: string }) {
      colorName = c.name;
      front = c.front || front;
      back = c.back || '';
      render();
    },
  };
}
