import type { Branch, TreeNode } from './model';
import { isBranch } from './model';

/**
 * Nestings the HTML parser rearranges. The canvas, previews and exports all go through it, so a
 * tree holding one would show a structure the tree doesn't have (a `<div>` in a `<p>` closes the
 * paragraph; an `<a>` in an `<a>` closes the outer link; a `<div>` in a `<table>` moves before it).
 */

/** Start tags that close an open `<p>`. */
const CLOSES_P = new Set(
  'address article aside blockquote center details dialog dir div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr listing main menu nav ol p pre search section summary table ul xmp plaintext li dd dt'.split(' '),
);
/** Elements that stop the parser's search for an open element of the same kind ("scope"). */
const SCOPE = new Set(['applet', 'caption', 'html', 'table', 'td', 'th', 'marquee', 'object', 'template', 'foreignobject', 'svg', 'math']);
/** Children each table part takes; anything else is moved out in front of the table. */
const TABLE_CHILDREN: Record<string, Set<string>> = {
  table: new Set(['caption', 'colgroup', 'thead', 'tbody', 'tfoot', 'tr', 'script', 'template', 'style']),
  thead: new Set(['tr', 'script', 'template', 'style']),
  tbody: new Set(['tr', 'script', 'template', 'style']),
  tfoot: new Set(['tr', 'script', 'template', 'style']),
  tr: new Set(['td', 'th', 'script', 'template', 'style']),
  colgroup: new Set(['col', 'template']),
};
const HEADING = /^h[1-6]$/;
/** The parents each table part needs. */
const PART_PARENTS: Record<string, string[]> = {
  td: ['tr'],
  th: ['tr'],
  tr: ['table', 'thead', 'tbody', 'tfoot'],
  caption: ['table'],
  colgroup: ['table'],
  thead: ['table'],
  tbody: ['table'],
  tfoot: ['table'],
  col: ['colgroup', 'table'],
};
/** HTML start tags that end MathML content (the parser's "breakout" list). */
const MATH_BREAKOUT = new Set(
  'b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var'.split(' '),
);
/** Elements whose content is read as text, not markup. */
const RAW_TEXT = new Set(['textarea', 'title', 'noscript', 'template']);
/** Obsolete raw-text elements, which also show entities as written: nothing the editor writes in them reads back. */
const OBSOLETE_RAW = new Set(['xmp', 'plaintext', 'noembed', 'noframes']);

/** Whether a start tag ends an open `<p>` (the parser closes the paragraph before it). */
export const closesParagraph = (tag: string): boolean => CLOSES_P.has(tag.toLowerCase());

/**
 * Why the HTML parser would move `node` out of the place `ancestors` (outermost first, the parent
 * last) describe, or null. Only the node itself is checked; callers check what it holds in turn.
 */
export function nestingProblem(ancestors: readonly Branch[], node: TreeNode): string | null {
  const parent = ancestors[ancestors.length - 1];
  if (!parent) return null;
  const parentTag = parent.tag.toLowerCase();
  // The parser reads these elements' content as text, so a branch inside shows as its markup.
  if (OBSOLETE_RAW.has(parentTag)) return `A <${parentTag}> shows its content as raw text; use a <pre> instead`;
  if (RAW_TEXT.has(parentTag) && isBranch(node)) return `A <${parentTag}> can only hold text; the browser would show <${node.tag}> as its markup`;
  const table = Object.hasOwn(TABLE_CHILDREN, parentTag) ? TABLE_CHILDREN[parentTag] : undefined;
  if (table) {
    if (!isBranch(node)) return node.type === 'text' && !node.value.trim() ? null : `A <${parentTag}> can only hold ${[...table].filter((t) => !['script', 'template', 'style'].includes(t)).map((t) => `<${t}>`).join(', ')}; the browser would move this out in front of the table`;
    if (!table.has(node.tag.toLowerCase())) return `A <${parentTag}> can only hold ${[...table].filter((t) => !['script', 'template', 'style'].includes(t)).map((t) => `<${t}>`).join(', ')}, not <${node.tag}>; the browser would move it out in front of the table`;
    return null;
  }
  if (!isBranch(node)) return null;
  const tag = node.tag.toLowerCase();
  // Elements the parser drops (another <body>) or renames (<image> is read as <img>).
  if (/^(html|head|body)$/.test(tag)) return `A <${tag}> can't go inside the page; the browser drops it and keeps only what it holds`;
  if (tag === 'image') return 'The browser reads <image> as <img>; use an image leaf or <img>';
  // Table parts outside their table part are ignored by the parser.
  const partOf = Object.hasOwn(PART_PARENTS, tag) ? PART_PARENTS[tag] : undefined;
  if (partOf && !partOf.includes(parentTag)) return `A <${tag}> only works inside ${partOf.map((t) => `<${t}>`).join(' or ')}; elsewhere the browser drops it and keeps only what it holds`;
  // Open elements the parser would find from here, up to a scope boundary.
  const inScope = (want: (t: string) => boolean, stop: Set<string> = SCOPE): boolean => {
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const t = ancestors[i].tag.toLowerCase();
      if (want(t)) return true;
      if (stop.has(t)) return false;
    }
    return false;
  };
  if (CLOSES_P.has(tag) && inScope((t) => t === 'p', new Set([...SCOPE, 'button']))) return `<${tag}> can't go inside a <p>: the browser would end the paragraph there. Put it outside the paragraph, or use a <span>`;
  if (HEADING.test(tag) && HEADING.test(parentTag)) return `A heading can't go directly inside another heading; the browser would end the outer one`;
  if (tag === 'a' && inScope((t) => t === 'a', new Set(['caption', 'td', 'th', 'marquee', 'object', 'template', 'applet']))) return `A link can't go inside another link; the browser would end the outer one`;
  if (tag === 'button' && inScope((t) => t === 'button')) return `A button can't go inside another button; the browser would end the outer one`;
  if (tag === 'form' && ancestors.some((a) => a.tag.toLowerCase() === 'form')) return `A form can't go inside another form; the browser drops the inner <form>`;
  if (tag === 'li' && inScope((t) => t === 'li', new Set([...SCOPE, 'ul', 'ol']))) return `An <li> can't go inside another <li> without a list around it; the browser would end the outer item`;
  if ((tag === 'dd' || tag === 'dt') && inScope((t) => t === 'dd' || t === 'dt', new Set([...SCOPE, 'dl']))) return `A <${tag}> can't go inside a <dd> or <dt> without a <dl> around it; the browser would end the outer one`;
  if (tag === 'option' && parentTag === 'option') return `An <option> can't go inside another <option>`;
  if (tag === 'optgroup' && (parentTag === 'option' || parentTag === 'optgroup')) return `An <optgroup> can't go inside an <${parentTag}>; the browser would end the <${parentTag}> there`;
  if (/^(input|select|textarea|keygen)$/.test(tag) && inScope((t) => t === 'select', new Set(['template']))) return `A <${tag}> can't go inside a <select>; the browser would end the select there`;
  if (tag === 'nobr' && inScope((t) => t === 'nobr')) return 'A <nobr> can\'t go inside another <nobr>; the browser would end the outer one';
  // In a <ruby>, these end the open annotation parts (an <rt> or <rp> leaves an <rtc> open).
  const rubyParts = tag === 'rt' || tag === 'rp' ? ['rt', 'rp', 'rb'] : tag === 'rb' || tag === 'rtc' ? ['rt', 'rp', 'rb', 'rtc'] : null;
  if (rubyParts && rubyParts.includes(parentTag) && inScope((t) => t === 'ruby')) return `A <${tag}> can't go inside an <${parentTag}>; the browser would end the <${parentTag}> there`;
  // HTML in MathML (outside <mtext> and the like) breaks out of the formula.
  if (MATH_BREAKOUT.has(tag)) {
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const t = ancestors[i].tag.toLowerCase();
      if (/^(mi|mo|mn|ms|mtext|annotation-xml|foreignobject)$/.test(t)) break;
      if (t === 'math') return `<${tag}> can't go inside <math> (outside an <mtext>); the browser would move it out of the formula`;
    }
  }
  return null;
}
