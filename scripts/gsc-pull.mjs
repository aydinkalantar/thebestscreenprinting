// Pulls Search Console performance (page × query, last 28 days) for the weekly
// SEO loop. Auth: a Google service account key outside the repo, added as a user
// on the Search Console property.
// Usage: GSC_KEY_FILE=~/.config/tbsp/gsc-service-account.json node scripts/gsc-pull.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { homedir } from 'node:os';

// Defaults to whichever thebestscreenprinting.com property the account can see.
let SITE = process.env.GSC_SITE;
const keyFile = (process.env.GSC_KEY_FILE || '~/.config/tbsp/gsc-service-account.json').replace(/^~/, homedir());
const key = JSON.parse(readFileSync(keyFile, 'utf8'));

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
async function token() {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email, scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  });
  if (!res.ok) throw new Error(`token: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

const day = (d) => d.toISOString().slice(0, 10);
const end = new Date(Date.now() - 3 * 864e5);          // GSC data lags ~2–3 days
const start = new Date(end.getTime() - 27 * 864e5);
const t = await token();

const sites = await fetch('https://www.googleapis.com/webmasters/v3/sites', { headers: { authorization: `Bearer ${t}` } }).then((r) => r.json());
const props = (sites.siteEntry || []).map((s) => `${s.siteUrl} (${s.permissionLevel})`);
console.log(`properties visible: ${props.join(', ') || 'none — add the service account in Search Console'}`);
SITE ||= (sites.siteEntry || []).map((s) => s.siteUrl).find((u) => u.includes('thebestscreenprinting.com'));
if (!SITE) process.exit(2);

const rows = [];
for (let startRow = 0; ; startRow += 25000) {
  const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
    body: JSON.stringify({ startDate: day(start), endDate: day(end), dimensions: ['page', 'query'], rowLimit: 25000, startRow }),
  }).then((r) => r.json());
  if (res.error) throw new Error(JSON.stringify(res.error));
  rows.push(...(res.rows || []));
  if (!res.rows || res.rows.length < 25000) break;
}
mkdirSync(new URL('../data/gsc/', import.meta.url), { recursive: true });
const out = new URL(`../data/gsc/${day(end)}.json`, import.meta.url);
writeFileSync(out, JSON.stringify({ site: SITE, startDate: day(start), endDate: day(end), rows }, null, 0));
console.log(`${rows.length} page×query rows, ${day(start)} → ${day(end)} → ${out.pathname}`);
