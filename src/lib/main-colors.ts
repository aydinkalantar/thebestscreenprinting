// The colors most custom orders use come first on every product (and the page opens on the first):
// White, Black, Navy, heather gray, charcoal, royal, red, forest, maroon, light blue, natural.
// Brands name them differently (Sport Grey, Athletic Heather…), so each slot lists its names in
// order of preference and takes the first one the product has; everything else keeps the
// supplier's order after them.

const MAIN: string[][] = [
  ['white', 'solid white', 'white solid'],
  ['black', 'solid black', 'black solid', 'jet black'],
  ['navy', 'solid navy', 'true navy', 'classic navy', 'navy blue', 'dark navy'],
  ['sport grey', 'sport gray', 'athletic heather', 'heather grey', 'heather gray', 'grey heather', 'gray heather', 'athletic grey', 'athletic gray', 'oxford', 'ash'],
  ['charcoal', 'dark heather', 'heather charcoal', 'charcoal heather', 'dark grey heather', 'dark gray heather', 'graphite heather'],
  ['royal', 'true royal', 'royal blue'],
  ['red', 'true red', 'solid red', 'classic red', 'cherry red'],
  ['forest', 'forest green', 'dark green', 'hunter green', 'hunter'],
  ['maroon', 'cardinal', 'burgundy', 'cardinal red'],
  ['light blue', 'carolina blue', 'baby blue'],
  ['natural', 'cream', 'ivory'],
];

export function mainColorsFirst<T extends { name: string }>(colors: T[]): T[] {
  const byName = new Map<string, T>();
  for (const c of colors) { const k = c.name.trim().toLowerCase(); if (!byName.has(k)) byName.set(k, c); }
  const picked: T[] = [];
  for (const names of MAIN) {
    const c = names.map((n) => byName.get(n)).find((x) => x && !picked.includes(x));
    if (c) picked.push(c);
  }
  return [...picked, ...colors.filter((c) => !picked.includes(c))];
}
