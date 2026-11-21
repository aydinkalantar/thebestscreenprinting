// One place for the shop's prices and terms on the website. {{key}} in page
// copy (Markdown body, frontmatter, .astro) is filled from src/data/facts.json,
// which `npm run build` refreshes from the live price engine
// (scripts/refresh-facts.mjs). Never type a price into page copy: use a token.
//
//   {{screenSetup}}          → $25          (money: a key listed in MONEY)
//   {{tee.screen1.24}}       → $11.50       (per-piece prices always show cents)
//   {{superRushMaxPieces}}   → 144          (plain numbers)
//   {{$ tee.screen1.48 × 50 + screenSetup}}       → $500    (a sum, whole dollars)
//   {{$. (tee.screen1.48 × 50 + screenSetup) / 50}} → $10.00  (a sum, with cents)
//   {{agent}}                → Max          (the merch agent's name, Admin › Settings › Max)
//   Shipping words follow Settings › Shipping (live carrier price, or flat + free threshold):
//   {{shipShort}}  → "Priced to your ZIP"          | "Free from $600"          (labels, chips)
//   {{shipNote}}   → "shipping priced to your ZIP" | "free shipping from $600" (mid-sentence)
//   {{shipPrice}}  → "at the carrier's price to your ZIP" | "free from $600"  (after "we ship anywhere…,")
//   {{shipBrief}}  → "the real carrier price…, shown at checkout" | "free from $600, $45 below that" (after "shipping is")
//   {{shipRule}}   → the whole rule as a sentence, without the final period
//   Never write "free shipping" or a shipping price into copy by hand.
// Use × (not *) to multiply, so Markdown never reads it as emphasis.
import facts from '../data/facts.json' with { type: 'json' };

const MONEY = new Set(['screenSetup', 'digitizing', 'shipFlat', 'shipFreeFrom', 'artCleanup', 'artLayout', 'artCustom', 'artRevision']);

function lookup(path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), facts);
}

const usd = (n, cents) => `$${n.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;

/**
 * The merch agent's name as the build last read it from the studio (Admin › Settings › Max),
 * wrapped in invisible word joiners. The edge (src/worker.ts) swaps every marked name for the
 * current one, so a rename shows on every page right away, without a new build.
 */
export const AGENT_MARK = '\u2060';
export const agentName = (typeof facts.agentName === 'string' && facts.agentName.trim()) || 'Max';
export const agent = `${AGENT_MARK}${agentName}${AGENT_MARK}`;
/** Words on the desktop chat button (Admin › Settings › Max › Chat button); "Talk to <name>" by default. */
export const launcher = (typeof facts.agentLauncher === 'string' && facts.agentLauncher.trim()) || `Talk to ${agent}`;

/** Shipping in words, from Settings › Shipping as the build read it (scripts/refresh-facts.mjs). */
export function shippingWords(f = facts) {
  const flat = usd(f.shipFlat ?? 0, !Number.isInteger(f.shipFlat ?? 0));
  const free = f.shipFreeFrom > 0 ? usd(f.shipFreeFrom, !Number.isInteger(f.shipFreeFrom)) : '';
  if (f.shipLive) {
    return {
      shipShort: 'Priced to your ZIP',
      shipNote: 'shipping priced to your ZIP',
      shipPrice: "at the carrier's price to your ZIP",
      shipBrief: 'the real UPS or USPS price for your boxes to your ZIP, shown at checkout before you pay',
      shipRule: 'Shipping is the real UPS or USPS price for your boxes to your ZIP, shown at checkout before you pay',
    };
  }
  if (free) {
    return {
      shipShort: `Free from ${free}`,
      shipNote: `free shipping from ${free}`,
      shipPrice: `free from ${free}`,
      shipBrief: `free from ${free}, ${flat} below that`,
      shipRule: `Shipping is free on orders of ${free} or more in the lower 48 states and a flat ${flat} below that`,
    };
  }
  return { shipShort: `${flat} flat`, shipNote: `${flat} flat shipping`, shipPrice: `for a flat ${flat}`, shipBrief: `a flat ${flat}`, shipRule: `Shipping is a flat ${flat} per order` };
}
const SHIP_WORDS = shippingWords();

export function fact(token) {
  if (token === 'agent') return agent;
  if (token in SHIP_WORDS) return SHIP_WORDS[token];
  const v = lookup(token);
  if (typeof v !== 'number') throw new Error(`Unknown fact {{${token}}}: add it to src/data/facts.json`);
  if (token.startsWith('tee.')) return usd(v, true);
  if (MONEY.has(token)) return usd(v, !Number.isInteger(v));
  return String(v);
}

/** {{$ expr}} / {{$. expr}}: sums of facts, e.g. a 50-piece total with the screen. */
function money(expr, cents) {
  const math = expr.replace(/×/g, '*').replace(/[a-zA-Z][a-zA-Z0-9_.]*/g, (path) => {
    const v = lookup(path);
    if (typeof v !== 'number') throw new Error(`Unknown fact ${path} in {{$ ${expr}}}: add it to src/data/facts.json`);
    return String(v);
  });
  if (!/^[\d.\s+\-*/()]+$/.test(math)) throw new Error(`Bad fact expression {{$ ${expr}}}`);
  const n = Function(`"use strict"; return (${math});`)();
  return usd(cents ? Math.round(n * 100) / 100 : Math.round(n), cents);
}

const TOKEN = /\{\{\s*(\$\.?)?\s*([^{}]+?)\s*\}\}/g;

/** Replace every {{token}} in a string. */
export function fill(text) {
  if (typeof text !== 'string') return text;
  return text.replace(TOKEN, (_, sign, body) => (sign ? money(body, sign === '$.') : fact(body)));
}

/** Remark plugin: fill tokens in Markdown text, link text and table cells. */
export function remarkFacts() {
  const walk = (node) => {
    if ((node.type === 'text' || node.type === 'inlineCode' || node.type === 'html') && typeof node.value === 'string') node.value = fill(node.value);
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  return (tree) => walk(tree);
}

export { facts };
