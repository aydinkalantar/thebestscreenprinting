// One place for the shop's prices and terms on the website. {{key}} in page
// copy (Markdown body, frontmatter, .astro) is filled from src/data/facts.json,
// which `npm run build` refreshes from the live price engine
// (scripts/refresh-facts.mjs). Never type a price into page copy: use a token.
//
//   {{screenSetup}}          → $25          (money: a key listed in MONEY)
//   {{tee.screen1.24}}       → $11.50       (per-piece prices always show cents)
//   {{digitizingFreeFrom}}   → 24           (plain numbers)
//   {{$ tee.screen1.48 × 50 + screenSetup}}       → $500    (a sum, whole dollars)
//   {{$. (tee.screen1.48 × 50 + screenSetup) / 50}} → $10.00  (a sum, with cents)
// Use × (not *) to multiply, so Markdown never reads it as emphasis.
import facts from '../data/facts.json' with { type: 'json' };

const MONEY = new Set(['screenSetup', 'digitizing', 'shipFlat', 'shipFreeFrom', 'artCleanup', 'artLayout', 'artCustom', 'artRevision']);

function lookup(path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), facts);
}

const usd = (n, cents) => `$${n.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;

export function fact(token) {
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
