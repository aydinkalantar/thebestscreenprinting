// Snapshots our curated S&S Activewear styles (data/ss-styles.json) into
// data/catalog.json, which the static catalog pages are built from. Only public
// fields are kept: S&S returns our wholesale cost, which never reaches the site.
// Credentials: SS_ACCOUNT and SS_API_KEY from the environment, or from
// ~/.config/tbsp/ssactivewear.env. Usage: npm run sync:catalog
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';

const envFile = `${homedir()}/.config/tbsp/ssactivewear.env`;
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(SS_[A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const { SS_ACCOUNT, SS_API_KEY } = process.env;
if (!SS_ACCOUNT || !SS_API_KEY) throw new Error(`Set SS_ACCOUNT and SS_API_KEY (or fill in ${envFile}).`);

const API = 'https://api.ssactivewear.com/v2';
const IMG = 'https://cdn.ssactivewear.com/';
const auth = 'Basic ' + Buffer.from(`${SS_ACCOUNT}:${SS_API_KEY}`).toString('base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(path) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: auth } });
    if (res.ok) return res.json();
    if (attempt >= 3 || res.status < 500 && res.status !== 429) throw new Error(`S&S ${path}: ${res.status} ${await res.text()}`);
    await sleep(3000 * attempt);
  }
}

const clean = (s) => s.replace(/[®™©]/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const large = (p) => (p ? IMG + p.replace(/_fm\./, '_fl.') : null);

const curated = JSON.parse(readFileSync(new URL('../data/ss-styles.json', import.meta.url), 'utf8'));
const styles = await get('/styles/');
const byKey = new Map(styles.map((s) => [`${s.brandName}|${s.styleName}`.toLowerCase(), s]));

const products = [];
for (const c of curated) {
  const style = byKey.get(`${c.brand}|${c.style}`.toLowerCase());
  if (!style) { console.warn(`skip: ${c.brand} ${c.style} not found at S&S`); continue; }
  await sleep(1100); // S&S allows 60 requests a minute
  const skus = await get(`/products/?styleid=${style.styleID}`);
  const colors = new Map();
  const sizes = new Map();
  for (const k of skus) {
    if (k.qty > 0 && !colors.has(k.colorName)) colors.set(k.colorName, { name: k.colorName, hex: k.color1 || null, image: large(k.colorFrontImage) });
    if (!sizes.has(k.sizeName)) sizes.set(k.sizeName, k.sizeOrder);
  }
  const features = [...(style.description || '').matchAll(/<li>(.*?)<\/li>/g)].map((m) => clean(m[1].replace(/<[^>]+>/g, ''))).filter(Boolean).slice(0, 8);
  const colorList = [...colors.values()];
  const name = `${style.brandName} ${style.styleName} ${clean(style.title)}`;
  products.push({
    id: `ss-${style.styleID}`,
    slug: slugify(name),
    name,
    brand: style.brandName,
    style: style.styleName,
    category: c.category,
    subcategory: c.subcategory,
    type: style.baseCategory,
    techniques: c.techniques,
    image: large(style.styleImage),
    images: colorList.map((x) => x.image).filter(Boolean).slice(0, 6),
    colors: colorList,
    sizes: [...sizes.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([n]) => n),
    features,
    featured: c.featured,
  });
  process.stdout.write('.');
}

products.sort((a, b) => Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name));
writeFileSync(new URL('../data/catalog.json', import.meta.url), JSON.stringify({ syncedAt: new Date().toISOString(), source: 'S&S Activewear', products }, null, 1));
console.log(`\n${products.length} products from S&S Activewear`);
