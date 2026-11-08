// Edge entry point. Static pages come from the ASSETS binding; anything the build
// doesn't contain is checked against the legacy WordPress redirect map.
import redirects from './redirects.json';
import { parseQuote, parsePlacements, quoteEmail, requestNumber, MAX_ARTWORK_BYTES, MAX_TOTAL_BYTES, MAX_ITEMS, MAX_PLACEMENTS, ARTWORK_TYPES, type ItemAssets } from './lib/quote';
import { buildQuotePdf, type PdfMockup } from './lib/quote-pdf';
import { confirmationEmail } from './lib/quote-confirm';
import { business } from './data/business';
import { SS_ORIGIN, SS_PREFIX } from './lib/ss-img';

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
/** Quote requests one visitor can send per hour (each one emails the shop and lands in the admin). */
const REQUESTS_PER_HOUR = 10;

/**
 * Soft per-IP hourly limit (`bucket` names what is counted). Uses the colo-local Cache API:
 * best effort, and it fails open.
 */
async function allowPerHour(request: Request, origin: string, bucket: string, max: number): Promise<boolean> {
  const ip = request.headers.get('cf-connecting-ip');
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  if (!ip || !cache) return true;
  try {
    const key = new Request(`${origin}/__rate/${bucket}/${encodeURIComponent(ip)}`);
    const now = Date.now();
    let state = { count: 0, reset: now + 3600_000 };
    const hit = await cache.match(key);
    if (hit) {
      const saved = (await hit.json()) as typeof state;
      if (saved.reset > now) state = saved;
    }
    if (state.count >= max) return false;
    state.count += 1;
    await cache.put(key, new Response(JSON.stringify(state), {
      headers: { 'content-type': 'application/json', 'cache-control': `max-age=${Math.max(1, Math.ceil((state.reset - now) / 1000))}` },
    }));
    return true;
  } catch {
    return true;
  }
}

/** Customer confirmation emails, so the form can't be used to spam a third party's inbox. */
const allowConfirmation = (request: Request, origin: string) => allowPerHour(request, origin, 'quote-confirm', CONFIRMATIONS_PER_HOUR);

/** How long the form waits for the admin to file a request before using its own number. */
const INTAKE_WAIT_MS = 10_000;

/**
 * File a quote request in the studio admin and return the order number it got there
 * ("TBSP-1071"), or null when the intake isn't set up, fails or is slow. `requestRef` makes
 * a retry land on the same order. Never throws: the emails go out either way.
 */
async function fileInStudio(env: Env, requestRef: string, body: Record<string, unknown>): Promise<string | null> {
  if (!env.STUDIO_INTAKE_URL || !env.STUDIO_INTAKE_SECRET) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), INTAKE_WAIT_MS);
  try {
    const r = await fetch(env.STUDIO_INTAKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.STUDIO_INTAKE_SECRET}` },
      body: JSON.stringify({ ref: requestRef, ...body }),
      signal: ctl.signal,
    });
    if (!r.ok) {
      console.error('studio intake failed', requestRef, r.status, (await r.text().catch(() => '')).slice(0, 300));
      return null;
    }
    const d = (await r.json().catch(() => ({}))) as { orderNumber?: unknown };
    return typeof d.orderNumber === 'string' && /^[A-Z]{1,8}-\d+$/.test(d.orderNumber) ? d.orderNumber : null;
  } catch (e) {
    console.error('studio intake failed', requestRef, e);
    return null;
  } finally {
    clearTimeout(timer);
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
  if (!(await allowPerHour(request, new URL(request.url).origin, 'quote', REQUESTS_PER_HOUR))) {
    return json({ error: `You've sent a lot of requests in the last hour. Please call ${business.phoneDisplay} or email ${business.email} and we'll help right away.` }, 429);
  }
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
  // One number per job: the request is filed in the admin first, and the order number it
  // gets there (TBSP-1071) is the number the customer, both emails and the PDF show. Our
  // own request number is the retry key and the fallback when the admin doesn't answer in
  // time (the admin keeps it on the job, so its search still finds it).
  const requestRef = requestNumber();
  const ref = (await fileInStudio(env, requestRef, {
    quote: q, artwork: artworkNames, placements, ...(product ? { product } : {}),
    mockupFiles: intakeMockups,
    // The files themselves, so the admin can make mockups without opening the email.
    artworkFiles: intakeArt.map(({ file, itemIndex, ...a }) => {
      const list = itemIndex !== undefined ? items[itemIndex]?.placements ?? [] : placements;
      const placement = list.find((pl) => pl.file === file)?.location;
      return { ...a, ...(itemIndex !== undefined ? { itemIndex } : {}), ...(placement ? { placement } : {}) };
    }),
  })) || requestRef;
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

/** How long a product photo is kept at the edge and in browsers. */
const SS_IMG_TTL = 30 * 24 * 3600;
const SS_IMG_PATH = /^Images\/[\w\-./%]+\.(?:jpe?g|png|webp|gif)$/i;

/** Shown when S&S can't serve a photo: a soft grey tile with a shirt outline, never a broken-image icon. */
const SS_PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><rect width="400" height="500" fill="#f3f3f3"/><path d="M150 110l-70 35-35 75 50 25 20-35v190h170V210l20 35 50-25-35-75-70-35c-5 25-27 40-50 40s-45-15-50-40z" fill="none" stroke="#d4d4d8" stroke-width="8" stroke-linejoin="round"/></svg>`;

/**
 * /ss-img/<path>: an S&S product photo (cdn.ssactivewear.com/<path>) through this site.
 * Kept in the edge cache for 30 days, so photos keep showing even while S&S is slow or down.
 */
async function handleSsImage(url: URL, ctx?: Ctx): Promise<Response> {
  const path = url.pathname.slice(SS_PREFIX.length);
  if (!SS_IMG_PATH.test(path) || path.includes('..')) return new Response('Not found', { status: 404 });
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const key = new Request(`${url.origin}${url.pathname}`);
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) return hit;

  let upstream: Response | null = null;
  try {
    upstream = await fetch(`${SS_ORIGIN}${path}`, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; TBSP-site/1.0; +https://thebestscreenprinting.com)', accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
      cf: { cacheEverything: true, cacheTtl: SS_IMG_TTL },
    } as RequestInit);
  } catch { upstream = null; }

  const type = upstream?.headers.get('content-type') || '';
  if (upstream?.ok && type.startsWith('image/')) {
    const res = new Response(upstream.body, {
      headers: {
        'content-type': type,
        'cache-control': `public, max-age=${SS_IMG_TTL}, immutable`,
        'access-control-allow-origin': '*',
      },
    });
    if (cache) {
      const put = cache.put(key, res.clone()).catch(() => {});
      if (ctx) ctx.waitUntil(put); else await put;
    }
    return res;
  }
  console.log(`ss-img: ${path} upstream ${upstream ? upstream.status : 'unreachable'} ${type}`);
  return new Response(SS_PLACEHOLDER, {
    headers: {
      'content-type': 'image/svg+xml',
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*',
      'x-ss-upstream': upstream ? String(upstream.status) : 'unreachable',
    },
  });
}

const REWRITE_TYPES = /^(?:text\/html|text\/javascript|application\/javascript|application\/json)/;

/** Points S&S photo URLs in a served page, script or JSON file at /ss-img/ on this site. */
async function rewriteSsUrls(res: Response, origin: string): Promise<Response> {
  if (res.status !== 200 || !REWRITE_TYPES.test(res.headers.get('content-type') || '')) return res;
  const text = await res.text();
  if (!text.includes(SS_ORIGIN)) return new Response(text, res);
  const out = new Response(text.replaceAll(SS_ORIGIN, `${origin}${SS_PREFIX}`), res);
  out.headers.delete('content-length');
  out.headers.delete('etag');
  return out;
}

/** Sent with every page: no type guessing, no framing by other sites, HTTPS only, and only our origin as referrer. */
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "frame-ancestors 'self'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000',
  // Max's voice call asks for the microphone inside the studio frame, so that stays allowed for it.
  'Permissions-Policy': 'camera=(), geolocation=(), payment=()',
};

function withHeaders(res: Response, env: Env): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v);
  if (env.STAGING === '1') out.headers.set('X-Robots-Tag', 'noindex, nofollow');
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

    if (url.pathname.startsWith(SS_PREFIX)) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
      return withHeaders(await handleSsImage(url, ctx), env);
    }

    if (url.pathname === '/api/quote') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
      return withHeaders(await handleQuote(request, env, ctx), env);
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

    return withHeaders(await rewriteSsUrls(await env.ASSETS.fetch(request), url.origin), env);
  },
};
