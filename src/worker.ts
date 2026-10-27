// Edge entry point. Static pages come from the ASSETS binding; anything the build
// doesn't contain is checked against the legacy WordPress redirect map.
import redirects from './redirects.json';
import { parseQuote, parsePlacements, quoteEmail, requestNumber, MAX_ARTWORK_BYTES, MAX_TOTAL_BYTES, MAX_ITEMS, MAX_PLACEMENTS, ARTWORK_TYPES, type ItemAssets } from './lib/quote';
import { buildQuotePdf, type PdfMockup } from './lib/quote-pdf';
import { confirmationEmail } from './lib/quote-confirm';
import { business } from './data/business';

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  STAGING?: string;
  /** Resend API key (secret). Without it the form tells people to call or email instead. */
  RESEND_API_KEY?: string;
  /** Where quote requests are sent. */
  QUOTE_TO?: string;
  /** Sender address on a domain verified in Resend. */
  QUOTE_FROM?: string;
  /** Cloudflare Turnstile secret (secret). When set, the form must carry a valid token. */
  TURNSTILE_SECRET?: string;
  /** Studio admin intake for site quotes (https://design.thebestscreenprinting.com/api/intake/site-quote). */
  STUDIO_INTAKE_URL?: string;
  /** Shared secret for the intake (secret; the studio's SITE_INTAKE_SECRET). */
  STUDIO_INTAKE_SECRET?: string;
}

/** Minimal Workers execution context: work that may finish after the response. */
interface Ctx { waitUntil(p: Promise<unknown>): void }

/** The `product` field a product page sends with a single-product request (sizes as { size: count }). */
function parseProduct(raw: FormDataEntryValue | null) {
  if (typeof raw !== 'string' || raw.length > 4000) return null;
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined);
    const productName = str(p.productName, 200);
    if (!productName) return null;
    const sizes: Record<string, number> = {};
    if (p.sizes && typeof p.sizes === 'object') {
      for (const [k, v] of Object.entries(p.sizes as Record<string, unknown>).slice(0, 30)) {
        const n = Math.floor(Number(v));
        if (k.length <= 16 && n > 0 && n <= 100000) sizes[k] = n;
      }
    }
    const url = str(p.url, 300);
    return { productName, brand: str(p.brand, 60), style: str(p.style, 40), color: str(p.color, 60), ...(Object.keys(sizes).length ? { sizes } : {}), ...(url && url.startsWith('https://') ? { url } : {}) };
  } catch {
    return null;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const bytesToBase64 = (bytes: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

type Attachment = { filename: string; content: string; content_id?: string };

/** One email through Resend. Returns null on success, or the failure for the log. */
async function sendEmail(env: Env, mail: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.QUOTE_FROM || 'TBSP Quotes <quotes@thebestscreenprinting.com>', ...mail }),
    });
    return res.ok ? null : `${res.status} ${await res.text()}`;
  } catch (e) {
    return String(e);
  }
}

const CONFIRMATIONS_PER_HOUR = 5;

/**
 * Soft per-IP limit on customer confirmation emails, so the form can't be used to spam a third
 * party's inbox. Uses the colo-local Cache API: best effort, and it fails open.
 */
async function allowConfirmation(request: Request, origin: string): Promise<boolean> {
  const ip = request.headers.get('cf-connecting-ip');
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  if (!ip || !cache) return true;
  try {
    const key = new Request(`${origin}/__rate/quote-confirm/${encodeURIComponent(ip)}`);
    const now = Date.now();
    let state = { count: 0, reset: now + 3600_000 };
    const hit = await cache.match(key);
    if (hit) {
      const saved = (await hit.json()) as typeof state;
      if (saved.reset > now) state = saved;
    }
    if (state.count >= CONFIRMATIONS_PER_HOUR) return false;
    state.count += 1;
    await cache.put(key, new Response(JSON.stringify(state), {
      headers: { 'content-type': 'application/json', 'cache-control': `max-age=${Math.max(1, Math.ceil((state.reset - now) / 1000))}` },
    }));
    return true;
  } catch {
    return true;
  }
}

async function handleQuote(request: Request, env: Env, ctx?: Ctx): Promise<Response> {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_TOTAL_BYTES + 500_000) return json({ error: 'Your files are too large together. Please keep them under 25 MB in total.' }, 413);
  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: 'Could not read the form.' }, 400); }

  // Bots fill the hidden field; pretend success so they move on.
  const honeypotEmpty = !form.get('website');
  if (!honeypotEmpty) return json({ ok: true });
  let humanVerified = !env.TURNSTILE_SECRET;

  if (env.TURNSTILE_SECRET) {
    const token = form.get('cf-turnstile-response');
    const check = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: typeof token === 'string' ? token : '', remoteip: request.headers.get('cf-connecting-ip') || '' }),
    }).then((r) => r.json() as Promise<{ success: boolean }>).catch(() => ({ success: false }));
    if (!check.success) return json({ error: 'Please confirm you are not a robot and try again.' }, 400);
    humanVerified = true;
  }

  const parsed = parseQuote(form);
  if ('errors' in parsed) return json({ error: parsed.errors.items || 'Please check the highlighted fields.', fields: parsed.errors }, 400);
  const q = parsed.quote;

  // Artwork: the quote form's single `artwork` field, or one `artwork_<n>` per placed location
  // from the product page's design preview, plus its rendered `mockup_<side>` PNGs.
  // Quote cart requests send the same per product: `item<i>_artwork_<n>` and `item<i>_mockup_<side>`.
  const items = q.items ?? [];
  const toBase64 = async (f: File) => bytesToBase64(new Uint8Array(await f.arrayBuffer()));
  const artworkFiles: Attachment[] = [];
  /** The same artwork for the studio intake, with the product and original name it belongs to. */
  const intakeArt: { name: string; file: string; type: string; data: string; itemIndex?: number }[] = [];
  /** Rendered mockups (the customer's design on the product) for the studio intake. */
  const intakeMockups: { side: string; data: string; itemIndex?: number }[] = [];
  const mockupFiles: Attachment[] = [];
  const artworkNames: string[] = [];
  const mockups: { cid: string; label: string }[] = [];
  const pdfMockups: PdfMockup[] = [];
  const itemAssets: ItemAssets[] = items.map(() => ({ artworkNames: [], mockups: [] }));
  const itemPdfMockups: PdfMockup[][] = items.map(() => []);
  let total = 0;
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string' || value.size === 0) continue;
    const itemKey = /^item(\d{1,2})_(artwork_\d{1,2}|mockup_[a-z-]{1,20})$/.exec(key);
    const itemIndex = itemKey ? Number(itemKey[1]) - 1 : -1;
    if (itemKey && !itemAssets[itemIndex]) continue;
    const field = itemKey ? itemKey[2] : key;
    const isMockup = /^mockup_[a-z-]{1,20}$/.test(field);
    if (!isMockup && !itemKey && key !== 'artwork' && !/^artwork_\d{1,2}$/.test(key)) continue;
    if (value.size > MAX_ARTWORK_BYTES) return json({ error: `${value.name || 'A file'} is too large. Please keep each file under 10 MB.`, fields: { artwork: 'Max 10 MB per file' } }, 400);
    total += value.size;
    if (total > MAX_TOTAL_BYTES) return json({ error: 'Your files are too large together. Please keep them under 25 MB in total.', fields: { artwork: 'Max 25 MB in total' } }, 400);
    const prefix = itemKey ? `item${itemIndex + 1}-` : '';
    if (isMockup) {
      if (value.type !== 'image/png') continue;
      if (itemKey ? itemAssets[itemIndex].mockups.length >= 2 || mockupFiles.length >= MAX_ITEMS * 2 : mockups.length >= 4) continue;
      const side = field.slice(7);
      const label = `${itemKey ? `Product ${itemIndex + 1} · ` : ''}Mockup: ${side.replace(/-/g, ' ')}`;
      const png = new Uint8Array(await value.arrayBuffer());
      const cid = `${prefix}mockup-${side}`;
      (itemKey ? itemAssets[itemIndex].mockups : mockups).push({ cid, label });
      (itemKey ? itemPdfMockups[itemIndex] : pdfMockups).push({ side, label, png });
      const b64 = bytesToBase64(png);
      mockupFiles.push({ filename: `${cid}.png`, content: b64, content_id: cid });
      if (png.length <= 6 * 1024 * 1024) intakeMockups.push({ side, data: b64, ...(itemKey ? { itemIndex } : {}) });
      continue;
    }
    if (value.type && !ARTWORK_TYPES.includes(value.type)) return json({ error: 'Please upload PNG, JPG, SVG, PDF, AI or PSD artwork.', fields: { artwork: 'Unsupported file type' } }, 400);
    if (artworkNames.length >= (itemKey ? MAX_ITEMS * MAX_PLACEMENTS : 8)) continue;
    const base = value.name.slice(0, 120) || `artwork-${artworkNames.length + 1}`;
    const name = `${prefix}${base}`;
    artworkNames.push(name);
    if (itemKey) itemAssets[itemIndex].artworkNames.push(name);
    const data = await toBase64(value);
    artworkFiles.push({ filename: name, content: data });
    intakeArt.push({ name, file: base, type: value.type || 'application/octet-stream', data, ...(itemKey ? { itemIndex } : {}) });
  }
  const placements = items.length ? [] : parsePlacements(form.get('placements'));
  /** Single-product requests: which product, color and sizes (the cart sends this per item). */
  const product = items.length ? null : parseProduct(form.get('product'));

  if (!env.RESEND_API_KEY) {
    return json({ error: `Online quotes are not switched on yet. Please call ${business.phoneDisplay} or email ${business.email}.`, fallback: true }, 503);
  }
  const ref = requestNumber();
  const origin = new URL(request.url).origin;

  // Branded summary PDF for both emails. If it can't be built the emails still go out without it.
  let pdf: Attachment | null = null;
  try {
    const logoRes = await env.ASSETS.fetch(new Request(`${origin}/icon-512.png`)).catch(() => null);
    const logoPng = logoRes?.ok ? new Uint8Array(await logoRes.arrayBuffer()) : null;
    const bytes = await buildQuotePdf({
      ref, date: new Date(), quote: q, placements, artworkNames, mockups: pdfMockups, logoPng,
      items: items.map((item, i) => ({ item, artworkNames: itemAssets[i].artworkNames, mockups: itemPdfMockups[i] })),
    });
    pdf = { filename: `${ref}-design-request.pdf`, content: bytesToBase64(bytes) };
  } catch (e) {
    console.error('quote pdf failed', ref, e);
  }

  // 1. The shop: everything, including the customer's original artwork.
  const mail = quoteEmail(q, artworkNames, placements, mockups, ref, itemAssets);
  const shopAttachments = [...artworkFiles, ...mockupFiles, ...(pdf ? [pdf] : [])];
  const shopError = await sendEmail(env, {
    to: [env.QUOTE_TO || business.email],
    reply_to: q.email,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    attachments: shopAttachments.length ? shopAttachments : undefined,
  });
  if (shopError) {
    console.error('quote email failed', ref, shopError);
    return json({ error: `We could not send your request. Please call ${business.phoneDisplay} or email ${business.email}.`, fallback: true }, 502);
  }

  // The request also goes into the studio admin as an order. It runs after the response
  // and never changes what the customer sees; the email above stays the source of truth.
  if (env.STUDIO_INTAKE_URL && env.STUDIO_INTAKE_SECRET && ctx) {
    ctx.waitUntil(
      fetch(env.STUDIO_INTAKE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.STUDIO_INTAKE_SECRET}` },
        body: JSON.stringify({
          ref, quote: q, artwork: artworkNames, placements, ...(product ? { product } : {}),
          mockupFiles: intakeMockups,
          // The files themselves, so the admin can make mockups without opening the email.
          artworkFiles: intakeArt.map(({ file, itemIndex, ...a }) => {
            const list = itemIndex !== undefined ? items[itemIndex]?.placements ?? [] : placements;
            const placement = list.find((pl) => pl.file === file)?.location;
            return { ...a, ...(itemIndex !== undefined ? { itemIndex } : {}), ...(placement ? { placement } : {}) };
          }),
        }),
      })
        .then(async (r) => { if (!r.ok) console.error('studio intake failed', ref, r.status, (await r.text().catch(() => '')).slice(0, 300)); })
        .catch((e) => console.error('studio intake failed', ref, e)),
    );
  }

  // 2. The customer: a confirmation with the mockups and the PDF (never their own artwork back).
  // The shop already has the request, so a failure here is only logged.
  if (honeypotEmpty && humanVerified && (await allowConfirmation(request, origin))) {
    const confirm = confirmationEmail(q, ref, mockups, undefined, itemAssets);
    const customerAttachments = [...mockupFiles, ...(pdf ? [pdf] : [])];
    const customerError = await sendEmail(env, {
      to: [q.email],
      reply_to: business.email,
      subject: confirm.subject,
      text: confirm.text,
      html: confirm.html,
      attachments: customerAttachments.length ? customerAttachments : undefined,
    });
    if (customerError) console.error('quote confirmation failed', ref, customerError);
  } else {
    console.warn('quote confirmation skipped', ref);
  }
  return json({ ok: true, ref });
}

const moved = redirects.moved as Record<string, string>;
const gone = new Set<string>(redirects.gone);
const kept = new Set<string>(redirects.keep);

/** Old WordPress slugs without the `-ca` suffix already 301'd to the `-ca` version. */
function legacyCandidates(path: string): string[] {
  const p = path.endsWith('/') ? path : `${path}/`;
  const out = p === path ? [p] : [p, path]; // file-like paths (old sitemaps) are stored without the slash
  if (!p.endsWith('-ca/') && /^\/[a-z0-9-]+\/$/.test(p)) out.push(p.replace(/\/$/, '-ca/'));
  return out;
}

function resolveLegacy(path: string): { status: 301; to: string } | { status: 410 } | null {
  for (const p of legacyCandidates(path)) {
    if (moved[p]) return { status: 301, to: moved[p] };
    if (gone.has(p)) return { status: 410 };
    if (kept.has(p) && p !== path) return { status: 301, to: p };
  }
  return null;
}

function withHeaders(res: Response, env: Env): Response {
  if (env.STAGING !== '1') return res;
  const out = new Response(res.body, res);
  out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return out;
}

export default {
  async fetch(request: Request, env: Env, ctx?: Ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.hostname === 'www.thebestscreenprinting.com') {
      url.hostname = 'thebestscreenprinting.com';
      return Response.redirect(url.toString(), 301);
    }

    // Staging must never be indexed, whatever robots.txt in the build says.
    if (env.STAGING === '1' && url.pathname === '/robots.txt') {
      return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });
    }

    if (url.pathname === '/api/quote') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      return handleQuote(request, env, ctx);
    }

    const legacy = resolveLegacy(url.pathname);
    if (legacy?.status === 301) {
      const target = new URL(legacy.to, url.origin);
      if (!legacy.to.startsWith('http')) target.search = url.search;
      return Response.redirect(target.toString(), 301);
    }
    if (legacy?.status === 410) {
      return withHeaders(new Response('Gone', { status: 410, headers: { 'content-type': 'text/plain' } }), env);
    }

    return withHeaders(await env.ASSETS.fetch(request), env);
  },
};
