// Quote requests: shared between the form page and the Worker that emails them.

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
export const ARTWORK_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/pdf', 'application/postscript', 'image/vnd.adobe.photoshop'];

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

export function quoteEmail(q: QuoteRequest, shopMinimum: number, artworkName?: string) {
  const route = q.quantity >= shopMinimum ? `Shop order (${shopMinimum}+)` : `Small run (under ${shopMinimum})`;
  const source = LEAD_SOURCES.find((l) => l.id === q.leadSource)?.label ?? 'Not given';
  const rows: [string, string][] = [
    ['Name', q.name], ['Email', q.email], ['Phone', q.phone ?? '—'], ['Company', q.company ?? '—'],
    ['What', q.garment], ['Quantity', `${q.quantity} (${route})`], ['Decoration', q.decorations.join(', ') || '—'],
    ['Turnaround', q.turnaround], ['Needed by', q.deadline ?? '—'], ['Artwork', artworkName ?? 'None attached'], ['Found us via', source],
  ];
  const subject = `${q.turnaround === 'Normal' ? '' : `[${q.turnaround.toUpperCase()}] `}Quote request: ${q.quantity} × ${q.garment} — ${q.name}`;
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + (q.details ? `\n\nDetails:\n${q.details}` : '');
  const html = `<h2 style="font-family:sans-serif">New quote request</h2><table style="font-family:sans-serif;border-collapse:collapse">${
    rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#71717a">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`).join('')
  }</table>${q.details ? `<p style="font-family:sans-serif;white-space:pre-wrap">${esc(q.details)}</p>` : ''}`;
  return { subject, text, html };
}
