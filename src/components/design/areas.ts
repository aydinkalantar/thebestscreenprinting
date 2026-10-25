// Print areas for the product page's design preview.
//
// PRINT_SIZES is the one table the shop tweaks: the largest print we normally do at each
// location on an adult garment, in inches. The preview turns the customer's artwork into
// approximate inches from it, and those inches go into the quote email.
//
// TEMPLATES says where each location sits on the S&S "flat" product photos. Positions are
// fractions of the garment's bounding box in the photo (found at runtime by trimming the
// white background), so they hold up across brands whose photos are framed differently:
//   cx  = horizontal center of the area (0 = garment's left edge in the photo, 1 = right edge)
//   top = top edge of the area (0 = top of the garment, 1 = bottom)
//   w   = width of the area as a fraction of the garment's width
// The height follows from the inch size, so the dashed box always has the real print shape.
// "Left" and "right" are the wearer's: on a front photo the wearer's left is on the viewer's right.

export type Side = 'front' | 'back';

export const PRINT_SIZES = {
  'full-front':   { w: 12,  h: 14 },
  'hoodie-front': { w: 12,  h: 11 },
  'tank-front':   { w: 11,  h: 14 },
  'left-chest':   { w: 4,   h: 4 },
  back:           { w: 12,  h: 15 },
  'back-neck':    { w: 6,   h: 2.5 },
  'sleeve-long':  { w: 3.5, h: 12 },
  'sleeve-short': { w: 3.5, h: 3 },
  'hat-front':    { w: 4.5, h: 2.5 },
  'hat-side':     { w: 2.5, h: 1.75 },
  'hat-back':     { w: 2.5, h: 1 },
  'beanie-cuff':  { w: 4.5, h: 2 },
  'bag-side':     { w: 10,  h: 10 },
  leg:            { w: 4,   h: 10 },
  'pants-back':   { w: 6,   h: 3 },
} as const satisfies Record<string, { w: number; h: number }>;

/** Youth sizes print smaller; kids' products scale every area by this. */
export const YOUTH_SCALE = 0.8;

type SizeKey = keyof typeof PRINT_SIZES;
type Spot = { id: string; label: string; side: Side; size: SizeKey; cx: number; top: number; w: number };

// Shared spots, reused by several templates.
const chest = (top: number, dx = 0.14, w = 0.12): Spot[] => [
  { id: 'left-chest', label: 'Left chest', side: 'front', size: 'left-chest', cx: 0.5 + dx, top, w },
  { id: 'right-chest', label: 'Right chest', side: 'front', size: 'left-chest', cx: 0.5 - dx, top, w },
];
const sleeves = (size: SizeKey, top: number, inset: number, w: number): Spot[] => [
  { id: 'left-sleeve', label: 'Left sleeve', side: 'front', size, cx: 1 - inset, top, w },
  { id: 'right-sleeve', label: 'Right sleeve', side: 'front', size, cx: inset, top, w },
];

export const TEMPLATES: Record<string, Spot[]> = {
  tee: [
    { id: 'front', label: 'Front', side: 'front', size: 'full-front', cx: 0.5, top: 0.15, w: 0.37 },
    ...chest(0.19),
    { id: 'back', label: 'Back', side: 'back', size: 'back', cx: 0.5, top: 0.15, w: 0.37 },
    { id: 'back-neck', label: 'Back neck', side: 'back', size: 'back-neck', cx: 0.5, top: 0.045, w: 0.17 },
    ...sleeves('sleeve-short', 0.2, 0.1, 0.11),
  ],
  polo: [
    { id: 'front', label: 'Front', side: 'front', size: 'full-front', cx: 0.5, top: 0.3, w: 0.34 },
    ...chest(0.2, 0.15),
    { id: 'back', label: 'Back', side: 'back', size: 'back', cx: 0.5, top: 0.17, w: 0.36 },
    { id: 'back-neck', label: 'Back yoke', side: 'back', size: 'back-neck', cx: 0.5, top: 0.08, w: 0.17 },
    ...sleeves('sleeve-short', 0.2, 0.11, 0.1),
  ],
  longsleeve: [
    { id: 'front', label: 'Front', side: 'front', size: 'full-front', cx: 0.5, top: 0.13, w: 0.34 },
    ...chest(0.14, 0.13, 0.11),
    { id: 'back', label: 'Back', side: 'back', size: 'back', cx: 0.5, top: 0.13, w: 0.34 },
    { id: 'back-neck', label: 'Back neck', side: 'back', size: 'back-neck', cx: 0.5, top: 0.04, w: 0.16 },
    ...sleeves('sleeve-long', 0.34, 0.12, 0.085),
  ],
  crew: [
    { id: 'front', label: 'Front', side: 'front', size: 'full-front', cx: 0.5, top: 0.15, w: 0.34 },
    ...chest(0.16, 0.13, 0.11),
    { id: 'back', label: 'Back', side: 'back', size: 'back', cx: 0.5, top: 0.14, w: 0.34 },
    { id: 'back-neck', label: 'Back neck', side: 'back', size: 'back-neck', cx: 0.5, top: 0.05, w: 0.16 },
    ...sleeves('sleeve-long', 0.36, 0.115, 0.085),
  ],
  hoodie: [
    { id: 'front', label: 'Front', side: 'front', size: 'hoodie-front', cx: 0.5, top: 0.31, w: 0.38 },
    ...chest(0.3, 0.15, 0.12),
    { id: 'back', label: 'Back', side: 'back', size: 'back', cx: 0.5, top: 0.27, w: 0.38 },
    ...sleeves('sleeve-long', 0.45, 0.1, 0.09),
  ],
  // Full-zip hoodies and jackets: no full front across the zipper.
  zip: [
    ...chest(0.3, 0.15, 0.12),
    { id: 'back', label: 'Back', side: 'back', size: 'back', cx: 0.5, top: 0.27, w: 0.38 },
    ...sleeves('sleeve-long', 0.45, 0.1, 0.09),
  ],
  tank: [
    { id: 'front', label: 'Front', side: 'front', size: 'tank-front', cx: 0.5, top: 0.22, w: 0.5 },
    ...chest(0.23, 0.19, 0.17),
    { id: 'back', label: 'Back', side: 'back', size: 'back', cx: 0.5, top: 0.18, w: 0.5 },
    { id: 'back-neck', label: 'Back neck', side: 'back', size: 'back-neck', cx: 0.5, top: 0.1, w: 0.24 },
  ],
  cap: [
    { id: 'front', label: 'Front', side: 'front', size: 'hat-front', cx: 0.5, top: 0.24, w: 0.34 },
    { id: 'left-side', label: 'Left side', side: 'front', size: 'hat-side', cx: 0.88, top: 0.3, w: 0.15 },
    { id: 'right-side', label: 'Right side', side: 'front', size: 'hat-side', cx: 0.12, top: 0.3, w: 0.15 },
    { id: 'back', label: 'Back', side: 'back', size: 'hat-back', cx: 0.5, top: 0.38, w: 0.2 },
  ],
  beanie: [
    { id: 'front', label: 'Front', side: 'front', size: 'beanie-cuff', cx: 0.5, top: 0.65, w: 0.34 },
    { id: 'back', label: 'Back', side: 'back', size: 'beanie-cuff', cx: 0.5, top: 0.65, w: 0.34 },
  ],
  bag: [
    { id: 'front', label: 'Front', side: 'front', size: 'bag-side', cx: 0.5, top: 0.48, w: 0.7 },
    { id: 'back', label: 'Back', side: 'back', size: 'bag-side', cx: 0.5, top: 0.48, w: 0.7 },
  ],
  pants: [
    { id: 'left-leg', label: 'Left leg', side: 'front', size: 'leg', cx: 0.75, top: 0.17, w: 0.16 },
    { id: 'right-leg', label: 'Right leg', side: 'front', size: 'leg', cx: 0.25, top: 0.17, w: 0.16 },
    { id: 'back', label: 'Back', side: 'back', size: 'pants-back', cx: 0.5, top: 0.1, w: 0.27 },
  ],
};

/** Which template a catalog product uses. */
export function templateFor(category: string, subcategory = '', name = ''): keyof typeof TEMPLATES {
  const sub = subcategory.toLowerCase();
  const n = name.toLowerCase();
  if (category === 'hats') return sub === 'beanies' || /beanie|knit/.test(n) ? 'beanie' : 'cap';
  if (category === 'accessories') return 'bag';
  if (category === 'pants') return 'pants';
  if (category === 'outerwear' || sub === 'zip-hoodies' || /full[- ]zip/.test(n)) return 'zip';
  if (sub === 'hoodies' || /hood/.test(n)) return 'hoodie';
  if (sub === 'crewnecks' || /crewneck|sweatshirt/.test(n)) return 'crew';
  if (sub === 'long-sleeves' || /long sleeve/.test(n)) return 'longsleeve';
  if (sub === 'polos' || /polo/.test(n)) return 'polo';
  if (sub === 'tank-tops' || /tank/.test(n)) return 'tank';
  return 'tee';
}

/** One location as the browser uses it: position on the photo plus its size in inches. */
export interface DesignSpot { id: string; label: string; side: Side; cx: number; top: number; w: number; wIn: number; hIn: number }

export function spotsFor(p: { category: string; subcategory?: string | null; name: string }): DesignSpot[] {
  const scale = p.category === 'kids' ? YOUTH_SCALE : 1;
  const round = (n: number) => Math.round(n * scale * 4) / 4;
  return TEMPLATES[templateFor(p.category, p.subcategory ?? '', p.name)].map(({ size, ...s }) => ({
    ...s, wIn: round(PRINT_SIZES[size].w), hIn: round(PRINT_SIZES[size].h),
  }));
}
