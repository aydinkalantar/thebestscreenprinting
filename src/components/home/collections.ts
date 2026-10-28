// Shopper-facing collection tiles (label, link, photo, count) shared by the homepage and header menu.
import { COLLECTIONS, collectionProducts, collectionHref, BRANDS, brandHref } from '../../lib/catalog';

export interface CollectionTile { slug: string; label: string; href: string; img: string; count: number }

/**
 * Non-empty collections, each pictured by its first featured product (else its first product),
 * never reusing a photo another tile already has (Tank tops and Women's share products).
 */
const usedImages = new Set<string>();
export const collectionTiles: CollectionTile[] = COLLECTIONS.map((c) => {
  const items = collectionProducts(c.slug);
  const fresh = items.filter((p) => p.image && !usedImages.has(p.image));
  const pic = fresh.find((p) => p.featured) ?? fresh[0] ?? items[0];
  if (pic?.image) usedImages.add(pic.image);
  return { slug: c.slug, label: c.label, href: collectionHref(c.slug), img: pic?.image ?? '', count: items.length };
}).filter((c) => c.count > 0);

export const brandTiles = (n: number) => BRANDS.slice(0, n).map((b) => ({ ...b, href: brandHref(b.name) }));

export const styles = (n: number) => `${n} ${n === 1 ? 'style' : 'styles'}`;
