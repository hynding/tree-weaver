import { DISPLAYS } from './displays';
import type { Branch, DesignKit, DisplayStyles, Leaf, StyleMap, Tree, TreeNode } from './model';
import { isBranch } from './model';
import { VOID_TAGS, walk } from './ops';
import { BLOCKED_TAGS as BLOCKED_TAG_LIST } from './schema';
import { canonicalTag, childrenInSvg, isSvgRoot, SVG_NAMESPACE, SVG_SHAPE_TAGS } from './svg';

/** Attribute that ties rendered elements back to their branch. Styles are emitted against it. */
export const BRANCH_ATTR = 'data-tw';
/** Attribute marking rendered leaves (designer mode and image leaves). */
export const LEAF_ATTR = 'data-tw-leaf';

const SAFE_TAG = /^[a-zA-Z][a-zA-Z0-9-]*$/;
const SAFE_PROP = /^-{0,2}[a-zA-Z][a-zA-Z0-9-]*$/;
const SAFE_ATTR = /^[a-zA-Z_:][a-zA-Z0-9_.:-]*$/;
/** Tags that would execute or embed foreign documents; they render as plain containers. */
const BLOCKED_TAGS = new Set(BLOCKED_TAG_LIST);
const SVG_SHAPE_SET = new Set(SVG_SHAPE_TAGS);
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'poster', 'xlink:href']);

/** Phrasing elements: a branch holding any of these (or a leaf) keeps its content on one line when pretty printed. */
export const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'button', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'i', 'img', 'input', 'ins',
  'kbd', 'label', 'mark', 'q', 's', 'samp', 'select', 'small', 'span', 'strong', 'sub', 'sup', 'textarea', 'time', 'u', 'var', 'wbr',
]);

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

/** The tag a branch is rendered as, after safety checks. SVG tags keep their case (`linearGradient`). */
export function safeTag(tag: string): string {
  const t = canonicalTag(tag);
  return SAFE_TAG.test(t) && !BLOCKED_TAGS.has(t.toLowerCase()) ? t : 'div';
}

export function isSafeAttr(name: string, value: string): boolean {
  const n = name.toLowerCase();
  if (!SAFE_ATTR.test(name) || n.startsWith('on') || n === 'style' || n === 'srcdoc' || n === BRANCH_ATTR || n.startsWith(`${BRANCH_ATTR}-`)) return false;
  // Browsers drop tabs, newlines and leading control characters before reading a URL's scheme.
  if (URL_ATTRS.has(n) && /^(javascript|vbscript|data:text\/html)/i.test(value.replace(/[\x00-\x20]/g, ''))) return false;
  return true;
}

/** Apply `fn` until the text stops changing, so removing one token can't rebuild another (`</sty</stylele>` → `</style>`). */
export function untilStable(value: string, fn: (v: string) => string): string {
  let out = value;
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = fn(out);
  }
  return out;
}

/**
 * Whether brackets balance outside quoted strings. An unclosed `(` or `[` in CSS keeps reading
 * to the end of the stylesheet, swallowing every rule after it.
 */
export function bracketsBalance(value: string): boolean {
  const stack: string[] = [];
  let quote = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    // An escaped character is part of a name or string (`\)` doesn't close anything); a trailing
    // backslash would escape the `;` written after the value.
    if (c === '\\') {
      if (i === value.length - 1) return false;
      i++;
    } else if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') stack.push(c === '(' ? ')' : ']');
    else if (c === ')' || c === ']') {
      if (stack.pop() !== c) return false;
    }
  }
  return !stack.length && !quote;
}

/**
 * `;` would end the declaration, so it becomes `,`, except inside a quoted string or `url(…)`,
 * where it can't (`url(data:image/png;base64,…)` must keep it).
 */
export function semicolonsOutsideStrings(value: string): string {
  let out = '';
  let quote = '';
  let url = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '\\') {
      out += value.slice(i, i + 2);
      i++;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (url) {
      if (ch === ')') url = false;
    } else if (/^url\($/i.test(value.slice(i, i + 4))) {
      out += value.slice(i, i + 4);
      i += 3;
      url = true;
      continue;
    } else if (ch === ';') {
      out += ',';
      continue;
    }
    out += ch;
  }
  return out;
}

/** Strip characters that could break out of a declaration or the style element. */
export function sanitizeCssValue(value: string): string {
  // Comment markers too: an unclosed `/*` would swallow every rule after it. So would an
  // unclosed bracket, so a value whose brackets don't balance is dropped.
  // Line breaks become spaces: a CSS string ends at one, so a quote can't hide a `(` on the next line.
  // A trailing `;` (typed out of habit) is dropped rather than kept as a `,` that breaks the value.
  const out = untilStable(semicolonsOutsideStrings(value.replace(/[{}]/g, '').replace(/[\n\r\f]+/g, ' ').replace(/[\s;]+$/, '')), (v) => v.replace(/<\/?(style|script)/gi, '').replace(/\/\*|\*\//g, '')).trim();
  return bracketsBalance(out) ? out : '';
}

export const isSafeCssProp = (prop: string): boolean => SAFE_PROP.test(prop);

export function declarations(styles: StyleMap, indent = '  '): string {
  return Object.entries(styles)
    .filter(([prop, value]) => isSafeCssProp(prop) && sanitizeCssValue(value) !== '')
    .map(([prop, value]) => `${indent}${prop}: ${sanitizeCssValue(value)};`)
    .join('\n');
}

/** Escape a branch id for a quoted CSS attribute selector (`<` too, so it can't close a style element). */
const cssString = (v: string) => v.replace(/["\\]/g, (c) => `\\${c}`).replace(/[<\n\r\f]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
export const branchSelector = (id: string): string => `[${BRANCH_ATTR}="${cssString(id)}"]`;

/** CSS made safe to place inside a <style> element. */
export const styleText = (css: string): string => css.replace(/<\/style/gi, '<\\/style');

/** Anything with a selector and per-display styles: a branch (by id) or a custom rule. */
export interface DisplayRule {
  selector: string;
  styles: DisplayStyles;
}

/** CSS for a list of rules, grouped per display under its media query, base display first. */
export function renderDisplayCss(rules: DisplayRule[]): string {
  const blocks: string[] = [];
  for (const display of DISPLAYS) {
    const out: string[] = [];
    for (const rule of rules) {
      const styles = rule.styles[display.id];
      if (!styles || !rule.selector) continue;
      const body = declarations(styles, display.media ? '    ' : '  ');
      if (!body) continue;
      out.push(display.media ? `  ${rule.selector} {\n${body}\n  }` : `${rule.selector} {\n${body}\n}`);
    }
    if (!out.length) continue;
    blocks.push(display.media ? `/* ${display.label} */\n@media ${display.media} {\n${out.join('\n')}\n}` : `/* ${display.label} (base) */\n${out.join('\n')}`);
  }
  return blocks.join('\n\n');
}

/** CSS for every branch style in a tree, grouped per display under its media query. */
export function renderTreeCss(root: Branch): string {
  const rules: DisplayRule[] = [];
  walk(root, (node) => {
    if (isBranch(node)) rules.push({ selector: branchSelector(node.id), styles: node.styles });
  });
  return renderDisplayCss(rules);
}

export interface HtmlOptions {
  /** Wrap text leaves in spans carrying `data-tw-leaf` so the designer can select them. */
  designer?: boolean;
  /** Pretty print with indentation. */
  pretty?: boolean;
  /** Write well-formed XML (attributes always get a value), as a standalone `.svg` file needs. */
  xml?: boolean;
  /** Whether the node being rendered sits inside an `<svg>`. Set while rendering; callers rarely need it. */
  inSvg?: boolean;
}

function renderAttrs(branch: Branch, xml = false): string {
  const parts = [`${BRANCH_ATTR}="${escapeAttr(branch.id)}"`];
  if (branch.type) parts.push(`${BRANCH_ATTR}-type="${escapeAttr(branch.type)}"`);
  if (branch.name) parts.push(`${BRANCH_ATTR}-name="${escapeAttr(branch.name)}"`);
  const classes = branch.classes.filter(Boolean);
  if (classes.length) parts.push(`class="${escapeAttr(classes.join(' '))}"`);
  for (const [name, value] of Object.entries(branch.attrs)) {
    if (name === 'class' || !isSafeAttr(name, value)) continue;
    parts.push(value === '' && !xml ? name : `${name}="${escapeAttr(value)}"`);
  }
  return parts.join(' ');
}

const leafAttrs = (leaf: Leaf, skip: (name: string) => boolean): string =>
  Object.entries(leaf.attrs ?? {})
    .filter(([n, v]) => !skip(n) && isSafeAttr(n, v))
    .map(([n, v]) => ` ${n}="${escapeAttr(v)}"`)
    .join('');

/** A shape's element name, or `g` for names that aren't SVG shapes. */
const shapeTag = (value: string): string => {
  const t = canonicalTag(value);
  return SVG_SHAPE_SET.has(t) ? t : 'g';
};

function renderLeaf(leaf: Leaf, opts: HtmlOptions): string {
  if (leaf.type === 'shape') {
    return `<${shapeTag(leaf.value)} ${LEAF_ATTR}="${escapeAttr(leaf.id)}"${leafAttrs(leaf, () => false)}/>`;
  }
  if (leaf.type === 'image' && opts.inSvg) {
    const href = isSafeAttr('href', leaf.value) ? leaf.value : '';
    return `<image ${LEAF_ATTR}="${escapeAttr(leaf.id)}" href="${escapeAttr(href)}"${leafAttrs(leaf, (n) => n === 'href' || n === 'alt')}/>`;
  }
  if (leaf.type === 'image') {
    const attrs = Object.entries(leaf.attrs ?? {})
      .filter(([n, v]) => n !== 'src' && isSafeAttr(n, v))
      .map(([n, v]) => ` ${n}="${escapeAttr(v)}"`)
      .join('');
    const src = isSafeAttr('src', leaf.value) ? leaf.value : '';
    const alt = leaf.attrs?.alt === undefined ? ' alt=""' : '';
    return `<img ${LEAF_ATTR}="${escapeAttr(leaf.id)}" src="${escapeAttr(src)}"${alt}${attrs}>`;
  }
  const content = escapeHtml(leaf.value);
  // Inside an SVG a <span> would end the drawing, so selectable text uses <tspan>.
  if (!opts.designer) return content;
  return opts.inSvg ? `<tspan ${LEAF_ATTR}="${escapeAttr(leaf.id)}">${content}</tspan>` : `<span ${LEAF_ATTR}="${escapeAttr(leaf.id)}">${content}</span>`;
}

/**
 * Whether a branch shows its whitespace as written: a `<pre>` or `<textarea>`, or `white-space:
 * pre`, `pre-wrap`, `pre-line` or `break-spaces` on any display. Pretty printing would add to it.
 */
export function keepsWhitespace(node: Branch): boolean {
  if (/^(pre|textarea|listing|xmp|plaintext)$/i.test(node.tag)) return true;
  return Object.values(node.styles ?? {}).some((map) => /^\s*(pre|pre-wrap|pre-line|break-spaces)\b/i.test(map?.['white-space'] ?? ''));
}

/** Whether a branch's own styles make it `inline`, `inline-block`, `inline-flex` … on any display. */
export function hasInlineDisplay(node: Branch): boolean {
  return Object.values(node.styles ?? {}).some((map) => /^\s*inline/i.test(map?.display ?? ''));
}

/** Whether a child keeps its parent's content on one line when pretty printed. */
const isInline = (node: TreeNode): boolean => (isBranch(node) ? INLINE_TAGS.has(node.tag) : node.type !== 'shape');

export function renderNodeHtml(node: TreeNode, opts: HtmlOptions = {}, depth = 0): string {
  if (!isBranch(node)) return renderLeaf(node, opts);
  const tag = safeTag(node.tag);
  const inSvg = childrenInSvg(node, !!opts.inSvg);
  const svgRoot = tag === 'svg' && !opts.inSvg && opts.xml && node.attrs.xmlns === undefined ? ` xmlns="${SVG_NAMESPACE}"` : '';
  const open = `<${tag}${svgRoot} ${renderAttrs(node, opts.xml)}>`;
  if (VOID_TAGS.has(tag) && !opts.inSvg) return opts.xml ? `${open.slice(0, -1)}/>` : open;
  if (!node.children.length) return `${open}</${tag}>`;
  const keep = keepsWhitespace(node);
  // Text in a <textarea> or <title> isn't markup, so the designer's leaf spans would show as text.
  const rawText = !opts.inSvg && /^(textarea|title)$/i.test(tag);
  const inner = { ...opts, inSvg, pretty: opts.pretty && !keep, designer: opts.designer && !rawText };
  // Also beside an inline-block child: a line break there would show as a gap the canvas doesn't have.
  const inline = !opts.pretty || keep || node.children.some((c) => isInline(c) || (isBranch(c) && hasInlineDisplay(c)));
  if (inline) {
    const content = node.children.map((c) => renderNodeHtml(c, inner, depth + 1)).join('');
    // HTML parsers drop one newline right after <pre>, <textarea> or <listing>, so a leading one is doubled.
    const lead = !opts.xml && !opts.inSvg && /^(pre|textarea|listing)$/i.test(tag) && /^(\r\n|\n|\r)/.test(content) ? '\n' : '';
    return `${open}${lead}${content}</${tag}>`;
  }
  const pad = '  '.repeat(depth + 1);
  const body = node.children.map((c) => `${pad}${renderNodeHtml(c, inner, depth + 1)}`).join('\n');
  return `${open}\n${body}\n${'  '.repeat(depth)}</${tag}>`;
}

/**
 * Markup for the tree's content. A page's root becomes `<body>`, so this is the markup of
 * its children; an SVG tree's root is itself the `<svg>` element inside the body.
 */
export function renderTreeBody(root: Branch, opts: HtmlOptions = {}): string {
  if (isSvgRoot(root)) return renderNodeHtml(root, opts, opts.pretty ? 1 : 0);
  // Line breaks between inline children would show as spaces, as inside any other branch.
  const pretty = opts.pretty && !keepsWhitespace(root) && !root.children.some((c) => isInline(c) || (isBranch(c) && hasInlineDisplay(c)));
  const inner = { ...opts, pretty: opts.pretty && !keepsWhitespace(root) };
  return root.children.map((c) => renderNodeHtml(c, inner, opts.pretty ? 1 : 0)).join(pretty ? '\n  ' : '');
}

/** Attributes for the `<body>` element that represents the tree root (none for an SVG tree, whose root is the `<svg>`). */
export function rootAttrs(root: Branch): string {
  return isSvgRoot(root) ? '' : renderAttrs(root);
}

/** Baseline CSS every rendered tree gets, so empty layouts are still visible and media scale. */
export const BASE_CSS = `*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.5; }
img { max-width: 100%; height: auto; }`;

export interface DocumentOptions extends HtmlOptions {
  kits?: DesignKit[];
  /** Extra CSS appended after the tree styles (the designer uses it for selection outlines). */
  extraCss?: string;
}

/** A complete, standalone HTML document for a tree. */
export function renderDocument(tree: Tree, opts: DocumentOptions = {}): string {
  const kits = (opts.kits ?? []).filter((k) => k.enabled);
  const kitStyles = kits
    .map((k) => {
      const attrs = `data-tw-kit="${escapeAttr(k.id)}" data-tw-kit-name="${escapeAttr(k.name)}"${k.source === 'env' ? ' data-tw-env' : ''}${k.rules ? ' data-tw-kit-editable' : ''}${k.tokens ? ' data-tw-kit-tokens' : ''}`;
      if (k.href) return `<link rel="stylesheet" href="${escapeAttr(k.href)}" ${attrs}>`;
      return `<style ${attrs}>\n${styleText(k.css)}\n</style>`;
    })
    .join('\n');
  const body = renderTreeBody(tree.root, { ...opts, pretty: opts.pretty ?? true });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Tree Weaver">
<meta name="tw-tree" content="${escapeAttr(tree.id)}">
<title>${escapeHtml(tree.name)}</title>
<style data-tw-base>
${BASE_CSS}
</style>
${kitStyles ? `${kitStyles}\n` : ''}<style data-tw-styles>
${styleText(renderTreeCss(tree.root))}
</style>${opts.extraCss ? `\n<style>${styleText(opts.extraCss)}</style>` : ''}
</head>
<body${isSvgRoot(tree.root) ? '' : ` ${rootAttrs(tree.root)}`}>${!isSvgRoot(tree.root) && keepsWhitespace(tree.root) ? body : `\n  ${body}\n`}</body>
</html>
`;
}

/** A tree page linked from a forest index. */
export interface IndexEntry {
  name: string;
  href: string;
}

/** A plain standalone page listing a forest's trees, each linking to its own page. */
export function renderForestIndex(forestName: string, entries: IndexEntry[]): string {
  const items = entries.map((e) => `  <li><a href="${escapeAttr(e.href)}">${escapeHtml(e.name)}</a></li>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Tree Weaver">
<title>${escapeHtml(forestName)}</title>
<style>
${BASE_CSS}
body { max-width: 640px; margin: 0 auto; padding: 48px 20px; color: #1c2420; }
h1 { font-size: 1.6rem; margin: 0 0 4px; }
p { margin: 0 0 24px; color: #5e6b65; }
ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
a { display: block; padding: 12px 16px; border: 1px solid #dfe5e2; border-radius: 8px; color: inherit; text-decoration: none; }
a:hover { border-color: #2f6f4f; background: #e3f1e9; }
</style>
</head>
<body>
<h1>${escapeHtml(forestName)}</h1>
<p>${entries.length} ${entries.length === 1 ? 'tree' : 'trees'}</p>
<ul>
${items}
</ul>
</body>
</html>
`;
}
