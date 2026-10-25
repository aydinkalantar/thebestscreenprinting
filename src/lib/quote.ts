// Quote requests: shared between the form page and the Worker that emails them.
import { business } from '../data/business';

export const LEAD_SOURCES = [
  { id: 'google', label: 'Google search' },
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'copilot', label: 'Copilot / Bing' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'other-ai', label: 'Another AI assistant' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'social', label: 'Other social media' },
  { id: 'yelp-maps', label: 'Yelp or Maps' },
  { id: 'referral', label: 'Friend or referral' },
  { id: 'returning', label: "I've ordered before" },
  { id: 'other', label: 'Something else' },
] as const;

export const DECORATIONS = [
  'Screen printing', 'Embroidery', 'DTF transfer', 'DTG printing', 'Heat transfer', 'Embossing',
  'Sublimation', 'All-over print', 'Custom cut & sew', 'Not sure yet',
] as const;

export const GARMENTS = [
  'T-shirts', 'Hoodies / sweatshirts', 'Hats', 'Polos', 'Jackets', 'Bags / totes', 'Team uniforms', 'Something else',
] as const;

/** Best GARMENTS option for a catalog product, from its category, subcategory and name. */
export function garmentFor(category = '', subcategory = '', name = ''): (typeof GARMENTS)[number] {
  const text = `${category} ${subcategory} ${name}`.toLowerCase();
  return /polo/.test(text) ? 'Polos'
    : /hats|cap\b|beanie|trucker|snapback/.test(text) ? 'Hats'
    : /outerwear|jacket|windbreaker/.test(text) ? 'Jackets'
    : /accessories|tote|bag/.test(text) ? 'Bags / totes'
    : /sweatshirt|hoodie|crewneck|fleece/.test(text) ? 'Hoodies / sweatshirts'
    : /t-shirt|tee|tank|crop|long-sleeve|long sleeve/.test(text) ? 'T-shirts'
    : 'Something else';
}

export const TURNAROUND_LABELS: Record<string, string> = { normal: 'Normal', rush: 'Rush', 'super-rush': 'Super Rush' };

export const MAX_ARTWORK_BYTES = 10 * 1024 * 1024;
/** All files in one request (artwork per location + mockups) stay under this so the email always delivers. */
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
export const MAX_PLACEMENTS = 8;
export const ARTWORK_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/pdf', 'application/postscript', 'image/vnd.adobe.photoshop'];

/** One artwork placed by the customer in the product page's design preview. */
export interface Placement {
  location: string; decoration: string; file?: string;
  /** Approximate print size and position in inches, measured from the print area's top center. */
  widthIn?: number; heightIn?: number; fromTopIn?: number; fromCenterIn?: number;
  notes?: string;
}

/** Reads the JSON the design preview sends as `placements`. Unknown fields are dropped. */
export function parsePlacements(raw: FormDataEntryValue | null): Placement[] {
  if (typeof raw !== 'string' || !raw) return [];
  let list: unknown;
  try { list = JSON.parse(raw.slice(0, 20_000)); } catch { return []; }
  if (!Array.isArray(list)) return [];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : undefined);
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return list.slice(0, MAX_PLACEMENTS).map((p: any) => ({
    location: str(p?.location, 40) || 'Front', decoration: str(p?.decoration, 40) || 'Not sure',
    file: str(p?.file, 120) || undefined, widthIn: num(p?.widthIn), heightIn: num(p?.heightIn),
    fromTopIn: num(p?.fromTopIn), fromCenterIn: num(p?.fromCenterIn), notes: str(p?.notes, 300) || undefined,
  }));
}

/** One product in a multi-product quote (the quote cart). */
export interface QuoteItem {
  productName: string; style?: string; brand?: string; color?: string;
  /** Pieces per size, in the order the customer entered them. */
  sizes: Record<string, number>;
  quantity: number; decorations: string[]; locations: string[]; placements: Placement[];
  url?: string;
}

export interface QuoteRequest {
  name: string; email: string; phone?: string; company?: string;
  garment: string; quantity: number; decorations: string[]; deadline?: string;
  details?: string; leadSource?: string; turnaround: string;
  /** Set when the request came from the quote cart: one entry per product. */
  items?: QuoteItem[];
}

/** Most products in one quote request. */
export const MAX_ITEMS = 10;
export const MULTIPLE_PRODUCTS = 'Multiple products';

/** Short label for an item, e.g. `Gildan 5000 Heavy Cotton Tee`. */
export const itemTitle = (it: QuoteItem) => it.productName;
/** `S 4, M 10, L 6`. */
export const sizesText = (sizes: Record<string, number>) => Object.entries(sizes).map(([k, n]) => `${k} ${n}`).join(', ');

/**
 * Reads the quote cart's `items` JSON. Each item must reach the shop minimum on its own
 * ("12-piece minimum per product"). Unknown fields are dropped.
 */
export function parseItems(raw: FormDataEntryValue | null): { items: QuoteItem[] } | { error: string } | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let list: unknown;
  try { list = JSON.parse(raw.slice(0, 200_000)); } catch { return { error: 'Could not read the products in your quote.' }; }
  if (!Array.isArray(list) || !list.length) return { error: 'Your quote has no products.' };
  if (list.length > MAX_ITEMS) return { error: `Please send up to ${MAX_ITEMS} products per request.` };
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');
  const items: QuoteItem[] = [];
  for (const [i, it] of (list as any[]).entries()) {
    const productName = str(it?.productName, 200);
    if (!productName) return { error: `Product ${i + 1} is missing its name.` };
    const sizes: Record<string, number> = {};
    if (it?.sizes && typeof it.sizes === 'object' && !Array.isArray(it.sizes)) {
      for (const [k, v] of Object.entries(it.sizes).slice(0, 30)) {
        const key = str(k, 16), n = Math.floor(Number(v));
        if (key && Number.isFinite(n) && n > 0 && n <= 100000) sizes[key] = n;
      }
    }
    const sizeSum = Object.values(sizes).reduce((a, b) => a + b, 0);
    const quantity = sizeSum || Math.floor(Number(it?.quantity) || 0);
    if (!Number.isFinite(quantity) || quantity < business.shopMinimum) {
      return { error: `${productName} needs at least ${business.shopMinimum} pieces (${business.shopMinimum}-piece minimum per product).` };
    }
    if (quantity > 100000) return { error: `${productName}: please call us for orders this large.` };
    const strList = (v: unknown, max: number) => (Array.isArray(v) ? [...new Set(v.map((x) => str(x, 40)).filter(Boolean))].slice(0, max) : []);
    items.push({
      productName, style: str(it?.style, 40) || undefined, brand: str(it?.brand, 60) || undefined, color: str(it?.color, 60) || undefined,
      sizes, quantity, decorations: strList(it?.decorations, 10), locations: strList(it?.locations, MAX_PLACEMENTS),
      placements: Array.isArray(it?.placements) ? parsePlacements(JSON.stringify(it.placements)) : [],
      url: /^https:\/\/[\w.-]+\/catalog\/[\w-]+\/$/.test(str(it?.url, 300)) ? str(it?.url, 300) : undefined,
    });
  }
  return { items };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const s = (v: FormDataEntryValue | null, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Validates the posted form. Returns field errors, or the clean request. */
export function parseQuote(form: FormData): { errors: Record<string, string> } | { quote: QuoteRequest } {
  const errors: Record<string, string> = {};
  const name = s(form.get('name'), 120);
  const email = s(form.get('email'), 200).toLowerCase();
  const cart = parseItems(form.get('items'));
  if (cart && 'error' in cart) errors.items = cart.error;
  const items = cart && 'items' in cart ? cart.items : undefined;
  // Cart requests: the order is the sum of its products; each product was checked above.
  const garment = items ? (items.length > 1 ? MULTIPLE_PRODUCTS : s(form.get('garment'), 60) || items[0].productName.slice(0, 60)) : s(form.get('garment'), 60);
  const quantity = items ? items.reduce((n, it) => n + it.quantity, 0) : Number(s(form.get('quantity'), 7));
  const isDecoration = (d: string) => (DECORATIONS as readonly string[]).includes(d);
  const decorations = items
    ? [...new Set([...form.getAll('decorations').map((d) => s(d, 40)), ...items.flatMap((it) => [...it.decorations, ...it.placements.map((p) => p.decoration)])])].filter(isDecoration)
    : form.getAll('decorations').map((d) => s(d, 40)).filter(isDecoration);
  const deadline = s(form.get('deadline'), 10);
  const leadSource = s(form.get('leadSource'), 20);
  const turnaround = s(form.get('turnaround'), 20);
  if (!name) errors.name = 'Please tell us your name.';
  if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email so we can send your quote.';
  // Cart requests: product and quantity come from the items (checked in parseItems).
  if (!garment && !cart) errors.garment = 'Pick what you want printed.';
  if (cart) { /* per-item checks done in parseItems */ }
  else if (!Number.isFinite(quantity) || quantity < 1 || quantity > 100000) errors.quantity = 'How many pieces do you need?';
  else if (quantity < business.shopMinimum) errors.quantity = `Orders start at ${business.shopMinimum} pieces.`;
  if (Object.keys(errors).length) return { errors };
  return {
    quote: {
      name, email, garment, quantity: Math.round(quantity), decorations,
      phone: s(form.get('phone'), 40) || undefined,
      company: s(form.get('company'), 120) || undefined,
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : undefined,
      details: s(form.get('details'), 4000) || undefined,
      leadSource: LEAD_SOURCES.some((l) => l.id === leadSource) ? leadSource : undefined,
      turnaround: TURNAROUND_LABELS[turnaround] ?? 'Normal',
      ...(items ? { items } : {}),
    },
  };
}

export const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Approximate print size of a placement, e.g. `~10" × 12"`. */
export const placementSize = (p: Placement) => (p.widthIn && p.heightIn ? `~${p.widthIn}" × ${p.heightIn}"` : '—');
/** Where a placement sits, measured from the print area's top center. */
export const placementPosition = (p: Placement) => (p.fromTopIn != null ? `${p.fromTopIn}" below top of print area${p.fromCenterIn ? `, ${Math.abs(p.fromCenterIn)}" ${p.fromCenterIn < 0 ? 'left' : 'right'} of center` : ', centered'}` : '—');
/** Mockup side a placement shows on: back locations on the back, everything else (sleeves, hat sides, legs) on the front. */
export const placementSide = (p: Placement) => (/^back/i.test(p.location) ? 'back' : 'front');

/** Per-request reference shown to the shop and the customer, e.g. `TBSP-MH4K2Z1Q-X7F`. */
export function requestNumber(now = Date.now()): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rnd = new Uint8Array(3);
  crypto.getRandomValues(rnd);
  return `TBSP-${now.toString(36).toUpperCase()}-${Array.from(rnd, (b) => abc[b % abc.length]).join('')}`;
}

/** The business turnaround tier (time, fee) for a request's turnaround label. */
export const turnaroundTier = (label: string) => business.turnaround.find((t) => t.name === label) ?? business.turnaround[0];

/** Files the Worker received for one cart item (attachment names as sent, inline mockup ids). */
export interface ItemAssets { artworkNames: string[]; mockups: { cid: string; label: string }[] }

const CELL = 'padding:6px 10px;border:1px solid #e4e4e7;text-align:left;vertical-align:top';
function placementTable(placements: Placement[]) {
  return `<table style="font-family:sans-serif;border-collapse:collapse;font-size:14px"><tr>${['#', 'Location', 'Decoration', 'File', 'Size', 'Position', 'Notes'].map((h) => `<th style="${CELL};background:#f4f4f5">${h}</th>`).join('')}</tr>${
    placements.map((p, i) => `<tr>${[String(i + 1), p.location, p.decoration, p.file ?? '—', placementSize(p), placementPosition(p), p.notes ?? ''].map((v) => `<td style="${CELL}">${esc(v)}</td>`).join('')}</tr>`).join('')
  }</table>`;
}
const mockupImgs = (mockups: { cid: string; label: string }[]) =>
  mockups.map((m) => `<p style="font-family:sans-serif;margin:16px 0 4px"><b>${esc(m.label)}</b></p><img src="cid:${m.cid}" alt="${esc(m.label)}" width="360" style="border:1px solid #e4e4e7;border-radius:8px">`).join('');
const placementLines = (placements: Placement[]) =>
  placements.map((p, i) => `${i + 1}. ${p.location} · ${p.decoration} · ${p.file ?? 'no file'} · ${placementSize(p)} · ${placementPosition(p)}${p.notes ? ` · ${p.notes}` : ''}`).join('\n');

export function quoteEmail(q: QuoteRequest, artworkNames: string[] = [], placements: Placement[] = [], mockups: { cid: string; label: string }[] = [], ref?: string, itemAssets: ItemAssets[] = []) {
  const source = LEAD_SOURCES.find((l) => l.id === q.leadSource)?.label ?? 'Not given';
  const items = q.items ?? [];
  const rows: [string, string][] = [
    ...(ref ? [['Request', ref] as [string, string]] : []),
    ['Name', q.name], ['Email', q.email], ['Phone', q.phone ?? '—'], ['Company', q.company ?? '—'],
    ['What', items.length ? `${q.garment} (${items.length} product${items.length === 1 ? '' : 's'})` : q.garment],
    ['Quantity', String(q.quantity)], ['Decoration', q.decorations.join(', ') || '—'],
    ['Turnaround', q.turnaround], ['Needed by', q.deadline ?? '—'],
    ['Artwork', artworkNames.length ? artworkNames.join(', ') : 'None attached'], ['Found us via', source],
  ];
  const subject = `${ref ? `${ref} · ` : ''}${q.turnaround === 'Normal' ? '' : `[${q.turnaround.toUpperCase()}] `}Quote request: ${q.quantity} × ${q.garment} — ${q.name}`;
  const placementText = placements.length ? `\n\nArtwork placement (approximate, confirm on the proof):\n${placementLines(placements)}` : '';

  // Cart requests: one section per product.
  const itemText = items.map((it, i) => {
    const a = itemAssets[i];
    return [
      `\n\n── Product ${i + 1} of ${items.length}: ${it.productName}`,
      [it.brand, it.style && `style ${it.style}`].filter(Boolean).join(' · '),
      it.color && `Color: ${it.color}`,
      `Sizes: ${sizesText(it.sizes) || '—'} (${it.quantity} pieces)`,
      `Decoration: ${[...new Set([...it.decorations, ...it.placements.map((p) => p.decoration)])].join(', ') || '—'}`,
      it.locations.length ? `Print locations: ${it.locations.join(', ')}` : '',
      a?.artworkNames.length ? `Artwork files: ${a.artworkNames.join(', ')}` : '',
      it.placements.length ? `Placement (approximate):\n${placementLines(it.placements)}` : '',
      it.url ? `Page: ${it.url}` : '',
    ].filter(Boolean).join('\n');
  }).join('');
  const itemHtml = items.map((it, i) => {
    const a = itemAssets[i];
    const meta: [string, string][] = [
      ['Brand / style', [it.brand, it.style].filter(Boolean).join(' · ') || '—'],
      ['Color', it.color || '—'],
      ['Sizes', sizesText(it.sizes) || '—'],
      ['Quantity', `${it.quantity} pieces`],
      ['Decoration', [...new Set([...it.decorations, ...it.placements.map((p) => p.decoration)])].join(', ') || '—'],
      ['Locations', (it.locations.length ? it.locations : it.placements.map((p) => p.location)).join(', ') || '—'],
      ['Artwork', a?.artworkNames.length ? a.artworkNames.join(', ') : 'None attached'],
    ];
    return `<div style="margin-top:28px;padding-top:16px;border-top:2px solid #6d28d9"><h3 style="font-family:sans-serif;margin:0 0 8px">Product ${i + 1} of ${items.length}: ${esc(it.productName)}</h3>`
      + `<table style="font-family:sans-serif;border-collapse:collapse">${meta.map(([k, v]) => `<tr><td style="padding:3px 12px 3px 0;color:#71717a">${esc(k)}</td><td style="padding:3px 0"><b>${esc(v)}</b></td></tr>`).join('')}</table>`
      + (it.url ? `<p style="font-family:sans-serif;font-size:13px;margin:6px 0"><a href="${esc(it.url)}">${esc(it.url)}</a></p>` : '')
      + (it.placements.length ? `<p style="font-family:sans-serif;color:#71717a;margin:12px 0 6px">Artwork placement · approximate, confirm on the proof</p>${placementTable(it.placements)}` : '')
      + mockupImgs(a?.mockups ?? []) + '</div>';
  }).join('');

  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + (q.details ? `\n\nDetails:\n${q.details}` : '') + placementText + itemText;
  const placementHtml = placements.length
    ? `<h3 style="font-family:sans-serif;margin-top:24px">Artwork placement</h3><p style="font-family:sans-serif;color:#71717a;margin:4px 0 8px">Approximate, placed by the customer. Confirm on the proof.</p>${placementTable(placements)}`
    : '';
  const html = `<h2 style="font-family:sans-serif">New quote request${items.length > 1 ? ` · ${items.length} products` : ''}</h2><table style="font-family:sans-serif;border-collapse:collapse">${
    rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#71717a">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`).join('')
  }</table>${q.details ? `<p style="font-family:sans-serif;white-space:pre-wrap">${esc(q.details)}</p>` : ''}${placementHtml}${mockupImgs(mockups)}${itemHtml}`;
  return { subject, text, html };
}
