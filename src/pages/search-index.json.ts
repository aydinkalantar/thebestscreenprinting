// Search index for the header search box: catalog products, collection and brand pages, content pages.
// Fields: t title, u url, k kind, i image, s subtitle, w hidden keywords, f featured.
import { getCollection } from 'astro:content';
import { products, COLLECTIONS } from '../lib/catalog';
import { collectionTiles, brandTiles, styles } from '../components/home/collections';

// Extra words shoppers type that the collection labels don't contain.
const SYNONYMS: Record<string, string> = {
  't-shirts': 'tee tees tshirt t shirt short sleeve',
  'long-sleeves': 'long sleeve tee tees t-shirt tshirt',
  hoodies: 'hoodie hooded sweatshirt pullover zip',
  crewnecks: 'crew sweatshirt pullover',
  polos: 'polo golf business uniform',
  hats: 'hat cap caps trucker snapback dad fitted',
  beanies: 'beanie knit winter hat',
  'tank-tops': 'tank crop top sleeveless',
  'sweatpants-shorts': 'sweatpants joggers shorts pants',
  jackets: 'jacket outerwear coat',
  bags: 'bag tote totes accessories',
  womens: 'women ladies',
  kids: 'kid youth toddler child children',
};

export async function GET() {
  const items = products.map((p) => {
    const cols = COLLECTIONS.filter((c) => c.match(p));
    const words = [
      p.brand, p.style, p.name, p.type, p.subcategory, p.category,
      ...cols.map((c) => `${c.label} ${SYNONYMS[c.slug] ?? ''}`),
      ...p.colors.map((c) => c.name),
    ];
    return {
      t: p.name, u: `/catalog/${p.slug}/`, k: 'product', i: p.image, s: [p.brand, p.style].filter(Boolean).join(' · '),
      w: [...new Set(words.filter(Boolean).join(' ').toLowerCase().split(/\s+/))].join(' '),
      ...(p.featured ? { f: 1 } : {}),
    };
  });
  const collections = collectionTiles.map((c) => ({
    t: c.label, u: c.href, k: 'collection', i: c.img, s: `Category · ${styles(c.count)}`, w: `${c.slug} ${SYNONYMS[c.slug] ?? ''}`,
  }));
  const brands = brandTiles(Infinity).map((b) => ({ t: b.name, u: b.href, k: 'brand', s: `Brand · ${styles(b.count)}`, w: b.slug }));
  const pages = (await getCollection('pages'))
    .filter((p) => !p.data.noindex && !p.data.path.endsWith('-ca/') && p.data.path !== '/')
    .map((p) => ({ t: p.data.h1, u: p.data.path, k: 'page' }));
  return new Response(JSON.stringify([...items, ...collections, ...brands, ...pages]), { headers: { 'content-type': 'application/json' } });
}
