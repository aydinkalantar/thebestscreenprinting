/**
 * Size charts (measurements per size) come with each product from the studio catalog
 * (npm run sync:catalog). The studio ties each chart to its supplier style (styleId)
 * and trims it to the sizes the product sells; this page shows a chart only when it
 * carries that styleId (older copies mixed every style's specs together) and trims
 * it again here, so a stale catalog never shows hat, youth or pants columns.
 * Same rules as the studio's lib/size-chart.ts fitChart().
 */

export type SizeChart = { sizes: string[]; rows: { name: string; values: string[] }[]; styleId?: number };

/** "XXL" → "2XL", "X-Large" → "XL", "small" → "S". */
export function sizeKey(raw: string): string {
  let s = String(raw).toUpperCase().replace(/[\s.-]+/g, '').replace(/^EXTRA/, 'X').replace(/SMALL$/, 'S').replace(/MEDIUM$/, 'M').replace(/LARGE$/, 'L');
  const xs = s.match(/^(X+)(S|L)$/);
  if (xs && xs[1].length > 1) s = `${xs[1].length}X${xs[2]}`;
  const nx = s.match(/^(\d)X$/);
  if (nx) s = `${nx[1]}XL`;
  return s === '1XL' ? 'XL' : s === '1XS' ? 'XS' : s;
}

const MEASURE = /^\d{1,3}(\.\d{1,3})?(\s*(\d{1,2}\/\d{1,2}|[¼½¾⅛⅜⅝⅞]))?"?(\s*[-–]\s*\d{1,3}(\.\d{1,3})?(\s*(\d{1,2}\/\d{1,2}|[¼½¾⅛⅜⅝⅞]))?"?)?$/;
function cleanMeasure(raw: unknown): string {
  const v = String(raw ?? '').replace(/\s+/g, ' ').trim().replace(/[″”]/g, '"');
  return MEASURE.test(v) ? v.replace(/"/g, '').replace(/\s*[-–]\s*/g, '–').trim() : '';
}

/** The chart to show: only the sizes sold (as the product names them), only real measurements, only well-filled rows. */
export function fitChart(chart: SizeChart | null | undefined, sold: string[]): SizeChart | null {
  if (!chart || !chart.styleId || !Array.isArray(chart.sizes) || !Array.isArray(chart.rows)) return null;
  const at = new Map<string, number>();
  chart.sizes.forEach((s, i) => { const k = sizeKey(s); if (!at.has(k)) at.set(k, i); });
  const cols = sold.map((label) => ({ label, i: at.get(sizeKey(label)) })).filter((c): c is { label: string; i: number } => c.i !== undefined);
  if (!cols.length) return null;
  const seen = new Set<string>();
  let rows = chart.rows
    .map((r) => ({ name: String(r?.name ?? '').replace(/\s*\(.*$/, '').trim(), values: cols.map((c) => cleanMeasure(Array.isArray(r?.values) ? r.values[c.i] : '')) }))
    .filter((r) => { const k = r.name.toLowerCase(); if (!r.name || seen.has(k)) return false; seen.add(k); return true; })
    .filter((r) => r.values.filter(Boolean).length >= Math.max(1, Math.ceil(cols.length * 0.75)));
  const keep = cols.map((_, j) => rows.some((r) => r.values[j]));
  const sizes = cols.filter((_, j) => keep[j]).map((c) => c.label);
  rows = rows.map((r) => ({ ...r, values: r.values.filter((_, j) => keep[j]) }));
  return sizes.length && rows.length ? { sizes, rows, styleId: chart.styleId } : null;
}
