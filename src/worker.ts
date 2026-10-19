// Edge entry point. Static pages come from the ASSETS binding; anything the build
// doesn't contain is checked against the legacy WordPress redirect map.
import redirects from './redirects.json';

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  STAGING?: string;
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
