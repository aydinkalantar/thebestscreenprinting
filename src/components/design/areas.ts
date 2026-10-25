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

// ── Measured placement ─────────────────────────────────────────────────────────────────────
// On collar garments the preview measures the photo instead of using the fractions below:
// it finds the collar and the body width at the chest, and turns the body width into a scale
// with CHEST_FLAT_IN (the chest measured flat, armpit to armpit, on the size the photo shows).
// Then each print area goes the number of inches in PLACEMENT below the collar. The fractions
// in TEMPLATES are only the fallback when a photo can't be measured.

/** Chest width laid flat (inches) of the photographed sample: what one body width in the photo is. */
export const CHEST_FLAT_IN = { adult: 20, womens: 18.5, youth: 16 };

/**
 * S&S photos show the garment on a form, so its front looks narrower than the garment laid flat:
 * the chest you see on the photo is about this share of the flat chest. (Lower = bigger areas.)
 */
export const PHOTO_WIDTH_SHARE = 0.82;

/**
 * Garment length ÷ visible chest width on S&S photos (measured over the catalog). Used for the
 * scale when the chest can't be measured, e.g. sweatshirt sleeves hanging against the body.
 * womens / youth / crop multiply the base value.
 */
export const PHOTO_LENGTH_RATIO: Record<string, number> = {
  tee: 2.08, polo: 2.11, longsleeve: 2.07, crew: 2.04, hoodie: 2.15, zip: 2.15, tank: 2.2,
  womens: 1.15, youth: 0.9, crop: 0.7,
};

/**
 * Where the "collar point" is, per template:
 *   frontDrop: closed necks (tees, crews, polos). On a front photo the center of the garment first
 *              meets the inside of the back collar; the front neckline is this many inches lower.
 *   hood:      hooded garments. The hood hides the collar, so it is measured from the shoulder
 *              line instead: front/back = inches below the shoulder line taken as the collar,
 *              but never higher than minShare of the garment's length below the top of the hood
 *              (the hood drapes lower at the center than its outline shows).
 *   openDrop:  open necklines (tanks, scoops) are found on the photo: the lowest point of the front
 *              neckline between the straps. On dark colors where that edge can't be seen, the
 *              collar point is this many inches below the first fabric at the center.
 *   tankArmhole: tanks only. The front neckline is at most this many inches above the lowest point
 *              of the armholes (deep scoops can look like the front on the photo).
 * Closed collars are also looked for on the photo (where the shadowed inside of the back neck
 * meets the lit front); frontDrop is only used when that can't be seen.
 */
export const NECK: Record<string, { frontDrop: number; openDrop: number; tankArmhole?: number; hood?: { front: number; back: number; minShare: number } }> = {
  tee: { frontDrop: 2, openDrop: 1.5 },
  polo: { frontDrop: 3, openDrop: 1.5 },
  longsleeve: { frontDrop: 2, openDrop: 1.5 },
  crew: { frontDrop: 2, openDrop: 1.5 },
  hoodie: { frontDrop: 2, openDrop: 1.5, hood: { front: 2.5, back: 3, minShare: 0.25 } },
  zip: { frontDrop: 2, openDrop: 1.5, hood: { front: 2.5, back: 3, minShare: 0.25 } },
  tank: { frontDrop: 3.5, openDrop: 2, tankArmhole: 1.5 },
};

/**
 * Inches from the collar point to the TOP of each print area (front areas from the front collar,
 * back areas from the back collar). `crop` replaces `dy` on crop tops; `dx` is inches from the
 * body's center line (+ = viewer's right, which is the wearer's left on the front photo).
 * Sleeves are found on the photo (the part of the garment outside the torso).
 * Youth garments use 80% of these distances (YOUTH_SCALE).
 */
type Offset = { dy: number; crop?: number; dx?: number; sleeve?: 'short' | 'long' };
const FRONT_TEE: Record<string, Offset> = {
  front: { dy: 3, crop: 2 },
  'left-chest': { dy: 3.5, crop: 3, dx: 4 },
  'right-chest': { dy: 3.5, crop: 3, dx: -4 },
  back: { dy: 4, crop: 3 },
  'back-neck': { dy: 1 },
};
export const PLACEMENT: Record<string, Record<string, Offset>> = {
  tee: { ...FRONT_TEE, 'left-sleeve': { dy: 0, sleeve: 'short' }, 'right-sleeve': { dy: 0, sleeve: 'short' } },
  longsleeve: { ...FRONT_TEE, 'left-sleeve': { dy: 0, sleeve: 'long' }, 'right-sleeve': { dy: 0, sleeve: 'long' } },
  crew: { ...FRONT_TEE, 'left-sleeve': { dy: 0, sleeve: 'long' }, 'right-sleeve': { dy: 0, sleeve: 'long' } },
  // Polos: the full front sits below the placket, the chest prints beside it.
  polo: { ...FRONT_TEE, front: { dy: 8 }, 'left-chest': { dy: 5, dx: 4 }, 'right-chest': { dy: 5, dx: -4 }, back: { dy: 5 }, 'back-neck': { dy: 2.5 }, 'left-sleeve': { dy: 0, sleeve: 'short' }, 'right-sleeve': { dy: 0, sleeve: 'short' } },
  // Hoodies: the front print sits below the drawstrings.
  hoodie: { ...FRONT_TEE, front: { dy: 4.5 }, back: { dy: 4 }, 'left-sleeve': { dy: 0, sleeve: 'long' }, 'right-sleeve': { dy: 0, sleeve: 'long' } },
  zip: { ...FRONT_TEE, back: { dy: 4 }, 'left-sleeve': { dy: 0, sleeve: 'long' }, 'right-sleeve': { dy: 0, sleeve: 'long' } },
  tank: { ...FRONT_TEE, front: { dy: 2 }, 'left-chest': { dy: 2.5, dx: 3.5 }, 'right-chest': { dy: 2.5, dx: -3.5 }, back: { dy: 2.5 } },
};

/** Per-product fine tuning, from data/print-area-overrides.json (inches and ratios). */
export type SpotOverride = { dx?: number; dy?: number; scale?: number; fallback?: boolean };
export type Overrides = Record<string, SpotOverride> & {
  /** Whole product: chestIn replaces the chest width, *CollarDy moves the collar point, fallback uses the template. */
  '*'?: {
    chestIn?: number; frontCollarDy?: number; backCollarDy?: number; fallback?: boolean;
    /** Garment box (fractions of the photo: x, y, w, h) for the template, on every photo / only on the style photo. For photos on a model. */
    box?: { x: number; y: number; w: number; h: number };
    styleBox?: { x: number; y: number; w: number; h: number };
  };
};
export interface PlaceConfig { template: string; chestIn: number; crop: boolean; youth: boolean; womens: boolean; hood: boolean; overrides?: Overrides }

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
  if (/hood/.test(n)) return 'hoodie';
  if (sub === 'crewnecks' || /crewneck|sweatshirt/.test(n)) return 'crew';
  if (sub === 'hoodies') return 'hoodie';
  if (sub === 'polos' || /polo/.test(n)) return 'polo';
  if (sub === 'long-sleeves' || /long sleeve/.test(n)) return 'longsleeve';
  if (sub === 'tank-tops' || /tank/.test(n)) return 'tank';
  return 'tee';
}

/** Kids' garments: smaller print sizes and a smaller chest. */
export const isYouth = (p: { category: string; name: string }) => p.category === 'kids' || /\b(youth|toddler|infant|kids?)\b/i.test(p.name);

/** One location as the browser uses it: position on the photo plus its size in inches. */
export interface DesignSpot { id: string; label: string; side: Side; cx: number; top: number; w: number; wIn: number; hIn: number }

export function spotsFor(p: { category: string; subcategory?: string | null; name: string }): DesignSpot[] {
  const scale = isYouth(p) ? YOUTH_SCALE : 1;
  const round = (n: number) => Math.round(n * scale * 4) / 4;
  return TEMPLATES[templateFor(p.category, p.subcategory ?? '', p.name)].map(({ size, ...s }) => ({
    ...s, wIn: round(PRINT_SIZES[size].w), hIn: round(PRINT_SIZES[size].h),
  }));
}

/** Measured-placement settings for a product (null for hats, bags and pants: template only). */
export function placeConfigFor(p: { id?: string; category: string; subcategory?: string | null; name: string }, overrides?: Overrides): PlaceConfig | null {
  const template = templateFor(p.category, p.subcategory ?? '', p.name);
  if (!PLACEMENT[template]) return null;
  const youth = isYouth(p);
  const womens = p.category === 'womens' || /women|ladies/i.test(p.name);
  return {
    template, youth, womens, hood: template === 'hoodie' || /hood/i.test(p.name), crop: /\bcrop/i.test(p.name) || p.subcategory === 'crop-tops',
    chestIn: youth ? CHEST_FLAT_IN.youth : womens ? CHEST_FLAT_IN.womens : CHEST_FLAT_IN.adult,
    ...(overrides ? { overrides } : {}),
  };
}
