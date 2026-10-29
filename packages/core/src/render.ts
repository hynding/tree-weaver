import { DISPLAYS } from './displays';
import type { Branch, DesignKit, DisplayStyles, Leaf, StyleMap, Tree, TreeNode } from './model';
import { isBranch } from './model';
import { VOID_TAGS, walk } from './ops';

/** Attribute that ties rendered elements back to their branch. Styles are emitted against it. */
export const BRANCH_ATTR = 'data-tw';
/** Attribute marking rendered leaves (designer mode and image leaves). */
export const LEAF_ATTR = 'data-tw-leaf';

const SAFE_TAG = /^[a-zA-Z][a-zA-Z0-9-]*$/;
const SAFE_PROP = /^-{0,2}[a-zA-Z][a-zA-Z0-9-]*$/;
const SAFE_ATTR = /^[a-zA-Z_:][a-zA-Z0-9_.:-]*$/;
/** Tags that would execute or embed foreign documents; they render as plain containers. */
const BLOCKED_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'frame', 'frameset', 'base', 'meta', 'link']);
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

/** The tag a branch is rendered as, after safety checks. */
export function safeTag(tag: string): string {
  const t = tag.toLowerCase();
  return SAFE_TAG.test(t) && !BLOCKED_TAGS.has(t) ? t : 'div';
}

export function isSafeAttr(name: string, value: string): boolean {
  const n = name.toLowerCase();
  if (!SAFE_ATTR.test(name) || n.startsWith('on') || n === 'style' || n === 'srcdoc' || n === BRANCH_ATTR || n.startsWith(`${BRANCH_ATTR}-`)) return false;
  if (URL_ATTRS.has(n) && /^\s*(javascript|vbscript|data:text\/html)/i.test(value)) return false;
  return true;
}

/** Strip characters that could break out of a declaration or the style element. */
export function sanitizeCssValue(value: string): string {
  return value.replace(/[{}]/g, '').replace(/;/g, ',').replace(/<\/?(style|script)/gi, '').trim();
}

export const isSafeCssProp = (prop: string): boolean => SAFE_PROP.test(prop);

export function declarations(styles: StyleMap, indent = '  '): string {
  return Object.entries(styles)
    .filter(([prop, value]) => isSafeCssProp(prop) && sanitizeCssValue(value) !== '')
    .map(([prop, value]) => `${indent}${prop}: ${sanitizeCssValue(value)};`)
    .join('\n');
}

export const branchSelector = (id: string): string => `[${BRANCH_ATTR}="${id.replace(/["\\]/g, '')}"]`;

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
}

function renderAttrs(branch: Branch): string {
  const parts = [`${BRANCH_ATTR}="${escapeAttr(branch.id)}"`];
  if (branch.type) parts.push(`${BRANCH_ATTR}-type="${escapeAttr(branch.type)}"`);
  if (branch.name) parts.push(`${BRANCH_ATTR}-name="${escapeAttr(branch.name)}"`);
  const classes = branch.classes.filter(Boolean);
  if (classes.length) parts.push(`class="${escapeAttr(classes.join(' '))}"`);
  for (const [name, value] of Object.entries(branch.attrs)) {
    if (name === 'class' || !isSafeAttr(name, value)) continue;
    parts.push(value === '' ? name : `${name}="${escapeAttr(value)}"`);
  }
  return parts.join(' ');
}

function renderLeaf(leaf: Leaf, opts: HtmlOptions): string {
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
  return opts.designer ? `<span ${LEAF_ATTR}="${escapeAttr(leaf.id)}">${content}</span>` : content;
}

export function renderNodeHtml(node: TreeNode, opts: HtmlOptions = {}, depth = 0): string {
  if (!isBranch(node)) return renderLeaf(node, opts);
  const tag = safeTag(node.tag);
  const open = `<${tag} ${renderAttrs(node)}>`;
  if (VOID_TAGS.has(tag)) return open;
  if (!node.children.length) return `${open}</${tag}>`;
  const inline = !opts.pretty || node.children.some((c) => !isBranch(c) || INLINE_TAGS.has(c.tag));
  if (inline) return `${open}${node.children.map((c) => renderNodeHtml(c, opts, depth + 1)).join('')}</${tag}>`;
  const pad = '  '.repeat(depth + 1);
  const inner = node.children.map((c) => `${pad}${renderNodeHtml(c, opts, depth + 1)}`).join('\n');
  return `${open}\n${inner}\n${'  '.repeat(depth)}</${tag}>`;
}

/** Markup for the children of the tree root (the root itself becomes `<body>`). */
export function renderTreeBody(root: Branch, opts: HtmlOptions = {}): string {
  return root.children.map((c) => renderNodeHtml(c, opts, opts.pretty ? 1 : 0)).join(opts.pretty ? '\n  ' : '');
}

/** Attributes for the `<body>` element that represents the tree root. */
export function rootAttrs(root: Branch): string {
  return renderAttrs(root);
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
      const attrs = `data-tw-kit="${escapeAttr(k.id)}" data-tw-kit-name="${escapeAttr(k.name)}"${k.source === 'env' ? ' data-tw-env' : ''}${k.rules ? ' data-tw-kit-editable' : ''}`;
      if (k.href) return `<link rel="stylesheet" href="${escapeAttr(k.href)}" ${attrs}>`;
      return `<style ${attrs}>\n${k.css.replace(/<\/style/gi, '<\\/style')}\n</style>`;
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
${renderTreeCss(tree.root)}
</style>${opts.extraCss ? `\n<style>${opts.extraCss}</style>` : ''}
</head>
<body ${rootAttrs(tree.root)}>
  ${body}
</body>
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
