// Search index for the header search box: catalog products, collection and brand pages, content pages.
// Fields: t title, u url, k kind, i image, s subtitle, w hidden keywords, f featured.
// Products also carry what src/lib/search.ts reads: id, b brand, st style, c collections,
// fb fabric, co colors as [name, hex, photo, color group] (photo is a catalog photo number when it can be).
import { getCollection } from 'astro:content';
import { products, COLLECTIONS } from '../lib/catalog';
import { colorGroup, productFabric } from '../lib/search';
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

// The garment a product is, whatever audience it is for (a kids tee is still a tee).
const GARMENT: Record<string, string> = {
  't-shirts': 't-shirts', 'long-sleeves': 'long-sleeves', hoodies: 'hoodies', 'zip-hoodies': 'hoodies', crewnecks: 'crewnecks',
  polos: 'polos', 'trucker-hats': 'hats', snapbacks: 'hats', 'dad-hats': 'hats', 'fitted-hats': 'hats', beanies: 'beanies',
  'tank-tops': 'tank-tops', 'crop-tops': 'tank-tops', sweatpants: 'sweatpants-shorts', shorts: 'sweatpants-shorts',
  jackets: 'jackets', totes: 'bags',
};
const photo = (url?: string) => /\/Images\/Color\/(\d+)_f_fl\.jpg$/.exec(url ?? '')?.[1] ?? url ?? '';

export async function GET() {
  const items = products.map((p) => {
    const cols = COLLECTIONS.filter((c) => c.match(p));
    const words = [
      p.brand, p.style, p.name, p.type, p.subcategory, p.category,
      ...cols.map((c) => `${c.label} ${SYNONYMS[c.slug] ?? ''}`),
    ];
    const c = new Set(cols.map((x) => x.slug));
    if (p.subcategory && GARMENT[p.subcategory]) c.add(GARMENT[p.subcategory]);
    if (p.category === 'kids' || p.category === 'womens') c.add(p.category);
    const fb = productFabric(p.name, p.features ?? []);
    return {
      t: p.name, u: `/catalog/${p.slug}/`, k: 'product', i: p.image, s: [p.brand, p.style].filter(Boolean).join(' · '),
      w: [...new Set(words.filter(Boolean).join(' ').toLowerCase().split(/\s+/))].join(' '),
      ...(p.featured ? { f: 1 } : {}),
      id: p.id, b: p.brand ?? '', st: p.style ?? '', c: [...c], ...(fb ? { fb } : {}),
      co: p.colors.map((x) => [x.name, (x.hex ?? '').replace(/^#/, ''), photo(x.image), colorGroup(x.name, x.hex ?? '')]),
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
