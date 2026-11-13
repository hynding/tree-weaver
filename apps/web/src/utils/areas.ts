const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#db2777', '#0891b2', '#65a30d', '#dc2626'];

/**
 * A colour for a grid area, by its place among the grid's area names, so neighbours
 * differ and the painter and the canvas overlay agree.
 */
export function areaColor(name: string, names: string[]): string {
  const i = names.indexOf(name);
  if (i >= 0) return PALETTE[i % PALETTE.length];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
