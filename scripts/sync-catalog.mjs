// Snapshots the studio's product catalog (synced there from Printful) into
// data/catalog.json, which the static catalog pages are built from. The site
// never calls Printful itself, and only public fields are kept.
// Usage: CATALOG_URL=http://localhost:3000 node scripts/sync-catalog.mjs
import { writeFileSync } from 'node:fs';

const base = (process.env.CATALOG_URL || 'https://design.thebestscreenprinting.com').replace(/\/$/, '');
const res = await fetch(`${base}/api/catalog/products`);
if (!res.ok) throw new Error(`catalog: ${res.status} ${await res.text()}`);
const data = await res.json();

const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[®™©]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const seen = new Set();
const products = data.products
  .filter((p) => p.retailPrice > 0 && p.imageUrl)
  .map((p) => {
    let slug = slugify(p.name);
    while (seen.has(slug)) slug += '-2';
    seen.add(slug);
    return {
      id: p.id,
      slug,
      name: p.name,
      brand: p.brand || null,
      category: p.category,
      subcategory: p.subcategory || null,
      type: p.productType || null,
      fromPrice: Math.round(p.retailPrice * 100) / 100,
      techniques: p.techniques || [],
      image: p.imageUrl,
      images: (p.images || []).slice(0, 6),
      colors: (p.colors || []).map((c) => ({ name: c.name, hex: c.hex, image: c.imageUrl || null })),
      sizes: p.sizes || [],
      featured: !!p.isFeatured,
    };
  })
  .sort((a, b) => Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name));

writeFileSync(new URL('../data/catalog.json', import.meta.url), JSON.stringify({ syncedAt: new Date().toISOString(), source: base, products }, null, 1));
console.log(`${products.length} products from ${base}`);
