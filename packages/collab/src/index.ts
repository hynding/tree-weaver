import * as Y from 'yjs';
import { isBranch, normalizeComponent, normalizeKit, syncInstances, type Branch, type ComponentDef, type DesignKit, type DisplayStyles, type Forest, type Leaf, type Tree, type TreeNode } from '@tree-weaver/core';

/**
 * Live collaboration for Tree Weaver: a forest as a Yjs document, so people editing the same
 * forest at once merge their changes instead of overwriting each other's.
 *
 * Every branch and leaf is its own entry, keyed by id, holding its parent and its place among
 * its siblings (a fractional order key) rather than living inside its parent's child list. Two
 * people can then change different nodes, or different parts of one node (its text and its
 * tablet styles, say), and both changes stay. When two people change the same field, or move
 * the same node, the last write wins. Nothing is duplicated, even when two copies of a forest
 * are loaded into the same document.
 *
 * Layout of the document:
 *
 * - `forest`: `id`, `name`, `createdAt`, `version`
 * - `trees`: tree id → map of `name`, `root`, `order`, `createdAt`, `updatedAt`
 * - `nodes`: node id → map of `kind`, `tree`, `parent`, `order`, then `tag`, `type`, `name`,
 *   `classes`, `attrs` (branches) or `leaf`, `value`, `attrs` (leaves), and one `s:<display>`
 *   entry per display that has styles. Lists and maps are stored as JSON text.
 * - `kits`: kit id → map of `order` and `data` (the kit as JSON text)
 * - `components`: component id → map of `order` and `data` (the definition as JSON text), so
 *   two people saving different components at once both keep theirs
 */

/** Transaction origin for changes made by this editor, so an undo manager can track only them. */
export const LOCAL_ORIGIN = 'tree-weaver-local';

type YNode = Y.Map<unknown>;

/** A peer can put anything in the shared maps: only Y.Map entries are read (or written into). */
const asMap = (v: unknown): YNode | undefined => (v instanceof Y.Map ? (v as YNode) : undefined);
function* yMaps(map: Y.Map<any>): Generator<[string, YNode]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const [id, v] of map.entries()) if (v instanceof Y.Map) yield [id, v as YNode];
}

const maps = (doc: Y.Doc) => ({
  forest: doc.getMap<unknown>('forest'),
  trees: doc.getMap<YNode>('trees'),
  nodes: doc.getMap<YNode>('nodes'),
  kits: doc.getMap<YNode>('kits'),
  components: doc.getMap<YNode>('components'),
});

/** The shared types an undo manager should watch. */
export function sharedTypes(doc: Y.Doc): Y.AbstractType<unknown>[] {
  const m = maps(doc);
  return [m.forest, m.trees, m.nodes, m.kits, m.components] as Y.AbstractType<unknown>[];
}

/* ------------------------------------------------------------------ order keys */

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
/** A well-formed order key: base-36 digits, never ending in "0". */
const isKey = (k: string): boolean => /^[0-9a-z]*[1-9a-z]$/.test(k);

/**
 * A key that sorts between `a` and `b` (either may be missing: the start or the end of the
 * list). Keys never end in "0", so there is always room for another key before one.
 */
export function keyBetween(a: string | undefined, b: string | undefined): string {
  // A key that isn't one this module makes (a peer's) would never let the loop finish; treat it as missing.
  const lo = a !== undefined && isKey(a) ? a : '';
  let hi = b !== undefined && isKey(b) ? b : undefined;
  if (hi !== undefined && lo >= hi) hi = undefined;
  let out = '';
  for (let i = 0; ; i++) {
    const da = i < lo.length ? DIGITS.indexOf(lo[i]) : 0;
    const db = hi !== undefined ? (i < hi.length ? DIGITS.indexOf(hi[i]) : 0) : BASE;
    if (db - da > 1) return out + DIGITS[(da + db) >> 1];
    out += DIGITS[da];
    // Below `hi` already at this digit: anything longer stays below it.
    if (db - da === 1) hi = undefined;
  }
}

/**
 * Order keys for a list of ids, keeping the keys of as many items as possible (the longest run
 * already in order) and making new keys for the rest, so a move changes only the moved item.
 */
export function orderKeys(ids: string[], existing: (id: string) => string | undefined): Map<string, string> {
  // Keys from peers that aren't well formed get fresh ones.
  const keys = ids.map((id) => {
    const k = existing(id);
    return typeof k === 'string' && isKey(k) ? k : undefined;
  });
  // Longest strictly increasing run of existing keys.
  const tails: number[] = [];
  const prev = new Array<number>(ids.length).fill(-1);
  keys.forEach((k, i) => {
    if (k === undefined) return;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (keys[tails[mid]]! < k) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = i;
    prev[i] = lo > 0 ? tails[lo - 1] : -1;
  });
  const keep = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prev[i]) keep.add(i);
  const out = new Map<string, string>();
  let last: string | undefined;
  for (let i = 0; i < ids.length; i++) {
    if (keep.has(i)) {
      last = keys[i];
      out.set(ids[i], last!);
      continue;
    }
    let next: string | undefined;
    for (let j = i + 1; j < ids.length; j++) {
      if (keep.has(j)) {
        next = keys[j];
        break;
      }
    }
    last = keyBetween(last, next);
    out.set(ids[i], last);
  }
  return out;
}

/* ---------------------------------------------------------------------- writing */

const json = (v: unknown) => JSON.stringify(v);

function setIfChanged(map: YNode, key: string, value: unknown): void {
  if (value === undefined || value === null || value === '') {
    if (map.has(key)) map.delete(key);
  } else if (map.get(key) !== value) map.set(key, value);
}

interface Placed {
  node: TreeNode;
  tree: string;
  parent: string | null;
}

function indexForest(forest: Forest | null): Map<string, Placed> {
  const out = new Map<string, Placed>();
  if (!forest) return out;
  for (const tree of forest.trees) {
    const visit = (node: TreeNode, parent: string | null) => {
      out.set(node.id, { node, tree: tree.id, parent });
      if (isBranch(node)) node.children.forEach((c) => visit(c, node.id));
    };
    visit(tree.root, null);
  }
  return out;
}

/**
 * Write a record as one key per entry (`<prefix><name>`), so two peers changing different entries
 * both keep their change. Entries `old` held that `next` doesn't are removed; without `old` (a full
 * write), every stored entry `next` doesn't hold is.
 */
function writeEntries(m: YNode, prefix: string, next: Record<string, string> | undefined, old: Record<string, string> | undefined | null): void {
  // An empty value is kept: `disabled=""`, `checked=""` and `alt=""` are attributes that are set.
  for (const [k, v] of Object.entries(next ?? {})) if (m.get(`${prefix}${k}`) !== v) m.set(`${prefix}${k}`, v);
  const gone = old === null ? [...m.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)) : Object.keys(old ?? {});
  for (const k of gone) if ((!next || !Object.hasOwn(next, k)) && m.has(`${prefix}${k}`)) m.delete(`${prefix}${k}`);
}

/**
 * A kit's rules (`r:<rule id>`) and tokens (`t:<name>`) are entries of their own, each with an
 * order key, so two peers editing different classes or tokens of one kit both keep their edit.
 * The rest of the kit is one JSON string (`data`); its CSS is rebuilt from the entries when read.
 */
function writeKit(k: YNode, kit: DesignKit, old: DesignKit | undefined): void {
  const { rules, tokens, ...rest } = kit;
  const split = !!(rules || tokens);
  setIfChanged(k, 'data', json({ ...rest, ...(split ? { css: '' } : {}), ...(rules ? { rules: [] } : {}), ...(tokens ? { tokens: [] } : {}) }));
  const entries = <T>(prefix: string, list: T[] | undefined, oldList: T[] | undefined, key: (x: T) => string) => {
    const stored = (id: string) => parse<{ order?: string } | null>(k.get(`${prefix}${id}`), null)?.order;
    const orders = orderKeys((list ?? []).map(key), stored);
    for (const x of list ?? []) setIfChanged(k, `${prefix}${key(x)}`, json({ order: orders.get(key(x)), value: x }));
    const ids = new Set((list ?? []).map(key));
    const gone = old ? (oldList ?? []).map(key) : [...k.keys()].filter((x) => x.startsWith(prefix)).map((x) => x.slice(prefix.length));
    for (const id of gone) if (!ids.has(id)) setIfChanged(k, `${prefix}${id}`, undefined);
  };
  entries('r:', rules, old?.rules, (r) => r.id);
  entries('t:', tokens, old?.tokens, (t) => t.name);
}

/** A kit as `writeKit` stored it (or as one `data` string, in older documents). */
function readKit(k: YNode): DesignKit | null {
  const kit = parse<DesignKit | null>(k.get('data'), null);
  if (!isObj(kit)) return null;
  const list = (prefix: string) =>
    [...k.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, v]) => ({ id: key.slice(prefix.length), entry: parse<unknown>(v, null) }))
      .map(({ id, entry }) => ({ id, order: isObj(entry) && typeof entry.order === 'string' ? entry.order : '', value: isObj(entry) ? entry.value : undefined }))
      .sort(byOrder)
      .map((e) => e.value)
      .filter(isObj);
  // Empty lists in `data` mean the entries hold them; older documents kept them in `data`.
  // normalizeKit checks the entries afterwards and builds the CSS from them.
  if (Array.isArray(kit.rules) && !kit.rules.length) return { ...kit, rules: list('r:') as never };
  if (Array.isArray(kit.tokens) && !kit.tokens.length) return { ...kit, tokens: list('t:') as never };
  return kit;
}

/** Style keys: `sp:<display>:<property>`. (Older documents held one `s:<display>` JSON string.) */
const STYLE_KEY = /^sp:([^:]+):(.+)$/;

function writeNode(nodes: Y.Map<YNode>, p: Placed, order: string | undefined, old: TreeNode | undefined): void {
  let m = asMap(nodes.get(p.node.id));
  if (!m) {
    m = new Y.Map<unknown>();
    nodes.set(p.node.id, m);
  }
  const n = p.node;
  setIfChanged(m, 'kind', n.kind);
  setIfChanged(m, 'tree', p.tree);
  setIfChanged(m, 'parent', p.parent);
  if (order !== undefined) setIfChanged(m, 'order', order);
  if (isBranch(n)) {
    setIfChanged(m, 'tag', n.tag);
    setIfChanged(m, 'type', n.type);
    setIfChanged(m, 'name', n.name);
    setIfChanged(m, 'classes', n.classes.length ? json(n.classes) : undefined);
    setIfChanged(m, 'instance', n.instance ? json(n.instance) : undefined);
    // One key per attribute and per style property, so concurrent edits to different ones merge.
    const prior = old && isBranch(old) ? old : null;
    const legacy = [...m.keys()].some((k) => k === 'attrs' || k.startsWith('s:'));
    writeEntries(m, 'a:', n.attrs, legacy ? null : prior?.attrs ?? null);
    setIfChanged(m, 'attrs', undefined);
    const displays = new Set([...Object.keys(n.styles), ...Object.keys(prior?.styles ?? {}), ...[...m.keys()].flatMap((k) => STYLE_KEY.exec(k)?.[1] ?? (k.startsWith('s:') ? k.slice(2) : []))]);
    for (const d of displays) {
      setIfChanged(m, `s:${d}`, undefined);
      writeEntries(m, `sp:${d}:`, n.styles[d as keyof DisplayStyles], legacy || !prior ? null : prior.styles[d as keyof DisplayStyles] ?? {});
    }
  } else {
    setIfChanged(m, 'leaf', n.type);
    setIfChanged(m, 'value', n.value);
    const prior = old && !isBranch(old) ? old : null;
    const legacy = m.has('attrs');
    writeEntries(m, 'a:', n.attrs, legacy || !prior ? null : prior.attrs ?? {});
    setIfChanged(m, 'attrs', undefined);
  }
}

const childIds = (node: TreeNode | undefined) => (node && isBranch(node) ? node.children.map((c) => c.id) : []);
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Write the change from `prev` (the forest the document last showed) to `next` into the
 * document, touching only what changed. With `prev` null, writes the whole forest (merging
 * with whatever the document holds: entries with the same ids are updated, not duplicated).
 */
export function writeForest(doc: Y.Doc, prev: Forest | null, next: Forest, origin: unknown = LOCAL_ORIGIN): void {
  const m = maps(doc);
  const before = indexForest(prev);
  const after = indexForest(next);
  doc.transact(() => {
    setIfChanged(m.forest as YNode, 'id', next.id);
    setIfChanged(m.forest as YNode, 'name', next.name);
    setIfChanged(m.forest as YNode, 'createdAt', next.createdAt);
    setIfChanged(m.forest as YNode, 'version', next.version);

    // Trees.
    const treeKeys = orderKeys(
      next.trees.map((t) => t.id),
      (id) => asMap(m.trees.get(id))?.get('order') as string | undefined,
    );
    for (const tree of next.trees) {
      let t = asMap(m.trees.get(tree.id));
      if (!t) {
        t = new Y.Map<unknown>();
        m.trees.set(tree.id, t);
      }
      setIfChanged(t, 'name', tree.name);
      setIfChanged(t, 'root', tree.root.id);
      setIfChanged(t, 'order', treeKeys.get(tree.id));
      setIfChanged(t, 'createdAt', tree.createdAt);
      setIfChanged(t, 'updatedAt', tree.updatedAt);
    }
    const treeIds = new Set(next.trees.map((t) => t.id));
    for (const t of prev?.trees ?? []) if (!treeIds.has(t.id)) m.trees.delete(t.id);

    // Kits.
    const prevKits = new Map((prev?.kits ?? []).map((k) => [k.id, k]));
    const kitKeys = orderKeys(
      next.kits.map((k) => k.id),
      (id) => asMap(m.kits.get(id))?.get('order') as string | undefined,
    );
    for (const kit of next.kits) {
      let k = asMap(m.kits.get(kit.id));
      if (!k) {
        k = new Y.Map<unknown>();
        m.kits.set(kit.id, k);
      }
      setIfChanged(k, 'order', kitKeys.get(kit.id));
      writeKit(k, kit, prevKits.get(kit.id));
    }
    const kitIds = new Set(next.kits.map((k) => k.id));
    for (const k of prev?.kits ?? []) if (!kitIds.has(k.id)) m.kits.delete(k.id);

    // Components, one entry each.
    const components = next.components ?? [];
    const componentKeys = orderKeys(
      components.map((c) => c.id),
      (id) => asMap(m.components.get(id))?.get('order') as string | undefined,
    );
    for (const def of components) {
      let c = asMap(m.components.get(def.id));
      if (!c) {
        c = new Y.Map<unknown>();
        m.components.set(def.id, c);
      }
      setIfChanged(c, 'order', componentKeys.get(def.id));
      setIfChanged(c, 'data', json(def));
    }
    const componentIds = new Set(components.map((c) => c.id));
    for (const c of prev?.components ?? []) if (!componentIds.has(c.id)) m.components.delete(c.id);

    // Order keys for children lists that changed. A child keeps its key only if it was
    // already under the same parent.
    const orders = new Map<string, string>();
    for (const [id, p] of after) {
      if (!isBranch(p.node)) continue;
      const ids = childIds(p.node);
      const old = before.get(id);
      // Kept only when every child is stored under this branch already: a child re-attached here
      // after its parent was deleted elsewhere still names that parent and needs a new key.
      const stored = (c: string) => {
        const n = asMap(m.nodes.get(c));
        return n?.get('order') !== undefined && n.get('parent') === id;
      };
      if (prev && old && sameList(ids, childIds(old.node)) && ids.every(stored)) continue;
      const keys = orderKeys(ids, (c) => (asMap(m.nodes.get(c))?.get('parent') === id ? (asMap(m.nodes.get(c))?.get('order') as string | undefined) : undefined));
      for (const [c, k] of keys) orders.set(c, k);
    }
    // Roots sort first.
    for (const tree of next.trees) if (!orders.has(tree.root.id)) orders.set(tree.root.id, (asMap(m.nodes.get(tree.root.id))?.get('order') as string | undefined) ?? 'i');

    for (const [id, p] of after) {
      const old = before.get(id);
      // Unchanged nodes (same object, same place) need no writes.
      if (prev && old && old.node === p.node && old.parent === p.parent && old.tree === p.tree && !orders.has(id)) continue;
      writeNode(m.nodes, p, orders.get(id), prev && old?.tree === p.tree ? old.node : undefined);
    }
    for (const id of before.keys()) if (!after.has(id)) m.nodes.delete(id);
    // Nodes of removed trees.
    if (prev) {
      for (const t of prev.trees) {
        if (treeIds.has(t.id)) continue;
        for (const [id, n] of yMaps(m.nodes)) if (n.get('tree') === t.id) m.nodes.delete(id);
      }
    }
  }, origin);
}

/**
 * Remove nodes whose tree is gone (someone deleted the tree while someone else was adding to it),
 * so they don't pile up in the document. Returns how many were removed.
 */
export function pruneStrays(doc: Y.Doc, origin: unknown = 'tree-weaver-prune'): number {
  const m = maps(doc);
  const stray = [...m.nodes.entries()].filter(([, n]) => !(n instanceof Y.Map) || !m.trees.has(n.get('tree') as string)).map(([id]) => id);
  if (stray.length) doc.transact(() => stray.forEach((id) => m.nodes.delete(id)), origin);
  return stray.length;
}

/* ---------------------------------------------------------------------- reading */

const parse = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

/* A peer's document is not trusted to hold the right shapes: anything malformed reads as empty. */
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const stringMap = (v: unknown): Record<string, string> | undefined =>
  isObj(v) ? Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string')) : undefined;
const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Set an own property, even one named `__proto__` (a peer chooses the names). Returns the value. */
function put<T>(obj: object, key: string, value: T): T {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
  return value;
}

function readNode(id: string, m: YNode): TreeNode {
  if (m.get('kind') === 'leaf') {
    let attrs = stringMap(parse<unknown>(m.get('attrs'), undefined));
    for (const [k, v] of m) if (k.startsWith('a:') && typeof v === 'string') put((attrs ??= {}), k.slice(2), v);
    const type = m.get('leaf');
    const value = m.get('value');
    const leaf: Leaf = { kind: 'leaf', id, type: type === 'image' || type === 'shape' ? type : 'text', value: typeof value === 'string' ? value : '' };
    if (attrs) leaf.attrs = attrs;
    return leaf;
  }
  const styles: DisplayStyles = {};
  const attrs: Record<string, string> = stringMap(parse<unknown>(m.get('attrs'), {})) ?? {};
  for (const [k, v] of m) if (k.startsWith('s:')) styles[k.slice(2) as keyof DisplayStyles] = stringMap(parse<unknown>(v, {})) ?? {};
  for (const [k, v] of m) {
    if (typeof v !== 'string') continue;
    const style = STYLE_KEY.exec(k);
    if (style) put(Object.hasOwn(styles, style[1]) ? styles[style[1] as keyof DisplayStyles]! : put(styles, style[1], {}), style[2], v);
    else if (k.startsWith('a:')) put(attrs, k.slice(2), v);
  }
  const branch: Branch = {
    kind: 'branch',
    id,
    tag: typeof m.get('tag') === 'string' ? (m.get('tag') as string) : 'div',
    classes: stringList(parse<unknown>(m.get('classes'), [])),
    attrs,
    styles,
    children: [],
  };
  const type = m.get('type');
  const name = m.get('name');
  if (typeof type === 'string') branch.type = type;
  if (typeof name === 'string') branch.name = name;
  const instance = parse<unknown>(m.get('instance'), undefined);
  if (isObj(instance) && typeof instance.component === 'string') {
    branch.instance = { component: instance.component };
    const props = stringMap(instance.props);
    const variants = stringMap(instance.variants);
    if (props) branch.instance.props = props;
    if (variants) branch.instance.variants = variants;
  }
  return branch;
}

const byOrder = (a: { order: string; id: string }, b: { order: string; id: string }) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Whether the document holds a forest yet (a new guest's document starts empty). */
export function hasForest(doc: Y.Doc): boolean {
  const m = maps(doc);
  return typeof m.forest.get('id') === 'string' && m.trees.size > 0;
}

/**
 * The forest the document holds, or null while it is empty. Every peer builds the same forest
 * from the same document: a node whose parent is gone (deleted by someone else while they
 * added to it), or that two concurrent moves left in a loop, goes at the end of its tree's root.
 */
/** A peer's value as a string, or the fallback when it isn't one. */
const strOr = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);

const MAX_DEPTH = 200;

export function readForest(doc: Y.Doc): Forest | null {
  if (!hasForest(doc)) return null;
  const m = maps(doc);
  // Group nodes by tree, and children by parent.
  const byTree = new Map<string, Map<string, YNode>>();
  for (const [id, n] of yMaps(m.nodes)) {
    const tree = n.get('tree') as string;
    if (!byTree.has(tree)) byTree.set(tree, new Map());
    byTree.get(tree)!.set(id, n);
  }
  const trees: (Tree & { order: string })[] = [];
  for (const [treeId, t] of yMaps(m.trees)) {
    const nodes = byTree.get(treeId) ?? new Map<string, YNode>();
    const rootId = t.get('root') as string;
    const rootMap = nodes.get(rootId);
    if (!rootMap || rootMap.get('kind') === 'leaf') continue;
    const children = new Map<string, { id: string; order: string }[]>();
    for (const [id, n] of nodes) {
      if (id === rootId) continue;
      const parent = n.get('parent') as string;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent)!.push({ id, order: (n.get('order') as string) ?? '' });
    }
    for (const list of children.values()) list.sort(byOrder);
    const visited = new Set<string>();
    // Nesting deeper than any real layout (a peer's long parent chain) is cut: what lies below
    // is attached to the root as strays, so reading and rendering can't run out of stack.
    const build = (id: string, depth = 0): TreeNode => {
      visited.add(id);
      const node = readNode(id, nodes.get(id)!);
      if (isBranch(node) && depth < MAX_DEPTH) {
        for (const c of children.get(id) ?? []) if (!visited.has(c.id)) node.children.push(build(c.id, depth + 1));
      }
      return node;
    };
    const root = build(rootId) as Branch;
    // Strays: a missing parent, a leaf parent, or a loop. Attach the top of each to the root.
    const strays = [...nodes.keys()].filter((id) => !visited.has(id)).sort();
    for (const start of strays) {
      if (visited.has(start)) continue;
      const seen = new Set<string>([start]);
      let top = start;
      for (;;) {
        const parent = nodes.get(top)!.get('parent') as string;
        const pm = nodes.get(parent);
        if (!pm || visited.has(parent) || seen.has(parent) || pm.get('kind') === 'leaf') break;
        seen.add(parent);
        top = parent;
      }
      root.children.push(build(top));
    }
    trees.push({
      id: treeId,
      name: strOr(t.get('name'), 'Untitled tree'),
      root,
      createdAt: strOr(t.get('createdAt'), ''),
      updatedAt: strOr(t.get('updatedAt'), ''),
      order: strOr(t.get('order'), ''),
    });
  }
  trees.sort(byOrder);
  const kits = [...yMaps(m.kits)]
    .map(([id, k]) => ({ id, order: (k.get('order') as string) ?? '', kit: readKit(k) }))
    .filter((k): k is { id: string; order: string; kit: DesignKit } => !!k.kit)
    .sort(byOrder)
    .filter((k) => isObj(k.kit) && typeof k.kit.css === 'string')
    .flatMap((k) => {
      // A peer's kit goes through the same checks as an imported one (rules, tokens, link);
      // a malformed one is skipped rather than breaking every client that reads it.
      try {
        return [{ ...normalizeKit({ ...k.kit, id: k.id }, `kits.${k.id}`), name: String(k.kit.name ?? '') }];
      } catch {
        return [];
      }
    });
  const components: ComponentDef[] = [];
  const componentEntries = [...yMaps(m.components)].map(([id, c]) => ({ id, order: (c.get('order') as string) ?? '', data: parse<unknown>(c.get('data'), null) })).sort(byOrder);
  for (const c of componentEntries) {
    try {
      components.push({ ...normalizeComponent(c.data, `components.${c.id}`), id: c.id });
    } catch {
      // A malformed definition is skipped; its instances keep their last expansion.
    }
  }
  const updatedAt = trees.reduce((latest, t) => (t.updatedAt > latest ? t.updatedAt : latest), strOr(m.forest.get('createdAt'), ''));
  // Instances are expanded again from the shared components: two peers' edits to one component
  // keep only one definition, and every canvas should show that one now, not on the next load.
  return syncInstances({
    id: strOr(m.forest.get('id'), ''),
    name: strOr(m.forest.get('name'), 'Shared forest'),
    version: 1,
    trees: trees.map(({ order: _, ...t }) => t),
    kits,
    ...(components?.length ? { components } : {}),
    createdAt: strOr(m.forest.get('createdAt'), updatedAt),
    updatedAt,
  });
}

/* ------------------------------------------------------------------ share links */

/** A room to collaborate in: its name, and the key that encrypts everything sent in it. */
export interface CollabRoom {
  room: string;
  key: string;
}

function randomToken(bytes: number): string {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((b) => DIGITS[b % BASE]).join('');
}

/** A new room with a random name and key. */
export const newRoom = (): CollabRoom => ({ room: `tw-${randomToken(12)}`, key: randomToken(24) });

/** The `#collab=` part of a share link. The key stays in the fragment, which browsers never send to a server. */
export const roomHash = (r: CollabRoom): string => `collab=${r.room}.${r.key}`;

/** Read `#collab=<room>.<key>` from a URL hash. */
export function parseRoomHash(hash: string): CollabRoom | null {
  const m = /(?:^#|&)collab=(tw-[0-9a-z]{6,64})\.([0-9a-z]{16,128})(?:&|$)/.exec(hash);
  return m ? { room: m[1], key: m[2] } : null;
}

export { Y };
