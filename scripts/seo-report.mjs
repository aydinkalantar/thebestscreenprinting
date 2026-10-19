// Weekly SEO report from the latest Search Console pull (scripts/gsc-pull.mjs).
// Finds: pages to retitle (seen, not clicked), striking-distance pages (rank 5–20)
// with the queries to answer, searches with no good page yet, and traffic still
// landing on URLs the new site redirects. Output: data/gsc/report-<date>.md
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const dir = new URL('../data/gsc/', import.meta.url);
const latest = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().pop();
if (!latest) throw new Error('No Search Console pull yet — run scripts/gsc-pull.mjs');
const data = JSON.parse(readFileSync(new URL(latest, dir), 'utf8'));
const redirects = JSON.parse(readFileSync(new URL('../src/redirects.json', import.meta.url), 'utf8'));
const ORIGIN = 'https://thebestscreenprinting.com';
const path = (u) => u.replace(ORIGIN, '') || '/';

// Aggregate page and query level stats (position weighted by impressions).
const pages = new Map();
const queries = new Map();
for (const r of data.rows) {
  const [page, query] = r.keys;
  const p = pages.get(page) || { page, clicks: 0, impressions: 0, posW: 0, queries: [] };
  p.clicks += r.clicks; p.impressions += r.impressions; p.posW += r.position * r.impressions;
  p.queries.push({ query, ...r });
  pages.set(page, p);
  const q = queries.get(query) || { query, clicks: 0, impressions: 0, best: Infinity, bestPage: '' };
  q.clicks += r.clicks; q.impressions += r.impressions;
  if (r.position < q.best) { q.best = r.position; q.bestPage = page; }
  queries.set(query, q);
}
for (const p of pages.values()) { p.position = p.posW / p.impressions; p.ctr = p.clicks / p.impressions; p.queries.sort((a, b) => b.impressions - a.impressions); }

const fmt = (n, d = 1) => Number(n).toFixed(d);
const pct = (n) => `${fmt(n * 100)}%`;
const list = [...pages.values()];
const totals = list.reduce((a, p) => ({ c: a.c + p.clicks, i: a.i + p.impressions }), { c: 0, i: 0 });

const retitle = list.filter((p) => p.impressions >= 150 && p.ctr < 0.015 && p.position <= 15).sort((a, b) => b.impressions - a.impressions).slice(0, 10);
const striking = list.filter((p) => p.position >= 5 && p.position <= 20 && p.impressions >= 40).sort((a, b) => b.impressions - a.impressions).slice(0, 10);
const gaps = [...queries.values()].filter((q) => q.impressions >= 30 && q.best > 20).sort((a, b) => b.impressions - a.impressions).slice(0, 15);
const redirected = list.filter((p) => redirects.moved[path(p.page)]).sort((a, b) => b.impressions - a.impressions).slice(0, 10);

const q3 = (p) => p.queries.slice(0, 3).map((q) => `"${q.query}"`).join(', ');
let md = `# SEO report — ${data.startDate} to ${data.endDate}\n\n`;
md += `${totals.c} clicks from ${totals.i.toLocaleString()} impressions across ${list.length} pages (${data.site}).\n\n`;
md += `## Retitle: seen often, rarely clicked\n\nRewrite the title and description to answer the search directly (price, turnaround, minimums).\n\n| Page | Impressions | CTR | Position | Top searches |\n| --- | --- | --- | --- | --- |\n`;
md += retitle.map((p) => `| ${path(p.page)} | ${p.impressions} | ${pct(p.ctr)} | ${fmt(p.position)} | ${q3(p)} |`).join('\n') || '| none | | | | |';
md += `\n\n## Striking distance: ranking 5–20\n\nAdd sections and FAQs that answer these searches word for word.\n\n| Page | Impressions | Position | Searches to answer |\n| --- | --- | --- | --- |\n`;
md += striking.map((p) => `| ${path(p.page)} | ${p.impressions} | ${fmt(p.position)} | ${q3(p)} |`).join('\n') || '| none | | | |';
md += `\n\n## Searches with no good page yet (best position over 20)\n\nCandidates for a new page or a new section, only where we have real details to add.\n\n| Search | Impressions | Best position | Current best page |\n| --- | --- | --- | --- |\n`;
md += gaps.map((q) => `| ${q.query} | ${q.impressions} | ${fmt(q.best)} | ${path(q.bestPage)} |`).join('\n') || '| none | | | |';
md += `\n\n## Traffic on URLs the new site redirects\n\nMake sure each target page covers these searches before launch.\n\n| Old URL | Impressions | Redirects to | Top searches |\n| --- | --- | --- | --- |\n`;
md += redirected.map((p) => `| ${path(p.page)} | ${p.impressions} | ${redirects.moved[path(p.page)]} | ${q3(p)} |`).join('\n') || '| none | | | |';
md += '\n';

const out = new URL(`report-${data.endDate}.md`, dir);
writeFileSync(out, md);
console.log(md);
