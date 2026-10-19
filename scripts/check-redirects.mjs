// Crawls every old URL in data/redirect-map.csv against a running site and checks
// it answers as the map says: keep -> 200, 301 -> one hop to the target, 410 -> 410.
// Usage: node scripts/check-redirects.mjs [baseUrl=http://localhost:8787]
import { readFileSync } from 'node:fs';

const base = (process.argv[2] || 'http://localhost:8787').replace(/\/$/, '');
const ORIGIN = 'https://thebestscreenprinting.com';
const STUDIO = 'https://design.thebestscreenprinting.com';
const [head, ...lines] = readFileSync(new URL('../data/redirect-map.csv', import.meta.url), 'utf8').trim().split(/\r?\n/);
const cols = head.split(',');
const rows = lines.map((l) => {
  const v = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((s) => s.replace(/,$/, '').replace(/^"|"$/g, ''));
  return Object.fromEntries(cols.map((c, i) => [c, v[i]]));
});

let ok = 0;
const bad = [];
const queue = rows.filter((r) => r.old_url.startsWith(ORIGIN) && !r.target.includes('new image path'));
async function check(r) {
  const path = r.old_url.slice(ORIGIN.length);
  const res = await fetch(base + path, { redirect: 'manual' });
  const loc = res.headers.get('location') || '';
  const want = r.target.split(' ')[0];
  let pass;
  if (r.action === 'keep' || r.action === 'keep-noindex') pass = res.status === 200;
  else if (r.action === '410') pass = res.status === 410;
  else {
    const to = loc.startsWith(base) ? loc.slice(base.length) : loc;
    pass = res.status === 301 && (to === want || (want.startsWith(STUDIO) && to.startsWith(want)));
    if (pass && !want.startsWith('http')) {
      const final = await fetch(base + want, { redirect: 'manual' });
      if (final.status !== 200) { pass = false; r.note = `target returns ${final.status}`; }
    }
  }
  if (pass) ok++;
  else bad.push(`${res.status} ${path} -> ${loc || '-'} (want ${r.action} ${want}) ${r.note || ''}`);
}
for (let i = 0; i < queue.length; i += 20) await Promise.all(queue.slice(i, i + 20).map(check));
console.log(`${ok}/${queue.length} URLs behave as mapped`);
if (bad.length) console.log(bad.slice(0, 40).join('\n'));
process.exit(bad.length ? 1 : 0);
