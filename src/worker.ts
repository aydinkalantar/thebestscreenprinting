// Edge entry point. Static pages come from the ASSETS binding; anything the build
// doesn't contain is checked against the legacy WordPress redirect map.
import redirects from './redirects.json';
import { parseQuote, quoteEmail, MAX_ARTWORK_BYTES, ARTWORK_TYPES } from './lib/quote';
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
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function handleQuote(request: Request, env: Env): Promise<Response> {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_ARTWORK_BYTES + 200_000) return json({ error: 'That file is too large. Please keep artwork under 10 MB.' }, 413);
  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: 'Could not read the form.' }, 400); }

  // Bots fill the hidden field; pretend success so they move on.
  if (form.get('website')) return json({ ok: true });

  if (env.TURNSTILE_SECRET) {
    const token = form.get('cf-turnstile-response');
    const check = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: typeof token === 'string' ? token : '', remoteip: request.headers.get('cf-connecting-ip') || '' }),
    }).then((r) => r.json() as Promise<{ success: boolean }>).catch(() => ({ success: false }));
    if (!check.success) return json({ error: 'Please confirm you are not a robot and try again.' }, 400);
  }

  const parsed = parseQuote(form);
  if ('errors' in parsed) return json({ error: 'Please check the highlighted fields.', fields: parsed.errors }, 400);
  const q = parsed.quote;

  const file = form.get('artwork');
  let attachment: { filename: string; content: string } | undefined;
  if (file && typeof file !== 'string' && file.size > 0) {
    if (file.size > MAX_ARTWORK_BYTES) return json({ error: 'That file is too large. Please keep artwork under 10 MB.', fields: { artwork: 'Max 10 MB' } }, 400);
    if (file.type && !ARTWORK_TYPES.includes(file.type)) return json({ error: 'Please upload PNG, JPG, SVG, PDF, AI or PSD artwork.', fields: { artwork: 'Unsupported file type' } }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    attachment = { filename: file.name.slice(0, 120) || 'artwork', content: btoa(bin) };
  }

  if (!env.RESEND_API_KEY) {
    return json({ error: `Online quotes are not switched on yet. Please call ${business.phoneDisplay} or email ${business.email}.`, fallback: true }, 503);
  }
  const mail = quoteEmail(q, attachment?.filename);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.QUOTE_FROM || 'TBSP Quotes <quotes@thebestscreenprinting.com>',
      to: [env.QUOTE_TO || business.email],
      reply_to: q.email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: attachment ? [attachment] : undefined,
    }),
  });
  if (!res.ok) {
    console.error('quote email failed', res.status, await res.text());
    return json({ error: `We could not send your request. Please call ${business.phoneDisplay} or email ${business.email}.`, fallback: true }, 502);
  }
  return json({ ok: true });
}

const moved = redirects.moved as Record<string, string>;
const gone = new Set<string>(redirects.gone);
const kept = new Set<string>(redirects.keep);

/** Old WordPress slugs without the `-ca` suffix already 301'd to the `-ca` version. */
function legacyCandidates(path: string): string[] {
  const p = path.endsWith('/') ? path : `${path}/`;
  const out = [p];
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
  async fetch(request: Request, env: Env): Promise<Response> {
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
      return handleQuote(request, env);
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
