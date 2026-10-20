import catalog from '../../data/catalog.json';
import { business } from '../data/business';

export type CatalogProduct = (typeof catalog.products)[number];
export const products: CatalogProduct[] = catalog.products;
export const syncedAt = catalog.syncedAt;

export const CATEGORY_LABELS: Record<string, string> = {
  apparel: 'T-shirts & tops', sweatshirts: 'Hoodies & sweatshirts', hats: 'Hats', accessories: 'Bags & accessories',
  home: 'Home & living', kids: 'Kids', pants: 'Pants & shorts', womens: "Women's",
};

/** Printful technique codes → the names customers know. */
export const TECHNIQUE_LABELS: Record<string, string> = {
  DTG: 'DTG printing', DTFILM: 'DTF transfer', EMBROIDERY: 'Embroidery', 'CUT-SEW': 'All-over print',
  'DIRECT-TO-FABRIC': 'All-over print', SUBLIMATION: 'Sublimation', UV: 'UV print', DIGITAL: 'Digital print',
};

export const techniqueNames = (codes: string[]) => [...new Set(codes.map((c) => TECHNIQUE_LABELS[c] || c))];
export const money = (n: number) => `$${n.toFixed(2)}`;

/** Where "Customize" goes: the studio when it is live, otherwise a quote request. */
export function customizeHref(p: CatalogProduct) {
  return business.studioLive
    ? `${business.studioUrl}/studio?product=${encodeURIComponent(p.id)}`
    : `/quick-quote/?garment=${encodeURIComponent(p.name)}`;
}
