import {
  canonicalTag,
  cloneNode,
  createBranch,
  createLeaf,
  isBranch,
  isDisplayId,
  normalizeNode,
  stylePatchByDisplay,
  SVG_BRANCH_TAGS,
  text,
  TreeDataError,
  type Branch,
  type DisplayStyles,
  type TreeNode,
} from '@tree-weaver/core';
import { flexColumn, flexRow, getBlueprint, responsiveGrid, section, BLUEPRINTS } from './index';

/**
 * The authoring shorthand: a compact way for agents (and people) to write branches and
 * leaves, expanded into the canonical format through the blueprint catalog. Canonical
 * nodes pass through unchanged, so the two can be mixed freely.
 *
 * Strings:
 *   "Plain text"                    a text leaf
 *   "h2: Pricing"                   <h2> holding a text leaf ("tag.class#id[attr=value]: text")
 *   "a.btn.btn-primary[href=/join]: Join"
 *   "hr:"                           an empty <hr>
 *   "img: https://…/photo.jpg | A dog on a beach"   an image leaf with alt text
 *   "@card"                         a blueprint from the library (see `tree-weaver add --list`)
 *   "\\h2: not a heading"           a leading backslash keeps the text as it is
 *
 * Objects (with optional id, name, type, class/classes, attrs, styles, href, alt):
 *   { "h2": "Pricing" }             one key naming the element; the value is its text,
 *   { "ul.plain": ["li: One", "li: Two"] }   its children, or one child
 *   { "grid": 3, "children": [...] }   a responsive grid: 3 columns, 2 on tablets, 1 on phones
 *   { "grid": "2fr 1fr", "children": [...] }   a grid with these columns, 1 on phones
 *   { "row": [...] }  { "column": [...] }  { "section": [...] }   flex row / column / section with a container
 *   { "table": [["Plan", "Price"], ["Basic", "$5"]], "header": true }
 *   { "img": "https://…", "alt": "…" }
 *   { "use": "hero", "classes": ["dark"] }   a blueprint, with changes on top
 *
 * `styles` may be flat: properties outside a display key go on `lg`, the base display:
 *   "styles": { "gap": "2rem", "tablet": { "gap": "1rem" } }
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Elements the string and one-key forms recognise. Anything else stays text, or is an error in the one-key form. */
const HTML_TAGS = [
  'a', 'abbr', 'address', 'body', 'article', 'aside', 'audio', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'button', 'caption', 'cite',
  'code', 'col', 'colgroup', 'data', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt', 'em', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'i', 'input', 'ins',
  'kbd', 'label', 'legend', 'li', 'main', 'mark', 'menu', 'meter', 'nav', 'ol', 'optgroup', 'option', 'output', 'p',
  'picture', 'pre', 'progress', 'q', 's', 'samp', 'search', 'section', 'select', 'small', 'source', 'span', 'strong', 'sub',
  'summary', 'sup', 'table', 'tbody', 'td', 'textarea', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var', 'video', 'wbr',
];
const KNOWN_TAGS = new Set([...HTML_TAGS, ...SVG_BRANCH_TAGS.map((t) => t.toLowerCase())]);

const SELECTOR = /^([A-Za-z][A-Za-z0-9-]*)((?:\.[A-Za-z_][\w-]*)*)(?:#([A-Za-z][\w-]*))?((?:\[[A-Za-z_:][\w:.-]*(?:=(?:"[^"]*"|'[^']*'|[^\]]*))?\])*)$/;
const ATTR = /\[([A-Za-z_:][\w:.-]*)(?:=("[^"]*"|'[^']*'|[^\]]*))?\]/g;
const STRING_FORM = /^([^\s:]+):(?:\s+([\s\S]*))?$/;

/** Keys that change a node in any object form. */
const MODIFIERS = new Set(['id', 'name', 'type', 'class', 'classes', 'attrs', 'styles', 'children', 'header', 'href', 'alt']);
const LAYOUT_KEYS = ['grid', 'row', 'column', 'section', 'table', 'img', 'use'] as const;

interface Selector {
  tag: string;
  classes: string[];
  attrs: Record<string, string>;
}

/** Parse `tag.class#id[attr=value]`, or null when it isn't one or names an unknown element. */
export function parseSelector(value: string): Selector | null {
  const m = SELECTOR.exec(value);
  if (!m || !KNOWN_TAGS.has(m[1].toLowerCase())) return null;
  const attrs: Record<string, string> = {};
  if (m[3]) attrs.id = m[3];
  for (const a of m[4].matchAll(ATTR)) attrs[a[1]] = (a[2] ?? '').replace(/^(["'])([\s\S]*)\1$/, '$2');
  return { tag: canonicalTag(m[1]), classes: m[2].split('.').filter(Boolean), attrs };
}

const fail = (message: string, path: string): never => {
  throw new TreeDataError(message, path);
};

function blueprint(id: string, path: string): TreeNode {
  const found = getBlueprint(id);
  if (!found) fail(`No blueprint "${id}". Blueprints: ${BLUEPRINTS.map((b) => b.id).join(', ')}`, path);
  return found!.create();
}

function imageLeaf(src: string, alt: string | undefined): TreeNode {
  return createLeaf(src.trim(), 'image', alt === undefined ? undefined : { alt: alt.trim() });
}

function expandString(value: string, path: string): TreeNode {
  if (value.startsWith('\\')) return text(value.slice(1));
  if (/^@[\w-]+$/.test(value)) return blueprint(value.slice(1), path);
  const m = STRING_FORM.exec(value);
  if (!m) return text(value);
  const content = m[2] ?? '';
  if (m[1].toLowerCase() === 'img') {
    const [src, ...alt] = content.split(' | ');
    return imageLeaf(src, alt.length ? alt.join(' | ') : '');
  }
  const sel = parseSelector(m[1]);
  if (!sel) return text(value);
  return createBranch({ tag: sel.tag, classes: sel.classes, attrs: sel.attrs, children: content ? [text(content)] : [] });
}

/** Styles as written in shorthand (flat properties go on `lg`) into display styles. */
export function expandStyles(value: unknown, path = 'styles'): DisplayStyles {
  if (value === undefined) return {};
  try {
    const byDisplay = stylePatchByDisplay(value);
    const out: DisplayStyles = {};
    for (const [display, map] of Object.entries(byDisplay)) {
      const clean = Object.fromEntries(Object.entries(map ?? {}).filter(([, v]) => v !== null)) as Record<string, string>;
      if (Object.keys(clean).length) out[display as keyof DisplayStyles] = clean;
    }
    return out;
  } catch (err) {
    return fail((err as Error).message, path);
  }
}

const listOf = (value: unknown, _path: string): unknown[] => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
};

const classesOf = (value: Obj): string[] => {
  const raw = value.classes ?? value.class;
  if (raw === undefined) return [];
  if (typeof raw === 'string') return raw.split(/\s+/).filter(Boolean);
  if (Array.isArray(raw)) return raw.map(String).flatMap((c) => c.split(/\s+/)).filter(Boolean);
  return [];
};

/** Apply the common modifiers (id, name, classes, attrs, styles, href, alt) to an expanded node. */
function modify(node: TreeNode, value: Obj, path: string): TreeNode {
  const attrs: Record<string, string> = {};
  if (isObj(value.attrs)) for (const [k, v] of Object.entries(value.attrs)) if (v !== null && v !== undefined) attrs[k] = String(v);
  if (value.href !== undefined) attrs.href = String(value.href);
  if (value.alt !== undefined) attrs.alt = String(value.alt);
  if (!isBranch(node)) {
    if (value.styles !== undefined || classesOf(value).length) fail('A leaf has no styles or classes; wrap it in a branch', path);
    const leaf = { ...node, attrs: { ...node.attrs, ...attrs } };
    if (!Object.keys(leaf.attrs).length) delete (leaf as { attrs?: unknown }).attrs;
    if (value.id !== undefined) leaf.id = String(value.id);
    return leaf;
  }
  const branch: Branch = { ...node, attrs: { ...node.attrs, ...attrs }, classes: [...new Set([...node.classes, ...classesOf(value)])] };
  if (value.id !== undefined) branch.id = String(value.id);
  if (value.name !== undefined) branch.name = String(value.name);
  if (value.type !== undefined) branch.type = String(value.type);
  const styles = expandStyles(value.styles, `${path}.styles`);
  if (Object.keys(styles).length) {
    const merged: DisplayStyles = { ...branch.styles };
    for (const [d, map] of Object.entries(styles)) merged[d as keyof DisplayStyles] = { ...merged[d as keyof DisplayStyles], ...map };
    branch.styles = merged;
  }
  return branch;
}

function table(rows: unknown, header: boolean, path: string): Branch {
  if (!Array.isArray(rows) || !rows.every(Array.isArray)) fail('"table" is a list of rows, each a list of cells: [["Plan", "Price"], ["Basic", "$5"]]', path);
  const list = rows as unknown[][];
  const row = (cells: unknown[], tag: 'th' | 'td', r: number) =>
    createBranch({ tag: 'tr', children: cells.map((c, i) => createBranch({ tag, children: c === '' || c === null ? [] : [expandAt(c, `${path}[${r}][${i}]`)] })) });
  const children: Branch[] = [];
  if (header && list.length) children.push(createBranch({ tag: 'thead', children: [row(list[0], 'th', 0)] }));
  const body = header ? list.slice(1) : list;
  children.push(createBranch({ tag: 'tbody', children: body.map((cells, r) => row(cells, 'td', r + (header ? 1 : 0))) }));
  return createBranch({ tag: 'table', type: 'table', name: 'Table', classes: ['table'], children });
}

function expandObject(value: Obj, path: string): TreeNode {
  // Canonical branches and leaves: keep them, expanding shorthand in their children and flat styles.
  if (value.kind !== undefined || value.tag !== undefined || value.value !== undefined || value.text !== undefined || value.src !== undefined) {
    const children = value.children;
    const copy: Obj = { ...value };
    if (Array.isArray(children)) copy.children = [];
    if (value.styles !== undefined) copy.styles = expandStyles(value.styles, `${path}.styles`);
    const node = normalizeNode(copy, path);
    if (isBranch(node) && Array.isArray(children)) node.children = children.map((c, i) => expandAt(c, `${path}.children[${i}]`));
    return node;
  }
  const keys = Object.keys(value).filter((k) => !MODIFIERS.has(k));
  if (keys.length !== 1) {
    fail(
      keys.length
        ? `Found ${keys.map((k) => `"${k}"`).join(', ')}; a shorthand object names one element or layout`
        : 'A shorthand object needs one key naming the element ("h2", "ul.list") or layout (grid, row, column, section, table, img, use)',
      path,
    );
  }
  const key = keys[0];
  const body = value[key];
  const kids = (list: unknown[]) => list.map((c, i) => expandAt(c, `${path}.children[${i}]`));
  const childrenOr = (fallback: unknown) => (value.children !== undefined ? listOf(value.children, path) : listOf(fallback, path));
  let node: TreeNode;
  switch (key as (typeof LAYOUT_KEYS)[number]) {
    case 'grid': {
      const children = kids(listOf(value.children, path));
      if (typeof body === 'number' && Number.isInteger(body) && body > 0) {
        node = responsiveGrid(body, children, typeof value.name === 'string' ? value.name : 'Grid');
      } else if (typeof body === 'string' && body.trim()) {
        node = createBranch({
          type: 'grid',
          name: 'Grid',
          styles: { lg: { display: 'grid', 'grid-template-columns': body.trim(), gap: '1rem' }, 'mobile-portrait': { 'grid-template-columns': '1fr' } },
          children,
        });
      } else return fail('"grid" is a number of columns, or the columns as CSS ("2fr 1fr")', `${path}.grid`);
      break;
    }
    case 'row':
      node = flexRow(kids(childrenOr(body)));
      break;
    case 'column':
      node = flexColumn(kids(childrenOr(body)));
      break;
    case 'section':
      node = section(kids(childrenOr(body)), typeof value.name === 'string' ? value.name : 'Section');
      break;
    case 'table':
      node = table(body, value.header !== false, `${path}.table`);
      break;
    case 'img':
      if (typeof body !== 'string') fail('"img" is the image URL', `${path}.img`);
      node = imageLeaf(body as string, typeof value.alt === 'string' ? value.alt : undefined);
      break;
    case 'use': {
      if (typeof body !== 'string') fail('"use" is a blueprint id, such as "card" or "hero"', `${path}.use`);
      node = blueprint(body as string, `${path}.use`);
      if (value.children !== undefined && isBranch(node)) node = { ...node, children: kids(listOf(value.children, path)) };
      break;
    }
    default: {
      const sel = parseSelector(key);
      if (!sel) {
        if (isDisplayId(key)) fail(`"${key}" is a display; put it inside "styles"`, path);
        return fail(`"${key}" is not an element, layout (grid, row, column, section, table, img, use) or field`, path);
      }
      if (value.children !== undefined && body !== null) fail(`Give the children either as "${key}" or as "children", not both`, path);
      // A string value is the element's text, taken as written (not read as shorthand).
      const content = value.children !== undefined ? kids(listOf(value.children, path)) : typeof body === 'string' ? [text(body)] : kids(listOf(body, path));
      node = createBranch({ tag: sel.tag, classes: sel.classes, attrs: sel.attrs, children: content });
    }
  }
  return modify(node, value, path);
}

function expandAt(value: unknown, path: string): TreeNode {
  if (typeof value === 'string') return expandString(value, path);
  if (typeof value === 'number' || typeof value === 'boolean') return text(String(value));
  if (isObj(value)) return expandObject(value, path);
  return fail(Array.isArray(value) ? 'A list is not a node; put it in "children"' : 'Expected a node: a string or an object', path);
}

/**
 * Expand a shorthand branch or leaf (or a canonical one, which passes through) into the
 * canonical model. Blueprints get fresh ids; ids written in the shorthand are kept.
 * Throws `TreeDataError` with the path of the part it can't read.
 */
export function expandShorthand(value: unknown, path = 'node'): TreeNode {
  const node = expandAt(value, path);
  // Normalizing fills in what the builders left out and makes ids unique.
  return normalizeNode(cloneNode(node), path);
}

/**
 * Expand the shorthand everywhere in a document: an envelope, a forest, a tree, a
 * single branch, or a bare list of nodes (the children of a page body). Returns the
 * canonical document as plain data, ready for `importDocument` or `normalizeTree`.
 */
export function expandShorthandDocument(value: unknown): Obj {
  const expandRoot = (root: unknown, path: string): TreeNode => {
    if (Array.isArray(root)) return expandShorthand({ tag: 'body', children: root }, path);
    const node = expandShorthand(root, path);
    if (!isBranch(node)) fail('A tree root must be a branch', path);
    return node;
  };
  const expandTree = (tree: unknown, path: string): Obj => {
    if (!isObj(tree)) return fail('Expected a tree object', path);
    if (tree.root === undefined) return fail('The tree has no "root"', path);
    return { ...tree, root: expandRoot(tree.root, `${path}.root`) };
  };
  if (Array.isArray(value)) return { format: 'tree-weaver', version: 1, tree: { name: 'Untitled tree', root: expandRoot(value, 'root') } };
  if (!isObj(value)) return fail('Expected a document object or a list of nodes', '$');
  if (isObj(value.forest)) {
    const forest = value.forest;
    if (!Array.isArray(forest.trees)) return fail('"trees" must be a list', 'forest');
    return { ...value, forest: { ...forest, trees: forest.trees.map((t, i) => expandTree(t, `forest.trees[${i}]`)) } };
  }
  if (value.tree !== undefined) return { ...value, tree: expandTree(value.tree, 'tree') };
  if (Array.isArray(value.trees)) return { ...value, trees: value.trees.map((t, i) => expandTree(t, `trees[${i}]`)) };
  if (value.root !== undefined) return expandTree(value, '$');
  return { format: 'tree-weaver', version: 1, tree: { name: 'Untitled tree', root: expandRoot(value, 'root') } };
}
