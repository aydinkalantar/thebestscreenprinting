// Presentation details per page: eyebrow label, hero photo and related links.

export const SERVICE_LINKS = [
  { href: '/screen-printing/', label: 'Screen printing' },
  { href: '/services/embroidery/', label: 'Embroidery' },
  { href: '/services/direct-to-film/', label: 'DTF transfers' },
  { href: '/services/direct-to-garment/', label: 'DTG printing' },
  { href: '/services/embossing/', label: 'Embossing' },
  { href: '/services/large-format-screen-printing/', label: 'Oversize prints' },
  { href: '/same-day-t-shirt-printing-los-angeles/', label: 'Rush & Super Rush' },
  { href: '/custom-projects/', label: 'Custom projects' },
];

export const PRODUCT_LINKS = [
  { href: '/products/t-shirts/', label: 'T-shirts' },
  { href: '/products/sweatshirts-hoodies/', label: 'Hoodies & sweatshirts' },
  { href: '/products/hats/', label: 'Hats' },
  { href: '/products/business-and-polos-landings/', label: 'Polos' },
  { href: '/products/bags/', label: 'Bags & totes' },
  { href: '/products/team-uniforms-jerseys/', label: 'Team uniforms' },
  { href: '/catalog/', label: 'Full catalog' },
];

// Short labels for the "Prices & answers" list, in the order shown. Answer pages not listed here follow, labeled by their h1.
const ANSWER_LABELS: [string, string][] = [
  ['/how-much-does-custom-shirt-printing-cost/', 'Prices per shirt'],
  ['/cheapest-way-to-print-50-shirts/', 'Cheapest way to print 50 shirts'],
  ['/custom-shirts-minimum-order/', 'Minimum order'],
  ['/rush-custom-shirts-shipped-fast/', 'How fast can I get shirts?'],
  ['/screen-printing-vs-dtf-vs-dtg/', 'Screen printing vs DTF vs DTG'],
  ['/front-back-sleeve-printing/', 'Front, back & sleeve prints'],
  ['/custom-hoodies-in-bulk/', 'Hoodies in bulk'],
  ['/oversized-heavyweight-t-shirt-printing/', 'Oversized & heavyweight tees'],
  ['/embroidered-polos-and-hats-for-companies/', 'Embroidered polos & hats'],
  ['/artwork-file-types-for-printing/', 'Artwork files we need'],
  ['/how-to-choose-a-screen-printer-in-los-angeles/', 'Choosing a screen printer in LA'],
];

export function answersFor(pages: { href: string; h1: string }[]) {
  const have = new Map(pages.map((p) => [p.href, p.h1]));
  const known = ANSWER_LABELS.filter(([href]) => have.has(href)).map(([href, label]) => ({ href, label }));
  const rest = pages.filter((p) => !ANSWER_LABELS.some(([href]) => href === p.href)).map((p) => ({ href: p.href, label: p.h1 }));
  return [...known, ...rest];
}

const IMAGES: [RegExp, string][] = [
  [/embroider/, 'custom-embroidery-img'],
  [/heat-transfer/, 'heat-transfer-vinyl-img'],
  [/direct-to-film|dtf/, 'direct-to-film'],
  [/direct-to-garment|dtg/, 'dtg'],
  [/emboss/, 'embossing'],
  [/hood|sweatshirt/, 'custom-hoodie-printing'],
  [/tank/, 'custom-tank-top'],
  [/t-shirt|tshirt|tee/, 'custom-t-shirt-printing'],
  [/screen-print|silk|large-format|bulk|same-day|rush/, 'custom-screen-printing-img'],
];

export function heroImage(path: string): string | null {
  const hit = IMAGES.find(([re]) => re.test(path));
  return hit ? `/images/services/${hit[1]}.webp` : null;
}

const KIND_LABEL: Record<string, string> = {
  service: 'Service', product: 'Products', audience: 'Who we print for', location: 'Los Angeles',
  blog: 'Guide', answer: 'Straight answer', legal: 'Legal', utility: 'TBSP', core: 'TBSP',
};

/** "/custom-embroidery-koreatown-la-ca/" → "Koreatown LA" */
export function areaName(path: string): string | null {
  const m = path.match(/-(?:in-)?([a-z-]+?)-ca\/$/);
  if (!m) return null;
  const words = m[1].split('-');
  // Drop the service words at the front of service × area slugs.
  const known = ['same', 'day', 't', 'shirt', 'printing', 'screen', 'rush', 'order', 'next', 'large', 'format', 'direct', 'to', 'garment', 'film', 'custom', 'silk', 'embroidery', 'bulk', 'heat', 'transfer', 'vinyl', 'team', 'uniform', 'in'];
  while (words.length > 1 && known.includes(words[0])) words.shift();
  return words.map((w) => (w === 'la' ? 'LA' : w[0].toUpperCase() + w.slice(1))).join(' ');
}

export function eyebrowFor(kind: string, path: string): string {
  if (path.includes('cleveland')) return 'Production facility · Cleveland, Ohio';
  if (path === '/los-angeles-ca/') return 'Production facility · Los Angeles, California';
  if (kind === 'location') {
    const area = areaName(path);
    return area ? `Los Angeles · ${area}` : 'Los Angeles';
  }
  return KIND_LABEL[kind] || 'TBSP';
}

export function relatedFor(kind: string) {
  if (kind === 'product') return { title: 'More products', links: PRODUCT_LINKS };
  return { title: 'Our services', links: SERVICE_LINKS };
}
