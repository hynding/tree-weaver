/**
 * Which CSS properties overlap: a shorthand and the longhands it sets (`padding` and
 * `padding-left`, `border-bottom` and `border-color`). Used wherever moving one declaration past
 * another could change which wins.
 */
/** Shorthands whose longhands don't share their name as a prefix (`border` → `border-top` does). */
const MORE_LONGHANDS: Record<string, string[]> = {
  inset: ['top', 'right', 'bottom', 'left'],
  grid: ['grid-template-rows', 'grid-template-columns', 'grid-template-areas', 'grid-auto-rows', 'grid-auto-columns', 'grid-auto-flow'],
  'grid-area': ['grid-row', 'grid-column', 'grid-row-start', 'grid-row-end', 'grid-column-start', 'grid-column-end'],
  'grid-template': ['grid-template-rows', 'grid-template-columns', 'grid-template-areas'],
  gap: ['row-gap', 'column-gap'],
  'place-items': ['align-items', 'justify-items'],
  'place-content': ['align-content', 'justify-content'],
  'place-self': ['align-self', 'justify-self'],
  'flex-flow': ['flex-direction', 'flex-wrap'],
  font: ['line-height'],
  columns: ['column-width', 'column-count'],
  'border-color': ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'],
  'border-style': ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'],
  'border-width': ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'],
};
/** The physical longhands a box property sets (left-to-right for the logical ones), so partial overlaps show. */
function boxLonghands(prop: string): string[] | undefined {
  const SIDES = ['top', 'right', 'bottom', 'left'];
  const AXES: Record<string, string[]> = { inline: ['left', 'right'], block: ['top', 'bottom'], 'inline-start': ['left'], 'inline-end': ['right'], 'block-start': ['top'], 'block-end': ['bottom'] };
  let m = /^(padding|margin|inset|scroll-margin|scroll-padding)(?:-(inline|block)(?:-(start|end))?|-(top|right|bottom|left))?$/.exec(prop);
  if (m) {
    const sides = m[4] ? [m[4]] : m[2] ? AXES[m[3] ? `${m[2]}-${m[3]}` : m[2]] : SIDES;
    return sides.map((side) => (m![1] === 'inset' ? side : `${m![1]}-${side}`));
  }
  m = /^border(?:-(inline|block)(?:-(start|end))?|-(top|right|bottom|left))?(?:-(width|style|color))?$/.exec(prop);
  if (m) {
    const sides = m[3] ? [m[3]] : m[1] ? AXES[m[2] ? `${m[1]}-${m[2]}` : m[1]] : SIDES;
    const parts = m[4] ? [m[4]] : ['width', 'style', 'color'];
    return sides.flatMap((side) => parts.map((part) => `border-${side}-${part}`));
  }
  if (prop === 'border-radius') return ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'];
  return undefined;
}
const longhandSet = (p: string): Set<string> => new Set(boxLonghands(p) ?? [p]);
export const cssCovers = (a: string, b: string) => {
  if (b.startsWith(`${a}-`) || (Object.hasOwn(MORE_LONGHANDS, a) && MORE_LONGHANDS[a].includes(b))) return true;
  const la = longhandSet(a);
  return a !== b && [...longhandSet(b)].every((x) => la.has(x));
};
export const cssOverlaps = (a: string, b: string) => {
  if (cssCovers(a, b) || cssCovers(b, a)) return true;
  const la = longhandSet(a);
  return [...longhandSet(b)].some((x) => la.has(x));
};
