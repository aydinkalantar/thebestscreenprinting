// Shopper-facing wording for collection and brand pages.
import { techniqueNames, type CatalogProduct } from '../../lib/catalog';

const HEADINGS: Record<string, string> = {
  't-shirts': 'Custom T-Shirts',
  'long-sleeves': 'Custom Long Sleeve Shirts',
  hats: 'Custom Hats & Caps',
  womens: "Custom Women's Apparel",
  kids: 'Custom Kids & Youth Apparel',
};
const titleCase = (s: string) => s.replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

/** "Custom Hoodies", "Custom Bags & Totes"… */
export const collectionHeading = (slug: string, label: string) => HEADINGS[slug] ?? `Custom ${titleCase(label)}`;

/** "screen printing, embroidery and DTF transfer" from the products' techniques. */
export function methodsSentence(list: CatalogProduct[]) {
  const order = ['Screen printing', 'Embroidery', 'DTG printing', 'DTF transfer'];
  const names = techniqueNames(list.flatMap((p) => p.techniques))
    .sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    .map((n) => n.replace(/^[A-Z][a-z]/, (m) => m.toLowerCase()));
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
