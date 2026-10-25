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

export interface QuoteRequest {
  name: string; email: string; phone?: string; company?: string;
  garment: string; quantity: number; decorations: string[]; deadline?: string;
  details?: string; leadSource?: string; turnaround: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const s = (v: FormDataEntryValue | null, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Validates the posted form. Returns field errors, or the clean request. */
export function parseQuote(form: FormData): { errors: Record<string, string> } | { quote: QuoteRequest } {
  const errors: Record<string, string> = {};
  const name = s(form.get('name'), 120);
  const email = s(form.get('email'), 200).toLowerCase();
  const garment = s(form.get('garment'), 60);
  const quantity = Number(s(form.get('quantity'), 7));
  const decorations = form.getAll('decorations').map((d) => s(d, 40)).filter((d) => (DECORATIONS as readonly string[]).includes(d));
  const deadline = s(form.get('deadline'), 10);
  const leadSource = s(form.get('leadSource'), 20);
  const turnaround = s(form.get('turnaround'), 20);
  if (!name) errors.name = 'Please tell us your name.';
  if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email so we can send your quote.';
  if (!garment) errors.garment = 'Pick what you want printed.';
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 100000) errors.quantity = 'How many pieces do you need?';
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
    },
  };
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function quoteEmail(q: QuoteRequest, artworkNames: string[] = [], placements: Placement[] = [], mockups: { cid: string; label: string }[] = []) {
  const source = LEAD_SOURCES.find((l) => l.id === q.leadSource)?.label ?? 'Not given';
  const rows: [string, string][] = [
    ['Name', q.name], ['Email', q.email], ['Phone', q.phone ?? '—'], ['Company', q.company ?? '—'],
    ['What', q.garment], ['Quantity', String(q.quantity)], ['Decoration', q.decorations.join(', ') || '—'],
    ['Turnaround', q.turnaround], ['Needed by', q.deadline ?? '—'], ['Artwork', artworkNames.length ? artworkNames.join(', ') : 'None attached'], ['Found us via', source],
  ];
  const subject = `${q.turnaround === 'Normal' ? '' : `[${q.turnaround.toUpperCase()}] `}Quote request: ${q.quantity} × ${q.garment} — ${q.name}`;
  const size = (p: Placement) => (p.widthIn && p.heightIn ? `~${p.widthIn}" × ${p.heightIn}"` : '—');
  const pos = (p: Placement) => (p.fromTopIn != null ? `${p.fromTopIn}" below top of print area${p.fromCenterIn ? `, ${Math.abs(p.fromCenterIn)}" ${p.fromCenterIn < 0 ? 'left' : 'right'} of center` : ', centered'}` : '—');
  const placementText = placements.length
    ? `\n\nArtwork placement (approximate, confirm on the proof):\n${placements.map((p, i) => `${i + 1}. ${p.location} · ${p.decoration} · ${p.file ?? 'no file'} · ${size(p)} · ${pos(p)}${p.notes ? ` · ${p.notes}` : ''}`).join('\n')}`
    : '';
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + (q.details ? `\n\nDetails:\n${q.details}` : '') + placementText;
  const cell = 'padding:6px 10px;border:1px solid #e4e4e7;text-align:left;vertical-align:top';
  const placementHtml = placements.length
    ? `<h3 style="font-family:sans-serif;margin-top:24px">Artwork placement</h3><p style="font-family:sans-serif;color:#71717a;margin:4px 0 8px">Approximate, placed by the customer. Confirm on the proof.</p><table style="font-family:sans-serif;border-collapse:collapse;font-size:14px"><tr>${['#', 'Location', 'Decoration', 'File', 'Size', 'Position', 'Notes'].map((h) => `<th style="${cell};background:#f4f4f5">${h}</th>`).join('')}</tr>${
        placements.map((p, i) => `<tr>${[String(i + 1), p.location, p.decoration, p.file ?? '—', size(p), pos(p), p.notes ?? ''].map((v) => `<td style="${cell}">${esc(v)}</td>`).join('')}</tr>`).join('')
      }</table>`
    : '';
  const mockupHtml = mockups.map((m) => `<p style="font-family:sans-serif;margin:16px 0 4px"><b>${esc(m.label)}</b></p><img src="cid:${m.cid}" alt="${esc(m.label)}" width="360" style="border:1px solid #e4e4e7;border-radius:8px">`).join('');
  const html = `<h2 style="font-family:sans-serif">New quote request</h2><table style="font-family:sans-serif;border-collapse:collapse">${
    rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#71717a">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`).join('')
  }</table>${q.details ? `<p style="font-family:sans-serif;white-space:pre-wrap">${esc(q.details)}</p>` : ''}${placementHtml}${mockupHtml}`;
  return { subject, text, html };
}
