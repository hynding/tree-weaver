import { createId, now } from './create';
import { isDisplayId } from './displays';
import type { Branch, DesignKit, DisplayStyles, Forest, Leaf, StyleMap, StyleRule, Tree, TreeNode } from './model';
import { SCHEMA_VERSION } from './model';
import { parseRulesCss, sanitizeSelector, withRules } from './rules';

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
const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : fallback;

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
  const list = Array.isArray(value) ? value.map((v) => str(v)) : typeof value === 'string' ? value.split(/\s+/) : [];
  return [...new Set(list.map((c) => c.trim()).filter(Boolean))];
}

export function normalizeNode(value: unknown, path = 'node', seen = new Set<string>()): TreeNode {
  if (typeof value === 'string') return uniq({ kind: 'leaf', id: '', type: 'text', value }, seen);
  if (!isObj(value)) throw new TreeDataError('Expected a branch or leaf object', path);
  const kind = value.kind ?? (value.tag !== undefined || value.children !== undefined ? 'branch' : 'leaf');
  if (kind === 'leaf') {
    const type = value.type === 'image' ? 'image' : 'text';
    const leaf: Leaf = { kind: 'leaf', id: str(value.id), type, value: str(value.value ?? value.text ?? value.src) };
    const attrs = stringMap(value.attrs);
    if (Object.keys(attrs).length) leaf.attrs = attrs;
    return uniq(leaf, seen);
  }
  if (kind !== 'branch') throw new TreeDataError(`Unknown node kind "${str(kind)}"`, path);
  const children = value.children === undefined ? [] : value.children;
  if (!Array.isArray(children)) throw new TreeDataError('"children" must be a list', path);
  const tag = str(value.tag, 'div').trim().toLowerCase() || 'div';
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
  uniq(branch, seen);
  branch.children = children.map((c, i) => normalizeNode(c, `${path}.children[${i}]`, seen));
  return branch;
}

function uniq<T extends TreeNode>(node: T, seen: Set<string>): T {
  if (!node.id || seen.has(node.id)) node.id = createId(node.kind === 'branch' ? 'b' : 'l');
  seen.add(node.id);
  return node;
}

export function normalizeTree(value: unknown, path = 'tree'): Tree {
  if (!isObj(value)) throw new TreeDataError('Expected a tree object', path);
  const rootValue = value.root ?? (value.kind === 'branch' ? value : undefined);
  let root: TreeNode;
  if (rootValue === undefined) {
    root = { kind: 'branch', id: createId('b'), tag: 'body', type: 'root', name: 'Body', classes: [], attrs: {}, styles: {}, children: [] };
  } else {
    root = normalizeNode(rootValue, `${path}.root`);
  }
  if (root.kind !== 'branch') throw new TreeDataError('A tree root must be a branch', `${path}.root`);
  root.tag = 'body';
  root.type ??= 'root';
  const ts = now();
  return {
    id: str(value.id) || createId('t'),
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
  return kit;
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
  const forest: Forest = {
    id: str(value.id) || createId('f'),
    name: str(value.name).trim() || 'Untitled forest',
    version: SCHEMA_VERSION,
    trees: trees.map((t, i) => normalizeTree(t, `${path}.trees[${i}]`)),
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
  return forest;
}

/** True for an absolute http(s) URL, the only kind a linked kit may load from. */
export function isStylesheetUrl(value: string): boolean {
  return /^https?:\/\/[^\s"'<>]+$/i.test(value.trim());
}
