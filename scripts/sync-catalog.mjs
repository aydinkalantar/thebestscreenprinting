// Snapshots the catalog for the static site into data/catalog.json.
// Source of truth: the studio admin (Admin › Products), GET <CATALOG_URL>, which returns the
// active products in the same shape as data/catalog.json. If the admin can't be reached, the
// curated S&S list (scripts/sync-ss.mjs) is used instead, so a nightly build never breaks.
// Guard: a catalog that suddenly shrinks below half its size is refused (FORCE=1 to accept).
// Usage: npm run sync:catalog
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const URL_ = process.env.CATALOG_URL || 'https://design.thebestscreenprinting.com/api/public/catalog';
const file = new URL('../data/catalog.json', import.meta.url);
const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { products: [] };

async function fromAdmin() {
  const res = await fetch(URL_, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`admin catalog ${res.status}`);
  const data = await res.json();
  const products = Array.isArray(data) ? data : data.products;
  if (!Array.isArray(products) || !products.length) throw new Error('admin catalog is empty');
  const bad = products.find((p) => !p.id || !p.slug || !p.name || !Array.isArray(p.colors) || !Array.isArray(p.sizes));
  if (bad) throw new Error(`admin catalog: product missing fields (${bad.id || bad.name || '?'})`);
  return products;
}

let products, source;
try {
  products = await fromAdmin();
  source = 'TBSP admin';
} catch (e) {
  console.warn(`${e.message}; using the S&S list instead`);
  await import('./sync-ss.mjs');
  process.exit(0);
}

const before = previous.products?.length || 0;
if (before && products.length < before / 2 && process.env.FORCE !== '1') {
  console.error(`Refusing: the catalog would shrink from ${before} to ${products.length} products. Run with FORCE=1 if that's intended.`);
  process.exit(1);
}
// Product URLs are public (Google, carts, quotes): flag any slug that changed for an existing id.
const oldSlugs = new Map((previous.products || []).map((p) => [p.id, p.slug]));
for (const p of products) {
  const old = oldSlugs.get(p.id);
  if (old && old !== p.slug) console.warn(`slug changed for ${p.id}: ${old} → ${p.slug} (old URL will 404)`);
}
writeFileSync(file, JSON.stringify({ syncedAt: new Date().toISOString(), source, products }, null, 1));
console.log(`catalog: ${products.length} products from ${source} (was ${before})`);
