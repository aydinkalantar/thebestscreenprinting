import catalog from '../../data/catalog.json';
import { business } from '../data/business';

export type CatalogProduct = (typeof catalog.products)[number];
export const products: CatalogProduct[] = catalog.products;
export const syncedAt = catalog.syncedAt;

export const CATEGORY_LABELS: Record<string, string> = {
  apparel: 'T-shirts & tops', sweatshirts: 'Hoodies & sweatshirts', hats: 'Hats', accessories: 'Bags & accessories',
  home: 'Home & living', kids: 'Kids', pants: 'Pants & shorts', womens: "Women's", outerwear: 'Jackets',
};

/** Decoration codes → the names customers know. */
export const TECHNIQUE_LABELS: Record<string, string> = {
  SCREEN: 'Screen printing', DTG: 'DTG printing', DTF: 'DTF transfer', DTFILM: 'DTF transfer', EMBROIDERY: 'Embroidery', 'CUT-SEW': 'All-over print',
  'DIRECT-TO-FABRIC': 'All-over print', SUBLIMATION: 'Sublimation', UV: 'UV print', DIGITAL: 'Digital print',
};

/** Methods we no longer offer (heat transfer vinyl, stopped Oct 2026); hidden even when the catalog lists them. */
const RETIRED = new Set(['HTV']);

export const techniqueNames = (codes: string[]) => [...new Set(codes.filter((c) => !RETIRED.has(c)).map((c) => TECHNIQUE_LABELS[c] || c))];

/** Where "Customize" goes: the studio when it is live, otherwise a quote request. */
export function customizeHref(p: CatalogProduct) {
  return business.studioLive
    ? `${business.studioUrl}/studio?product=${encodeURIComponent(p.id)}`
    : `/quick-quote/?details=${encodeURIComponent(`${p.name}: `)}`;
}

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Shopper-facing collections. Each gets a page at /catalog/category/<slug>/. */
export const COLLECTIONS: { slug: string; label: string; match: (p: CatalogProduct) => boolean }[] = [
  { slug: 't-shirts', label: 'T-shirts', match: (p) => p.subcategory === 't-shirts' && !['kids', 'womens'].includes(p.category) },
  { slug: 'long-sleeves', label: 'Long sleeve shirts', match: (p) => p.subcategory === 'long-sleeves' },
  { slug: 'hoodies', label: 'Hoodies', match: (p) => p.category === 'sweatshirts' && ['hoodies', 'zip-hoodies'].includes(p.subcategory ?? '') },
  { slug: 'crewnecks', label: 'Crewneck sweatshirts', match: (p) => p.subcategory === 'crewnecks' },
  { slug: 'polos', label: 'Polos', match: (p) => p.subcategory === 'polos' },
  { slug: 'hats', label: 'Hats & caps', match: (p) => p.category === 'hats' && p.subcategory !== 'beanies' },
  { slug: 'beanies', label: 'Beanies', match: (p) => p.subcategory === 'beanies' },
  { slug: 'tank-tops', label: 'Tank tops', match: (p) => ['tank-tops', 'crop-tops'].includes(p.subcategory ?? '') },
  { slug: 'sweatpants-shorts', label: 'Sweatpants & shorts', match: (p) => p.category === 'pants' },
  { slug: 'jackets', label: 'Jackets', match: (p) => p.category === 'outerwear' },
  { slug: 'bags', label: 'Bags & totes', match: (p) => p.category === 'accessories' },
  { slug: 'womens', label: "Women's", match: (p) => p.category === 'womens' },
  { slug: 'kids', label: 'Kids & youth', match: (p) => p.category === 'kids' },
];
export const collectionProducts = (slug: string) => products.filter(COLLECTIONS.find((c) => c.slug === slug)!.match);
export const collectionHref = (slug: string) => `/catalog/category/${slug}/`;

/** Brands we carry, most products first. Each gets a page at /catalog/brand/<slug>/. */
export const BRANDS = [...new Set(products.map((p) => p.brand).filter(Boolean) as string[])]
  .map((name) => ({ name, slug: slugify(name), count: products.filter((p) => p.brand === name).length }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
export const brandHref = (brand: string) => `/catalog/brand/${slugify(brand)}/`;

/** Featured styles, in catalog order: the "best sellers" rows. */
export const featuredProducts = products.filter((p) => p.featured);

/**
 * The print method we suggest first for a product, with a one-line reason shown under it.
 * Thread for hats, polos, jackets and beanies (premium, no heat on technical fabrics); ink for the rest.
 */
export function recommendedMethod(p: Pick<CatalogProduct, 'category' | 'subcategory'>, methods: string[]): { method: string; why: string } | null {
  if (!methods.length) return null;
  const has = (m: string) => methods.find((x) => x.toLowerCase().startsWith(m));
  const sub = p.subcategory ?? '';
  const thread = p.category === 'hats' || ['polos', 'beanies', 'jackets'].includes(sub) || p.category === 'outerwear';
  if (thread && has('embroider')) {
    const why = p.category === 'hats' || sub === 'beanies' ? 'Stitched logos look sharp and last on hats.' : sub === 'polos' ? 'Clean thread and no heat on performance fabric.' : 'A premium stitched look that lasts.';
    return { method: has('embroider')!, why };
  }
  if (has('screen')) return { method: has('screen')!, why: 'Bold, long-lasting ink and the best price per piece.' };
  return { method: methods[0], why: '' };
}
