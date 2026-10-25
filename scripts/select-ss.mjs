// Builds data/ss-styles.json: the hand-picked styles first, then the best of S&S
// by category from decoration brands, up to a quota per category. Run once in a
// while (node scripts/select-ss.mjs), then npm run sync:catalog to pull the details.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';

const envFile = `${homedir()}/.config/tbsp/ssactivewear.env`;
if (existsSync(envFile)) for (const l of readFileSync(envFile, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*(SS_[A-Z_]+)\s*=\s*(.*?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const auth = 'Basic ' + Buffer.from(`${process.env.SS_ACCOUNT}:${process.env.SS_API_KEY}`).toString('base64');
const styles = await (await fetch('https://api.ssactivewear.com/v2/styles/', { headers: { Authorization: auth } })).json();

// Brands customers ask us to decorate, best first (ties in a category go to the earlier brand).
const BRANDS = ['Gildan', 'BELLA + CANVAS', 'Comfort Colors', 'Next Level', 'Independent Trading Co.', 'Champion', 'Hanes', 'JERZEES',
  'American Apparel', 'Shaka Wear', 'Los Angeles Apparel', 'Lane Seven', 'Richardson', 'YP Classics', 'Flexfit', 'Sportsman', 'Atlantis Headwear',
  'Valucap', 'Big Accessories', 'Adidas', 'Under Armour', 'Columbia', 'Puma Golf', 'Harriton', 'CORE365', 'Devon & Jones', 'Team 365',
  'Augusta Sportswear', 'Badger', 'Russell Athletic', 'Holloway', 'Boxercraft', 'J. America', 'Rabbit Skins', 'Live & Tell by LAT', 'Tultex',
  'Threadfast Apparel', 'econscious', 'MV Sport', 'Alternative', 'Liberty Bags', 'Q-Tees', 'BAGedge', 'North End', 'DRI DUCK', 'Burnside', 'C2 Sport'];
const rank = new Map(BRANDS.map((b, i) => [b.toLowerCase(), i]));

const T = ['SCREEN', 'DTG', 'DTF', 'HTV'], F = ['SCREEN', 'DTF', 'EMBROIDERY', 'HTV'], H = ['EMBROIDERY'], P = ['EMBROIDERY', 'SCREEN', 'DTF'], B = ['SCREEN', 'DTF'], O = ['EMBROIDERY', 'SCREEN', 'DTF'];
const has = (t, re) => re.test(t);
/** S&S base category + title → our category, subcategory, decoration methods. */
function classify(s) {
  const t = `${s.title}`.toLowerCase(), base = s.baseCategory;
  const kid = has(t, /\b(youth|toddler|infant|kids?|baby)\b/), women = has(t, /\b(women'?s|ladies'?)\b/);
  if (base.startsWith('T-Shirts')) {
    const sub = has(t, /\btank\b/) ? 'tank-tops' : has(t, /\bcrop\b/) ? 'crop-tops' : base === 'T-Shirts - Long Sleeve' || has(t, /long sleeve/) ? 'long-sleeves' : 't-shirts';
    return { category: kid ? 'kids' : women ? 'womens' : 'apparel', subcategory: kid || women ? (sub === 'long-sleeves' ? 't-shirts' : sub) : sub, techniques: T };
  }
  if (base.startsWith('Fleece')) {
    const sub = base.endsWith('Crew') ? 'crewnecks' : has(t, /full-zip|full zip/) ? 'zip-hoodies' : 'hoodies';
    return { category: kid ? 'kids' : women ? 'womens' : 'sweatshirts', subcategory: kid || women ? 'hoodies' : sub, techniques: F };
  }
  if (base === 'Polos') return kid ? null : { category: women ? 'womens' : 'apparel', subcategory: 'polos', techniques: P };
  if (base === 'Headwear') {
    if (has(t, /visor|bucket|boonie|headband|scarf|gaiter|bandana/)) return null;
    const sub = has(t, /beanie|knit|cuffed/) ? 'beanies' : has(t, /trucker|mesh/) ? 'trucker-hats' : has(t, /dad|unstructured|garment-washed|relaxed/) ? 'dad-hats' : has(t, /flexfit|fitted/) ? 'fitted-hats' : 'snapbacks';
    return { category: 'hats', subcategory: sub, techniques: H };
  }
  if (base === 'Bags') return has(t, /tote|bag|backpack|drawstring|duffel|sack|pack/) ? { category: 'accessories', subcategory: 'totes', techniques: B } : null;
  if (base === 'Bottoms') return kid || has(t, /skirt|legging|scrub|cargo work|work pant/) ? null : { category: 'pants', subcategory: has(t, /short/) ? 'shorts' : 'sweatpants', techniques: O };
  if (base === 'Outerwear') return kid ? null : { category: 'outerwear', subcategory: 'jackets', techniques: O };
  return null;
}
const QUOTA = { 'apparel/t-shirts': 70, 'apparel/long-sleeves': 30, 'apparel/tank-tops': 15, 'apparel/polos': 40, 'sweatshirts/hoodies': 50, 'sweatshirts/zip-hoodies': 15,
  'sweatshirts/crewnecks': 30, 'hats/trucker-hats': 20, 'hats/dad-hats': 15, 'hats/snapbacks': 15, 'hats/fitted-hats': 6, 'hats/beanies': 15, 'accessories/totes': 25,
  'pants/sweatpants': 15, 'pants/shorts': 10, 'outerwear/jackets': 30, 'womens/t-shirts': 20, 'womens/tank-tops': 6, 'womens/crop-tops': 4, 'womens/hoodies': 8,
  'womens/polos': 8, 'kids/t-shirts': 15, 'kids/hoodies': 10, 'kids/tank-tops': 2 };

const curated = JSON.parse(readFileSync(new URL('../data/ss-styles-curated.json', import.meta.url), 'utf8'));
const key = (b, st) => `${b}|${st}`.toLowerCase();
const taken = new Set(curated.map((c) => key(c.brand, c.style)));
const count = {};
for (const c of curated) count[`${c.category}/${c.subcategory}`] = (count[`${c.category}/${c.subcategory}`] || 0) + 1;

const picks = styles
  .filter((s) => rank.has(s.brandName.toLowerCase()) && !taken.has(key(s.brandName, s.styleName)) && !s.noeRetailing)
  .map((s) => ({ s, c: classify(s) }))
  .filter((x) => x.c)
  .sort((a, b) => rank.get(a.s.brandName.toLowerCase()) - rank.get(b.s.brandName.toLowerCase()) || Number(b.s.newStyle) - Number(a.s.newStyle) || a.s.styleName.localeCompare(b.s.styleName));

const out = [...curated];
for (const { s, c } of picks) {
  const k = `${c.category}/${c.subcategory}`;
  if ((count[k] || 0) >= (QUOTA[k] ?? 0)) continue;
  count[k] = (count[k] || 0) + 1;
  out.push({ brand: s.brandName, style: s.styleName, ...c, featured: false });
}
writeFileSync(new URL('../data/ss-styles.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(`${out.length} styles (${curated.length} hand-picked)`, count);
