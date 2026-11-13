// Refresh src/data/facts.json from the live price engine before each build, so
// every price, setup fee and shipping line on the site matches what Max, the
// product pages and checkout charge. Example garment: black Gildan 5000, one
// front print (embroidery: left chest).
//
// Never breaks the build: if the studio can't be reached, or a price comes back
// as "quote only", that value keeps its last known number and a warning prints.
//
//   node scripts/refresh-facts.mjs            (STUDIO_API overrides the studio URL)
import { readFile, writeFile } from 'node:fs/promises';

const FILE = new URL('../src/data/facts.json', import.meta.url);
const API = (process.env.STUDIO_API || process.env.PUBLIC_STUDIO_API || 'https://design.thebestscreenprinting.com').replace(/\/$/, '');

const LOCATIONS = {
  screen1: [{ placement: 'Front', method: 'Screen printing', colors: 1 }],
  screen2: [{ placement: 'Front', method: 'Screen printing', colors: 2 }],
  dtf: [{ placement: 'Front', method: 'DTF transfer', widthIn: 11, heightIn: 11 }],
  dtg: [{ placement: 'Front', method: 'DTG printing', widthIn: 11, heightIn: 11 }],
  embroidery: [{ placement: 'Left chest', method: 'Embroidery' }],
  // A second one-color spot: priced as front + back, minus the front-only price.
  back1: [{ placement: 'Front', method: 'Screen printing', colors: 1 }, { placement: 'Back', method: 'Screen printing', colors: 1 }],
};

const round = (n) => Math.round(n * 100) / 100;

async function price(items) {
  const res = await fetch(`${API}/api/public/price`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://thebestscreenprinting.com' },
    body: JSON.stringify({ items, delivery: 'ship' }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`price API ${res.status}`);
  const data = await res.json();
  if (!data.enabled) throw new Error('online prices are switched off');
  return data;
}

async function main() {
  const facts = JSON.parse(await readFile(FILE, 'utf8'));
  const before = JSON.stringify(facts);
  const warn = [];

  // The merch agent's name (Admin › Settings › Max), for {{agent}} in the copy.
  try {
    const m = await fetch(`${API}/api/public/max`, { headers: { origin: 'https://thebestscreenprinting.com' }, signal: AbortSignal.timeout(10_000) }).then((r) => r.json());
    if (typeof m?.name === 'string' && m.name.trim()) facts.agentName = m.name.trim();
  } catch (e) { warn.push(`agentName: ${e.message} (kept ${facts.agentName})`); }

  // Every method × quantity the site quotes, 10 items per request.
  const jobs = [];
  for (const [method, row] of Object.entries(facts.tee)) {
    for (const qty of Object.keys(row)) jobs.push({ method, qty: Number(qty) });
  }
  const results = [];
  let last = null;
  for (let i = 0; i < jobs.length; i += 10) {
    const batch = jobs.slice(i, i + 10);
    const data = await price(batch.map((j) => ({ brand: 'Gildan', style: '5000', color: 'Black', sizes: { L: j.qty }, locations: LOCATIONS[j.method] })));
    last = data;
    batch.forEach((j, k) => results.push({ ...j, item: data.items?.[k] }));
  }

  const front = (qty) => results.find((r) => r.method === 'screen1' && r.qty === qty)?.item;
  for (const r of results) {
    if (r.method === 'back1') {
      const f = front(r.qty);
      if (r.item?.ok && f?.ok) facts.tee.back1[r.qty] = round(r.item.basePrice - f.basePrice);
      else warn.push(`tee.back1.${r.qty}: no price (kept ${facts.tee.back1[r.qty]})`);
      continue;
    }
    if (r.item?.ok && r.item.basePrice > 0) facts.tee[r.method][r.qty] = round(r.item.basePrice);
    else warn.push(`tee.${r.method}.${r.qty}: ${r.item?.quoteOnly || 'no price'} (kept ${facts.tee[r.method][r.qty]})`);
  }

  // Setup fees, read off the same answers.
  const at = (method, qty) => results.find((r) => r.method === method && r.qty === qty)?.item;
  const s24 = at('screen1', 24);
  if (s24?.ok) facts.screenSetup = round(s24.setup);
  const emb = results.filter((r) => r.method === 'embroidery' && r.item?.ok).sort((a, b) => a.qty - b.qty);
  const paid = emb.find((r) => r.item.setup > 0);
  if (paid) facts.digitizing = round(paid.item.setup);
  // Digitizing is charged on every embroidery order now (no free-from quantity).
  delete facts.digitizingFreeFrom;

  // Art help, shipping and rush, from the last answer.
  const art = last?.artHelp;
  if (art) {
    if (typeof art.cleanup?.price === 'number') facts.artCleanup = art.cleanup.price;
    if (typeof art.layout?.price === 'number') facts.artLayout = art.layout.price;
    if (typeof art.custom?.price === 'number') facts.artCustom = art.custom.price;
    if (typeof art.revisionPrice === 'number') facts.artRevision = art.revisionPrice;
  }
  if (typeof last?.delivery?.shipping === 'number') facts.shipFlat = round(last.delivery.shipping);
  if (typeof last?.delivery?.freeOver === 'number') facts.shipFreeFrom = round(last.delivery.freeOver);
  if (typeof last?.turnaround?.rush?.percent === 'number') facts.rushPercent = last.turnaround.rush.percent;
  if (typeof last?.turnaround?.superrush?.percent === 'number') facts.superRushPercent = last.turnaround.superrush.percent;
  if (typeof last?.turnaround?.superrush?.maxPieces === 'number') facts.superRushMaxPieces = last.turnaround.superrush.maxPieces;

  for (const w of warn) console.warn(`[facts] ${w}`);
  const { updated: _u, ...a } = JSON.parse(before);
  const { updated: _v, ...b } = facts;
  if (JSON.stringify(a) === JSON.stringify(b)) { console.log('[facts] prices unchanged'); return; }
  facts.updated = new Date().toISOString().slice(0, 10);
  facts.source = 'Live price engine (scripts/refresh-facts.mjs), refreshed on every build.';
  await writeFile(FILE, `${JSON.stringify(facts, null, 2)}\n`);
  console.log('[facts] updated from the live price engine');
}

main().catch((e) => console.warn(`[facts] could not refresh (${e.message}); building with the last known prices.`));
