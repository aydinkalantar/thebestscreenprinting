// Turns data/redirect-map.csv (the reviewed URL-by-URL map) into src/redirects.json,
// which the Worker reads. Only rows whose action is 301 or 410 are emitted; "keep"
// rows are served by real pages.
import { readFileSync, writeFileSync } from 'node:fs';

const ORIGIN = 'https://thebestscreenprinting.com';
const STUDIO = 'https://design.thebestscreenprinting.com';

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const rows = parseCsv(readFileSync(new URL('../data/redirect-map.csv', import.meta.url), 'utf8'));
const moved = {};
const gone = [];
const keep = [];
const unresolved = [];

for (const r of rows) {
  if (!r.old_url.startsWith(ORIGIN)) continue;
  const from = r.old_url.slice(ORIGIN.length);
  if (r.action === 'keep' || r.action === 'keep-noindex') { keep.push(from); continue; }
  if (r.action === '410') { gone.push(from); continue; }
  if (r.action !== '301') continue;
  // Targets like "/for/schools/ (new hub)" carry a note after the path.
  let to = r.target.split(' ')[0];
  if (to.startsWith(STUDIO) || to.startsWith('/')) moved[from] = to;
  else unresolved.push(`${from} -> ${r.target}`);
}

writeFileSync(
  new URL('../src/redirects.json', import.meta.url),
  JSON.stringify({ moved, gone, keep }, null, 0),
);
console.log(`redirects: ${Object.keys(moved).length} moved, ${gone.length} gone, ${keep.length} kept`);
if (unresolved.length) console.log(`skipped (no concrete target yet): ${unresolved.length}\n  ${unresolved.slice(0, 5).join('\n  ')}`);
