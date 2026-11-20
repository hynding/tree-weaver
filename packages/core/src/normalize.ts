import { createId, now } from './create';
import { isDisplayId } from './displays';
import type { Branch, DesignKit, DisplayStyles, Forest, Leaf, StyleMap, StyleRule, Tree, TreeNode } from './model';
import { SCHEMA_VERSION } from './model';
import { parseRulesCss, sanitizeSelector, withRules } from './rules';
import { canonicalTag } from './svg';
import { COMPONENT_PROP_TYPES, isPropName, syncInstances, type ComponentDef, type ComponentInstance, type ComponentProp, type ComponentPropType, type ComponentVariant } from './components';
import { TOKEN_KINDS, TOKENS_KIT_SOURCE, isTokenName, sanitizeTokenValue, tokensFromCss, withTokens, type DesignToken, type TokenKind } from './tokens';

/**
 * Turn loosely shaped data (parsed JSON, YAML or XML) into valid model objects.
 * Missing ids and timestamps are filled in, unknown fields dropped, and duplicate
 * ids replaced, so anything that comes out is safe to put in the editor.
 */

export class TreeDataError extends Error {
  constructor(message: string, readonly path = '') {
    super(path ? `${message} (at ${path})` : message);
    this.name = 'TreeDataError';
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** C0 control characters other than tab and line breaks, and U+FFFE/U+FFFF: XML (and SVG) can't carry them. */
export const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
const str = (v: unknown, fallback = ''): string =>
  (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : fallback).replace(CONTROL_CHARS, '');

function stringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(value)) return out;
  for (const [k, v] of Object.entries(value)) if (v !== null && v !== undefined) out[k] = str(v);
  return out;
}

function normalizeStyles(value: unknown): DisplayStyles {
  const out: DisplayStyles = {};
  if (!isObj(value)) return out;
  for (const [display, map] of Object.entries(value)) {
    // Accept `base` as an alias of the base display, which other tools commonly call it.
    const id = display === 'base' ? 'lg' : display;
    if (!isDisplayId(id)) continue;
    const styles: StyleMap = stringMap(map);
    if (Object.keys(styles).length) out[id] = { ...out[id], ...styles };
  }
  return out;
}

function normalizeClasses(value: unknown): string[] {
  // A class can't hold whitespace (`class="a b"` is two classes), so entries are split on it.
  const list = Array.isArray(value) ? value.flatMap((v) => str(v).split(/\s+/)) : typeof value === 'string' ? value.split(/\s+/) : [];
  return [...new Set(list.map((c) => c.trim()).filter(Boolean))];
}

export function normalizeNode(value: unknown, path = 'node', seen = new Set<string>()): TreeNode {
  if (typeof value === 'string') return uniq({ kind: 'leaf', id: '', type: 'text', value }, seen);
  if (!isObj(value)) throw new TreeDataError('Expected a branch or leaf object', path);
  const kind = value.kind ?? (value.tag !== undefined || value.children !== undefined ? 'branch' : 'leaf');
  if (kind === 'leaf') {
    const type = value.type === 'image' || value.type === 'shape' ? value.type : 'text';
    let content = str(value.value ?? value.text ?? value.src);
    if (type === 'shape') content = canonicalTag(content);
    const leaf: Leaf = { kind: 'leaf', id: str(value.id), type, value: content };
    const attrs = stringMap(value.attrs);
    if (Object.keys(attrs).length) leaf.attrs = attrs;
    return uniq(leaf, seen);
  }
  if (kind !== 'branch') throw new TreeDataError(`Unknown node kind "${str(kind)}"`, path);
  const children = value.children === undefined ? [] : value.children;
  if (!Array.isArray(children)) throw new TreeDataError('"children" must be a list', path);
  const tag = canonicalTag(str(value.tag, 'div')) || 'div';
  const branch: Branch = {
    kind: 'branch',
    id: str(value.id),
    tag,
    classes: normalizeClasses(value.classes ?? value.class),
    attrs: stringMap(value.attrs),
    styles: normalizeStyles(value.styles),
    children: [],
  };
  if (value.type) branch.type = str(value.type);
  if (value.name) branch.name = str(value.name);
  const instance = normalizeInstance(value.instance);
  if (instance) branch.instance = instance;
  uniq(branch, seen);
  branch.children = children.map((c, i) => normalizeNode(c, `${path}.children[${i}]`, seen));
  return branch;
}

function normalizeInstance(value: unknown): ComponentInstance | undefined {
  if (!isObj(value) || !str(value.component)) return undefined;
  const out: ComponentInstance = { component: str(value.component) };
  const props = stringMap(value.props);
  if (Object.keys(props).length) out.props = props;
  const variants: ComponentInstance['variants'] = {};
  for (const [d, v] of Object.entries(isObj(value.variants) ? value.variants : {})) if (isDisplayId(d) && str(v)) variants[d] = str(v);
  if (Object.keys(variants).length) out.variants = variants;
  return out;
}

export function normalizeComponent(value: unknown, path = 'component'): ComponentDef {
  if (!isObj(value)) throw new TreeDataError('Expected a component object', path);
  const root = normalizeNode(value.root ?? { tag: 'div' }, `${path}.root`);
  if (root.kind !== 'branch') throw new TreeDataError('A component root must be a branch', `${path}.root`);
  delete root.instance;
  const props: ComponentProp[] = [];
  for (const [i, p] of (Array.isArray(value.props) ? value.props : []).entries()) {
    if (!isObj(p)) throw new TreeDataError('Expected a prop object', `${path}.props[${i}]`);
    const name = str(p.name).trim();
    if (!isPropName(name)) throw new TreeDataError(`"${name}" is not a prop name (letters, digits and _, starting with a letter)`, `${path}.props[${i}].name`);
    if (props.some((q) => q.name === name)) continue;
    const type = COMPONENT_PROP_TYPES.includes(p.type as ComponentPropType) ? (p.type as ComponentPropType) : 'text';
    const prop: ComponentProp = { name, type, default: str(p.default) };
    if (Array.isArray(p.options)) prop.options = p.options.map((o) => str(o)).filter(Boolean);
    if (p.description) prop.description = str(p.description);
    props.push(prop);
  }
  const variants: ComponentVariant[] = [];
  for (const [i, v] of (Array.isArray(value.variants) ? value.variants : []).entries()) {
    if (!isObj(v)) throw new TreeDataError('Expected a variant object', `${path}.variants[${i}]`);
    const name = str(v.name).trim();
    if (!name || variants.some((w) => w.name === name)) continue;
    const styles: Record<string, DisplayStyles> = {};
    for (const [id, s] of Object.entries(isObj(v.styles) ? v.styles : {})) {
      const ds = normalizeStyles(s);
      if (Object.keys(ds).length) styles[id] = ds;
    }
    const variant: ComponentVariant = { name, styles };
    if (v.description) variant.description = str(v.description);
    variants.push(variant);
  }
  const def: ComponentDef = { id: str(value.id) || createId('c'), name: str(value.name).trim() || 'Component', root, props, variants };
  if (value.description) def.description = str(value.description);
  return def;
}

function uniq<T extends TreeNode>(node: T, seen: Set<string>): T {
  if (!node.id || seen.has(node.id)) node.id = createId(node.kind === 'branch' ? 'b' : 'l');
  seen.add(node.id);
  return node;
}

export function normalizeTree(value: unknown, path = 'tree', seen = new Set<string>()): Tree {
  if (!isObj(value)) throw new TreeDataError('Expected a tree object', path);
  const rootValue = value.root ?? (value.kind === 'branch' ? value : undefined);
  let root: TreeNode;
  if (rootValue === undefined) {
    root = { kind: 'branch', id: createId('b'), tag: 'body', type: 'root', name: 'Body', classes: [], attrs: {}, styles: {}, children: [] };
  } else {
    root = normalizeNode(rootValue, `${path}.root`, seen);
  }
  if (root.kind !== 'branch') throw new TreeDataError('A tree root must be a branch', `${path}.root`);
  // The root is the page body, unless it is an <svg>: then the tree is an SVG tree (a drawing).
  if (root.tag !== 'svg') root.tag = 'body';
  root.type ??= 'root';
  const ts = now();
  return {
    // `component:` ids name a component opened as a tree (COMPONENT_TREE_PREFIX); a real tree can't use one.
    id: (str(value.id).startsWith('component:') ? '' : str(value.id)) || createId('t'),
    name: str(value.name).trim() || 'Untitled tree',
    root,
    createdAt: str(value.createdAt) || ts,
    updatedAt: str(value.updatedAt) || ts,
  };
}

export function normalizeKit(value: unknown, path = 'kit'): DesignKit {
  if (!isObj(value)) throw new TreeDataError('Expected a design kit object', path);
  const kit: DesignKit = {
    id: str(value.id) || createId('k'),
    name: str(value.name).trim() || 'Design kit',
    css: str(value.css),
    enabled: value.enabled === undefined ? true : value.enabled === true || value.enabled === 'true',
  };
  if (value.source) kit.source = str(value.source);
  if (isStylesheetUrl(str(value.href))) kit.href = str(value.href).trim();
  // Editable kits: their rules are the source of their CSS. Formats that only carry CSS
  // (XML, HTML) mark the kit `editable` and the rules are read back from the CSS.
  if (!kit.href && Array.isArray(value.rules)) return withRules(kit, normalizeRules(value.rules, `${path}.rules`));
  if (!kit.href && (value.editable === true || value.editable === 'true')) return withRules(kit, parseRulesCss(kit.css).rules);
  // Token kits: their tokens are the source of their CSS; from CSS-only formats, read them back.
  if (!kit.href && Array.isArray(value.tokens)) return withTokens(kit, normalizeTokens(value.tokens, `${path}.tokens`));
  if (!kit.href && kit.source === TOKENS_KIT_SOURCE) return withTokens(kit, tokensFromCss(kit.css));
  return kit;
}

function normalizeTokens(value: unknown[], path: string): DesignToken[] {
  const seen = new Set<string>();
  const out: DesignToken[] = [];
  value.forEach((t, i) => {
    if (!isObj(t)) throw new TreeDataError('Expected a token object', `${path}[${i}]`);
    const name = str(t.name).trim();
    if (!isTokenName(name)) throw new TreeDataError(`"${name}" is not a token name (use --letters-digits-and-dashes)`, `${path}[${i}].name`);
    const tokenValue = sanitizeTokenValue(str(t.value));
    if (!tokenValue || seen.has(name)) return;
    seen.add(name);
    const token: DesignToken = { name, value: tokenValue };
    if (TOKEN_KINDS.includes(t.kind as TokenKind)) token.kind = t.kind as TokenKind;
    if (t.description) token.description = str(t.description);
    out.push(token);
  });
  return out;
}

function normalizeRules(value: unknown[], path: string): StyleRule[] {
  const seen = new Set<string>();
  return value.map((r, i) => {
    if (!isObj(r)) throw new TreeDataError('Expected a style rule object', `${path}[${i}]`);
    let id = str(r.id);
    if (!id || seen.has(id)) id = createId('r');
    seen.add(id);
    return { id, selector: sanitizeSelector(str(r.selector)), styles: normalizeStyles(r.styles) };
  });
}

export function normalizeForest(value: unknown, path = 'forest'): Forest {
  if (!isObj(value)) throw new TreeDataError('Expected a forest object', path);
  const trees = value.trees === undefined ? [] : value.trees;
  const kits = value.kits === undefined ? [] : value.kits;
  if (!Array.isArray(trees)) throw new TreeDataError('"trees" must be a list', path);
  if (!Array.isArray(kits)) throw new TreeDataError('"kits" must be a list', path);
  const ts = now();
  const nodeIds = new Set<string>();
  const forest: Forest = {
    id: str(value.id) || createId('f'),
    name: str(value.name).trim() || 'Untitled forest',
    version: SCHEMA_VERSION,
    // One id set for every tree: node ids are unique across the forest (collab and diffs key nodes by id).
    trees: trees.map((t, i) => normalizeTree(t, `${path}.trees[${i}]`, nodeIds)),
    kits: kits.map((k, i) => normalizeKit(k, `${path}.kits[${i}]`)),
    createdAt: str(value.createdAt) || ts,
    updatedAt: str(value.updatedAt) || ts,
  };
  // Tree ids must be unique within a forest.
  const seen = new Set<string>();
  for (const tree of forest.trees) {
    if (seen.has(tree.id)) tree.id = createId('t');
    seen.add(tree.id);
  }
  // So must kit ids.
  const kitIds = new Set<string>();
  for (const kit of forest.kits) {
    if (kitIds.has(kit.id)) kit.id = createId('k');
    kitIds.add(kit.id);
  }
  if (Array.isArray(value.components) && value.components.length) {
    const ids = new Set<string>();
    forest.components = value.components.map((c, i) => {
      const def = normalizeComponent(c, `${path}.components[${i}]`);
      if (ids.has(def.id)) def.id = createId('c');
      ids.add(def.id);
      return def;
    });
    // Instances always show their component as it is now.
    return syncInstances(forest);
  }
  return forest;
}

/** True for an absolute http(s) URL, the only kind a linked kit may load from. */
export function isStylesheetUrl(value: string): boolean {
  return /^https?:\/\/[^\s"'<>]+$/i.test(value.trim());
}
