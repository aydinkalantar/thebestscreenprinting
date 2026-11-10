// Product search shared by the header search box and the /search/ results page.
// It reads what the shopper typed the way a person would: color words ("pink", "heather grey"),
// brands ("bella canvas"), style numbers ("5000"), product types ("hoodie", "dad hat") and
// fabrics ("100% cotton", "tri-blend"). Whatever is left must appear in the product's text.
// The index it searches is /search-index.json (src/pages/search-index.json.ts).

/** One product row of the index. Colors: [name, hex without #, photo, color group]. */
export type SearchColor = [name: string, hex: string, img: string, group: string];
export type SearchProduct = {
  k: 'product'; id: string; t: string; u: string; i?: string; s?: string; w?: string; f?: 1;
  b?: string; st?: string; c: string[]; fb?: string; co: SearchColor[];
};

/* ---------- Colors ---------- */

/** Shopper color words, in the order the filter shows them. */
export const COLOR_GROUPS = [
  { id: 'black', label: 'Black', hex: '#111111', words: ['black', 'jet', 'onyx'] },
  { id: 'white', label: 'White', hex: '#ffffff', words: ['white'] },
  { id: 'gray', label: 'Gray', hex: '#9ca3af', words: ['gray', 'grey', 'charcoal', 'ash', 'silver', 'graphite', 'slate', 'smoke', 'heather gray', 'heather grey'] },
  { id: 'navy', label: 'Navy', hex: '#1e2a4a', words: ['navy', 'midnight'] },
  { id: 'blue', label: 'Blue', hex: '#2f6fd6', words: ['blue', 'royal', 'sapphire', 'cobalt', 'sky', 'denim', 'indigo', 'carolina'] },
  { id: 'teal', label: 'Teal', hex: '#14918a', words: ['teal', 'turquoise', 'aqua', 'seafoam', 'jade', 'cyan'] },
  { id: 'green', label: 'Green', hex: '#2e7d32', words: ['green', 'kelly', 'forest', 'olive', 'lime', 'mint', 'sage', 'army', 'military', 'hunter', 'moss', 'camo'] },
  { id: 'yellow', label: 'Yellow', hex: '#f5d020', words: ['yellow', 'lemon', 'butter', 'banana', 'daisy', 'mustard'] },
  { id: 'gold', label: 'Gold', hex: '#d4a017', words: ['gold'] },
  { id: 'orange', label: 'Orange', hex: '#f57c00', words: ['orange', 'coral', 'peach', 'tangerine', 'rust', 'burnt orange', 'texas orange'] },
  { id: 'red', label: 'Red', hex: '#c62828', words: ['red', 'scarlet', 'crimson', 'cardinal', 'cherry'] },
  { id: 'maroon', label: 'Maroon', hex: '#6d1a2a', words: ['maroon', 'burgundy', 'wine', 'garnet', 'cranberry', 'oxblood'] },
  { id: 'pink', label: 'Pink', hex: '#f06ea9', words: ['pink', 'rose', 'fuchsia', 'magenta', 'azalea', 'heliconia', 'blush', 'flamingo', 'raspberry', 'watermelon', 'salmon', 'bubblegum', 'mauve'] },
  { id: 'purple', label: 'Purple', hex: '#7b3fb6', words: ['purple', 'violet', 'lavender', 'lilac', 'plum', 'orchid', 'grape', 'eggplant', 'amethyst'] },
  { id: 'brown', label: 'Brown', hex: '#6b4a2f', words: ['brown', 'chocolate', 'coffee', 'espresso', 'mocha', 'cocoa', 'camel'] },
  { id: 'tan', label: 'Tan & cream', hex: '#d8c3a0', words: ['tan', 'beige', 'khaki', 'sand', 'natural', 'cream', 'ivory', 'oatmeal', 'bone', 'stone', 'putty', 'heather oatmeal'] },
] as const;
export type ColorGroup = (typeof COLOR_GROUPS)[number]['id'];
/** Old /catalog/?color= values (before the finer groups) → today's groups. */
export const LEGACY_COLOR: Record<string, ColorGroup[]> = {
  'pink-purple': ['pink', 'purple'], 'brown-tan': ['brown', 'tan'], 'yellow-orange': ['yellow', 'orange', 'gold'],
};

function hsl(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = (hue * 60 + 360) % 360;
  return [hue, s, l];
}

/** The color group of a swatch from its hex alone. */
function groupFromHex(hex: string): ColorGroup | null {
  const v = hsl(hex);
  if (!v) return null;
  const [h, s, l] = v;
  if (l < 0.1 || (l < 0.17 && s < 0.2)) return 'black';
  if (l > 0.9 && s < 0.6) return 'white';
  if (s < 0.1 || (s < 0.16 && l > 0.25 && l < 0.85)) return 'gray';
  if (h >= 195 && h < 250 && l < 0.32) return 'navy';
  if ((h >= 340 || h < 45) && l < 0.25 && s < 0.25) return 'brown';
  if (h >= 330 || h < 12) {
    if (l > 0.68 || (h < 350 && h >= 330 && l > 0.42)) return 'pink';
    return l < 0.32 ? 'maroon' : 'red';
  }
  if (h >= 285) return l < 0.3 ? 'maroon' : h >= 305 ? 'pink' : 'purple';
  if (h < 68 && l > 0.78 && s < 0.7) return 'tan';
  if (h < 42) return (l < 0.42 && s < 0.7) || s < 0.45 ? (l > 0.55 ? 'tan' : 'brown') : l > 0.72 ? 'pink' : 'orange';
  if (h < 68) return s < 0.4 || l < 0.3 ? (l > 0.5 ? 'tan' : 'brown') : h < 50 && l < 0.55 ? 'gold' : 'yellow';
  if (h < 165) return 'green';
  if (h < 195) return 'teal';
  if (h < 255) return 'blue';
  return 'purple';
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9%+]+/g, ' ').trim();
const WORD_GROUP = new Map<string, ColorGroup>();
for (const g of COLOR_GROUPS) for (const w of g.words) WORD_GROUP.set(w, g.id);

/** The color group of one solid color: its name wins when it says a color outright. */
function solidGroup(name: string, hex: string): ColorGroup | null {
  const words = norm(name).split(' ');
  // The last color word wins: "Heather Navy" is navy, "Rose Gold" is gold; "Pink Lemonade" stays pink.
  for (let i = words.length - 1; i >= 0; i--) {
    const g = (i > 0 ? WORD_GROUP.get(`${words[i - 1]} ${words[i]}`) : undefined) ?? WORD_GROUP.get(words[i]);
    if (g) return g;
  }
  return groupFromHex(hex);
}

/**
 * Color groups of a catalog color, space-separated; the first is the main one.
 * Two-tone colors ("Black/ White/ Red" caps) belong to each of their parts.
 */
export function colorGroup(name: string, hex: string): string {
  const parts = name.split('/').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return solidGroup(name, hex) ?? '';
  const groups = parts.map((p, i) => solidGroup(p, i === 0 ? hex : '')).filter(Boolean) as string[];
  return [...new Set(groups)].join(' ');
}
const groupsOf = (c: SearchColor) => c[3].split(' ');

/* ---------- Product types, fabrics, brands ---------- */

/** Words shoppers type for each collection (src/lib/catalog.ts COLLECTIONS). */
export const TYPE_WORDS: Record<string, string[]> = {
  't-shirts': ['t shirt', 't shirts', 'tshirt', 'tshirts', 'tee', 'tees', 'tee shirt', 'shirt', 'shirts', 'short sleeve'],
  'long-sleeves': ['long sleeve', 'long sleeves', 'longsleeve'],
  hoodies: ['hoodie', 'hoodies', 'hoody', 'hooded', 'hooded sweatshirt', 'zip up', 'zip hoodie', 'pullover'],
  crewnecks: ['crewneck', 'crewnecks', 'crew neck', 'crew', 'sweatshirt', 'sweatshirts', 'sweater', 'sweaters'],
  polos: ['polo', 'polos', 'golf shirt'],
  hats: ['hat', 'hats', 'cap', 'caps', 'trucker', 'snapback', 'dad hat', 'fitted', 'baseball cap'],
  beanies: ['beanie', 'beanies', 'knit cap', 'toque', 'winter hat'],
  'tank-tops': ['tank', 'tanks', 'tank top', 'tank tops', 'crop top', 'sleeveless', 'muscle'],
  'sweatpants-shorts': ['sweatpants', 'joggers', 'jogger', 'pants', 'shorts', 'sweats'],
  jackets: ['jacket', 'jackets', 'windbreaker', 'coat', 'outerwear', 'vest'],
  bags: ['bag', 'bags', 'tote', 'totes', 'tote bag', 'backpack', 'drawstring'],
  womens: ['women', 'womens', 'ladies', 'woman'],
  kids: ['kid', 'kids', 'youth', 'toddler', 'child', 'children', 'infant', 'baby'],
};
/** Which collections each word means. "sweatshirt" covers hoodies too; "shirt" covers long sleeves. */
const TYPE_ALSO: Record<string, string[]> = {
  sweatshirt: ['hoodies'], sweatshirts: ['hoodies'], sweater: ['hoodies'], sweaters: ['hoodies'],
  shirt: ['long-sleeves', 'polos'], shirts: ['long-sleeves', 'polos'], pullover: ['crewnecks'],
};

export const FABRICS = [
  { id: 'cotton', label: '100% cotton', words: ['100% cotton', '100 cotton', 'all cotton', 'cotton', 'ringspun', 'ring spun'] },
  { id: 'blend', label: 'Cotton/poly blend', words: ['cotton poly', 'poly cotton', 'blend', '50 50', 'cvc', 'heavy blend'] },
  { id: 'poly', label: 'Polyester / performance', words: ['polyester', 'poly', 'performance', 'dri fit', 'drifit', 'moisture wicking', 'athletic', 'sport', 'dry'] },
  { id: 'triblend', label: 'Tri-blend', words: ['triblend', 'tri blend', 'tri blends'] },
  { id: 'fleece', label: 'Fleece', words: ['fleece'] },
] as const;

/**
 * A product's main fabric from its feature lines (first line is the fabric content).
 * Fleece is reported over the blend it is made of, since that is how people shop for it.
 */
export function productFabric(name: string, features: string[]): string | undefined {
  const head = norm(`${name} ${features.slice(0, 2).join(' ')}`);
  const all = norm(`${name} ${features.join(' ')}`);
  if (/\btri ?blend\b/.test(head) || /\brayon\b/.test(head)) return 'triblend';
  if (/\bfleece\b/.test(all) && /\b(hood|crew|sweat|jogger|pant|fleece)/.test(norm(name))) return 'fleece';
  const cotton = /\bcotton\b/.test(head), poly = /\bpolyester\b|\bpoly\b/.test(head);
  if (/100% (\w+ )*cotton|100% (combed |ring spun |ringspun |organic |us )*cotton/.test(head) && !/100% polyester/.test(head)) return 'cotton';
  if (/100% (recycled )?polyester/.test(head) || (poly && !cotton)) return 'poly';
  if (cotton && poly) return 'blend';
  if (cotton) return 'cotton';
  return undefined;
}

/* ---------- Query reading ---------- */

export type Query = {
  raw: string;
  colors: ColorGroup[];
  /** The color words as typed ("pink", "rose"), so "Neon Pink" shows before "Azalea". */
  colorWords: string[];
  /** A full color name the shopper typed ("sport grey", "neon pink"); matched by name. */
  shades: string[];
  brands: string[];
  types: string[];
  /** The product types as typed (types also holds the ones they imply: "shirt" → polos too). */
  typed: string[];
  fabrics: string[];
  words: string[];
};

export type Vocab = { brands: { name: string; keys: string[] }[]; shades: Set<string> };

/** Brand names and their short forms ("bella" for BELLA + CANVAS). Built from the index. */
export function vocabulary(items: SearchProduct[]): Vocab {
  const names = [...new Set(items.map((p) => p.b).filter(Boolean) as string[])];
  const brands = names.map((name) => {
    const n = norm(name).replace(/\band\b/g, ' ').replace(/\s+/g, ' ').trim();
    const keys = new Set([n, n.replace(/\s+/g, '')]);
    const first = n.split(' ')[0];
    // "bella", "comfort", "next", "independent", "american": the first word alone is enough when it is distinctive.
    if (first.length >= 4 && names.filter((x) => norm(x).startsWith(first)).length === 1 && !WORD_GROUP.has(first) && !['next', 'sport', 'under', 'lane'].includes(first)) keys.add(first);
    if (/^next level/.test(n)) keys.add('next level');
    if (/^bella/.test(n)) { keys.add('bella canvas'); keys.add('b c'); keys.add('bc'); }
    if (/^independent/.test(n)) keys.add('independent trading');
    if (/^under armour/.test(n)) keys.add('ua');
    return { name, keys: [...keys].sort((a, b) => b.length - a.length) };
  });
  const shades = new Set<string>();
  for (const p of items) for (const c of p.co) { const s = norm(c[0]); if (s.includes(' ')) shades.add(s); }
  return { brands, shades };
}

export function readQuery(raw: string, vocab: Vocab): Query {
  let text = ` ${norm(raw)} `;
  const q: Query = { raw, colors: [], colorWords: [], shades: [], brands: [], types: [], typed: [], fabrics: [], words: [] };
  const take = (phrase: string) => {
    const re = new RegExp(`(^| )${phrase.replace(/[+%]/g, (c) => `\\${c}`)}(?= |$)`);
    if (!re.test(text)) return false;
    text = text.replace(re, ' ');
    return true;
  };
  // Longest phrases first, so "heather grey" beats "grey" and "long sleeve" beats "sleeve".
  for (const b of vocab.brands) if (b.keys.some(take) && !q.brands.includes(b.name)) q.brands.push(b.name);
  for (const s of [...vocab.shades].sort((a, b) => b.length - a.length)) {
    // Only a shade whose words are all typed; "pink" alone is a color group, not "Neon Pink".
    if (s.split(' ').length > 1 && take(s)) q.shades.push(s);
  }
  const fabricWords = FABRICS.flatMap((f) => f.words.map((w) => [w, f.id] as const)).sort((a, b) => b[0].length - a[0].length);
  for (const [w, id] of fabricWords) if (take(w) && !q.fabrics.includes(id)) q.fabrics.push(id);
  const typeWords = Object.entries(TYPE_WORDS).flatMap(([slug, ws]) => ws.map((w) => [w, slug] as const)).sort((a, b) => b[0].length - a[0].length);
  for (const [w, slug] of typeWords) {
    if (!take(w)) continue;
    if (!q.typed.includes(slug)) q.typed.push(slug);
    for (const s of [slug, ...(TYPE_ALSO[w] ?? [])]) if (!q.types.includes(s)) q.types.push(s);
  }
  const colorWords = [...WORD_GROUP.keys()].sort((a, b) => b.length - a.length);
  for (const w of colorWords) {
    // "sport" is a fabric word above; plurals ("pinks", "blues") count too.
    if (take(w) || take(`${w}s`)) { const g = WORD_GROUP.get(w)!; if (!q.colors.includes(g)) q.colors.push(g); q.colorWords.push(w); }
  }
  const stop = new Set(['a', 'an', 'the', 'in', 'for', 'with', 'and', 'of', 'on', 'to', 'custom', 'printed', 'print', 'printing', 'my', 'logo', 'our', 'color', 'colors', 'colour']);
  q.words = text.split(' ').filter((w) => w && !stop.has(w));
  return q;
}

/* ---------- Matching ---------- */

export type Match = { p: SearchProduct; score: number; colors: SearchColor[] };

const AUDIENCE = new Set(['womens', 'kids']);
const has = (hay: string, w: string) => hay.includes(w) || (w.length > 3 && w.endsWith('s') && hay.includes(w.slice(0, -1)));

/** Products that fit the query, best first, each with the colors that matched (if any). */
export function searchProducts(items: SearchProduct[], q: Query): Match[] {
  const wantColor = q.colors.length > 0 || q.shades.length > 0;
  const out: Match[] = [];
  items.forEach((p, n) => {
    if (q.brands.length && !q.brands.includes(p.b ?? '')) return;
    // Garment words ("hoodie", "tee") and audience words ("kids", "women's") must both fit when both are typed.
    const garments = q.types.filter((t) => !AUDIENCE.has(t)), audiences = q.types.filter((t) => AUDIENCE.has(t));
    if (garments.length && !garments.some((t) => p.c.includes(t))) return;
    if (audiences.length && !audiences.some((t) => p.c.includes(t))) return;
    if (q.fabrics.length && !q.fabrics.includes(p.fb ?? '')) return;
    const title = norm(p.t);
    const hay = `${title} ${p.w ?? ''}`;
    let colors = wantColor
      ? p.co.filter((c) => groupsOf(c).some((g) => q.colors.includes(g as ColorGroup)) || q.shades.includes(norm(c[0])))
      : p.co;
    if (wantColor && !colors.length) return;
    let score = 0;
    for (const w of q.words) {
      const style = norm(p.st ?? '').replace(/\s+/g, '');
      if (style && (w === style || w.replace(/\s+/g, '') === style)) { score += 60; continue; }
      if (style && w.length >= 3 && style.startsWith(w)) { score += 25; continue; }
      if (has(hay, w)) { score += new Set(title.split(' ')).has(w) ? 10 : has(title, w) ? 4 : 1; continue; }
      // A word that names a shade ("heather", "neon", "vintage") narrows the colors.
      const named = colors.filter((c) => has(norm(c[0]), w));
      if (named.length) { colors = named; score += 3; continue; }
      return;
    }
    if (q.brands.length) score += 5;
    if (q.types.length) score += 5;
    // Solid colors count more than a trim color on a two-tone cap.
    if (wantColor) score += Math.min(colors.reduce((n, c) => n + (c[3].includes(' ') ? 0.3 : 1), 0), 12);
    // Order: colors named with the typed word ("Neon Pink"), then other solids, then two-tones.
    const named = (c: SearchColor) => q.colorWords.some((w) => new RegExp(`\\b${w}`).test(norm(c[0])));
    const rankColor = (c: SearchColor) => (named(c) ? 0 : 1) + (c[3].includes(' ') ? 2 : 0);
    if (wantColor) colors = [...colors].sort((a, b) => rankColor(a) - rankColor(b));
    if (p.f) score += 4;
    out.push({ p, score: score - n / 10000, colors: wantColor || q.words.length ? colors : [] });
  });
  return out.sort((a, b) => b.score - a.score);
}

/** "Pink", "Gildan", "Hoodies" … the parts of the query that were understood, for chips. */
export function describe(q: Query): { kind: 'color' | 'shade' | 'brand' | 'type' | 'fabric' | 'word'; id: string; label: string }[] {
  const typeLabel: Record<string, string> = {
    't-shirts': 'T-shirts', 'long-sleeves': 'Long sleeves', hoodies: 'Hoodies', crewnecks: 'Crewnecks', polos: 'Polos', hats: 'Hats',
    beanies: 'Beanies', 'tank-tops': 'Tank tops', 'sweatpants-shorts': 'Sweatpants & shorts', jackets: 'Jackets', bags: 'Bags & totes',
    womens: "Women's", kids: 'Kids & youth',
  };
  const cap = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
  const shown = q.typed;
  return [
    ...q.colors.map((id) => ({ kind: 'color' as const, id, label: COLOR_GROUPS.find((g) => g.id === id)!.label })),
    ...q.shades.map((id) => ({ kind: 'shade' as const, id, label: cap(id) })),
    ...q.brands.map((id) => ({ kind: 'brand' as const, id, label: id })),
    ...shown.map((id) => ({ kind: 'type' as const, id, label: typeLabel[id] ?? id })),
    ...q.fabrics.map((id) => ({ kind: 'fabric' as const, id, label: FABRICS.find((f) => f.id === id)!.label })),
    ...q.words.map((id) => ({ kind: 'word' as const, id, label: `“${id}”` })),
  ];
}

/** The query again without one understood part (a removed chip). */
export function without(q: Query, kind: string, id: string): string {
  return describe(q).filter((p) => !(p.kind === kind && p.id === id))
    .map((p) => (p.kind === 'word' ? p.id : p.label.replace(/[“”]/g, ''))).join(' ');
}

/** Photo URL for a color: a bare number is a catalog color photo served through /ss-img/. */
export const colorPhoto = (img: string) => (/^\d+$/.test(img) ? `/ss-img/Images/Color/${img}_f_fl.jpg` : img);
