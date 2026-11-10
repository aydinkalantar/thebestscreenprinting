// Build-time helpers for the catalog browser: color, fabric and decoration filters.
import type { CatalogProduct } from '../../lib/catalog';
import { COLOR_GROUPS, FABRICS, colorGroup, productFabric } from '../../lib/search';

/** Color filter: the same color words the search understands ("pink", "navy", "tan & cream"). */
export const COLOR_FAMILIES = COLOR_GROUPS.map(({ id, label, hex }) => ({ id, label, hex }));
export type ColorFamily = (typeof COLOR_GROUPS)[number]['id'];

/** Every color group a product comes in (a two-tone cap counts for each of its colors). */
export const productFamilies = (p: CatalogProduct) =>
  [...new Set(p.colors.flatMap((c) => colorGroup(c.name, c.hex ?? '').split(' ')).filter(Boolean))] as ColorFamily[];

export const FABRIC_FILTERS = FABRICS.map(({ id, label }) => ({ id, label }));
export const productFabricId = (p: CatalogProduct) => productFabric(p.name, p.features ?? []) ?? '';

/** Decoration filters, keyed by the catalog's technique codes. */
export const DECORATION_FILTERS = [
  { id: 'screen', label: 'Screen printing', codes: ['SCREEN'] },
  { id: 'embroidery', label: 'Embroidery', codes: ['EMBROIDERY'] },
  { id: 'dtg', label: 'DTG', codes: ['DTG'] },
  { id: 'dtf', label: 'DTF', codes: ['DTF', 'DTFILM'] },
] as const;

export const productDecorations = (p: CatalogProduct) =>
  DECORATION_FILTERS.filter((d) => d.codes.some((c) => p.techniques.includes(c))).map((d) => d.id);
