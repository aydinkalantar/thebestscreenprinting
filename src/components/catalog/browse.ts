// Build-time helpers for the catalog browser: color families and decoration filters.
import type { CatalogProduct } from '../../lib/catalog';

export const COLOR_FAMILIES = [
  { id: 'black', label: 'Black', hex: '#111111' },
  { id: 'white', label: 'White', hex: '#ffffff' },
  { id: 'gray', label: 'Gray', hex: '#9ca3af' },
  { id: 'navy', label: 'Navy', hex: '#1e2a4a' },
  { id: 'blue', label: 'Blue', hex: '#2f6fd6' },
  { id: 'red', label: 'Red', hex: '#c62828' },
  { id: 'green', label: 'Green', hex: '#2e7d32' },
  { id: 'pink-purple', label: 'Pink/Purple', hex: '#b04fc4' },
  { id: 'brown-tan', label: 'Brown/Tan', hex: '#a07850' },
  { id: 'yellow-orange', label: 'Yellow/Orange', hex: '#f2a516' },
] as const;
export type ColorFamily = (typeof COLOR_FAMILIES)[number]['id'];

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

/** Maps a swatch hex to one of the shopper-facing color families. */
export function colorFamily(hex: string): ColorFamily | null {
  const v = hsl(hex);
  if (!v) return null;
  const [h, s, l] = v;
  if (l < 0.1 || (l < 0.17 && s < 0.2)) return 'black';
  if (l > 0.9 && s < 0.6) return 'white';
  if (s < 0.1 || (s < 0.16 && l > 0.25 && l < 0.85)) return 'gray';
  if (h >= 195 && h < 248 && l < 0.32) return 'navy';
  if ((h >= 345 || h < 45) && l < 0.25 && s < 0.25) return 'brown-tan'; // dark chocolate, espresso
  if (h >= 345 || h < 12) return l > 0.72 ? 'pink-purple' : 'red';
  if (h >= 300 && l < 0.3) return 'red'; // maroon, wine
  if (h < 68 && l > 0.78 && s < 0.7) return 'brown-tan'; // natural, cream, ivory
  if (h < 45) return (l < 0.42 && s < 0.7) || s < 0.45 ? 'brown-tan' : 'yellow-orange';
  if (h < 68) return s < 0.4 || l < 0.3 ? 'brown-tan' : 'yellow-orange';
  if (h < 175) return 'green';
  if (h < 248) return 'blue';
  return 'pink-purple';
}

export const productFamilies = (p: CatalogProduct) =>
  [...new Set(p.colors.map((c) => colorFamily(c.hex)).filter(Boolean) as ColorFamily[])];

/** Decoration filters, keyed by the catalog's technique codes. */
export const DECORATION_FILTERS = [
  { id: 'screen', label: 'Screen printing', codes: ['SCREEN'] },
  { id: 'embroidery', label: 'Embroidery', codes: ['EMBROIDERY'] },
  { id: 'dtg', label: 'DTG', codes: ['DTG'] },
  { id: 'dtf', label: 'DTF', codes: ['DTF', 'DTFILM'] },
  { id: 'heat', label: 'Heat transfer', codes: ['HTV'] },
] as const;

export const productDecorations = (p: CatalogProduct) =>
  DECORATION_FILTERS.filter((d) => d.codes.some((c) => p.techniques.includes(c))).map((d) => d.id);
