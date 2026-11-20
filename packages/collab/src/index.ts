import * as Y from 'yjs';
import { isBranch, isStylesheetUrl, normalizeComponent, type Branch, type ComponentDef, type DesignKit, type DisplayStyles, type Forest, type Leaf, type Tree, type TreeNode } from '@tree-weaver/core';

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
 */

/** Transaction origin for changes made by this editor, so an undo manager can track only them. */
export const LOCAL_ORIGIN = 'tree-weaver-local';

type YNode = Y.Map<unknown>;

const maps = (doc: Y.Doc) => ({
  forest: doc.getMap<unknown>('forest'),
  trees: doc.getMap<YNode>('trees'),
  nodes: doc.getMap<YNode>('nodes'),
  kits: doc.getMap<YNode>('kits'),
});

/** The shared types an undo manager should watch. */
export function sharedTypes(doc: Y.Doc): Y.AbstractType<unknown>[] {
  const m = maps(doc);
  return [m.forest, m.trees, m.nodes, m.kits] as Y.AbstractType<unknown>[];
}

/* ------------------------------------------------------------------ order keys */

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;

/**
 * A key that sorts between `a` and `b` (either may be missing: the start or the end of the
 * list). Keys never end in "0", so there is always room for another key before one.
 */
export function keyBetween(a: string | undefined, b: string | undefined): string {
  const lo = a ?? '';
  let hi = b;
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
  const keys = ids.map(existing);
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

function writeNode(nodes: Y.Map<YNode>, p: Placed, order: string | undefined): void {
  let m = nodes.get(p.node.id);
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
    setIfChanged(m, 'attrs', Object.keys(n.attrs).length ? json(n.attrs) : undefined);
    setIfChanged(m, 'instance', n.instance ? json(n.instance) : undefined);
    const displays = new Set([...Object.keys(n.styles), ...[...m.keys()].filter((k) => k.startsWith('s:')).map((k) => k.slice(2))]);
    for (const d of displays) {
      const s = n.styles[d as keyof DisplayStyles];
      setIfChanged(m, `s:${d}`, s && Object.keys(s).length ? json(s) : undefined);
    }
  } else {
    setIfChanged(m, 'leaf', n.type);
    setIfChanged(m, 'value', n.value);
    setIfChanged(m, 'attrs', n.attrs && Object.keys(n.attrs).length ? json(n.attrs) : undefined);
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
    setIfChanged(m.forest as YNode, 'components', next.components?.length ? json(next.components) : undefined);

    // Trees.
    const treeKeys = orderKeys(
      next.trees.map((t) => t.id),
      (id) => m.trees.get(id)?.get('order') as string | undefined,
    );
    for (const tree of next.trees) {
      let t = m.trees.get(tree.id);
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
    const kitKeys = orderKeys(
      next.kits.map((k) => k.id),
      (id) => m.kits.get(id)?.get('order') as string | undefined,
    );
    for (const kit of next.kits) {
      let k = m.kits.get(kit.id);
      if (!k) {
        k = new Y.Map<unknown>();
        m.kits.set(kit.id, k);
      }
      setIfChanged(k, 'order', kitKeys.get(kit.id));
      setIfChanged(k, 'data', json(kit));
    }
    const kitIds = new Set(next.kits.map((k) => k.id));
    for (const k of prev?.kits ?? []) if (!kitIds.has(k.id)) m.kits.delete(k.id);

    // Order keys for children lists that changed. A child keeps its key only if it was
    // already under the same parent.
    const orders = new Map<string, string>();
    for (const [id, p] of after) {
      if (!isBranch(p.node)) continue;
      const ids = childIds(p.node);
      const old = before.get(id);
      if (prev && old && sameList(ids, childIds(old.node)) && ids.every((c) => m.nodes.get(c)?.get('order') !== undefined)) continue;
      const keys = orderKeys(ids, (c) => (m.nodes.get(c)?.get('parent') === id ? (m.nodes.get(c)?.get('order') as string | undefined) : undefined));
      for (const [c, k] of keys) orders.set(c, k);
    }
    // Roots sort first.
    for (const tree of next.trees) if (!orders.has(tree.root.id)) orders.set(tree.root.id, (m.nodes.get(tree.root.id)?.get('order') as string | undefined) ?? 'i');

    for (const [id, p] of after) {
      const old = before.get(id);
      // Unchanged nodes (same object, same place) need no writes.
      if (prev && old && old.node === p.node && old.parent === p.parent && old.tree === p.tree && !orders.has(id)) continue;
      writeNode(m.nodes, p, orders.get(id));
    }
    for (const id of before.keys()) if (!after.has(id)) m.nodes.delete(id);
    // Nodes of removed trees.
    if (prev) {
      for (const t of prev.trees) {
        if (treeIds.has(t.id)) continue;
        for (const [id, n] of m.nodes) if (n.get('tree') === t.id) m.nodes.delete(id);
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
  const stray = [...m.nodes.entries()].filter(([, n]) => !m.trees.has(n.get('tree') as string)).map(([id]) => id);
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

function readNode(id: string, m: YNode): TreeNode {
  if (m.get('kind') === 'leaf') {
    const attrs = stringMap(parse<unknown>(m.get('attrs'), undefined));
    const type = m.get('leaf');
    const value = m.get('value');
    const leaf: Leaf = { kind: 'leaf', id, type: type === 'image' || type === 'shape' ? type : 'text', value: typeof value === 'string' ? value : '' };
    if (attrs) leaf.attrs = attrs;
    return leaf;
  }
  const styles: DisplayStyles = {};
  for (const [k, v] of m) if (k.startsWith('s:')) styles[k.slice(2) as keyof DisplayStyles] = stringMap(parse<unknown>(v, {})) ?? {};
  const branch: Branch = {
    kind: 'branch',
    id,
    tag: typeof m.get('tag') === 'string' ? (m.get('tag') as string) : 'div',
    classes: stringList(parse<unknown>(m.get('classes'), [])),
    attrs: stringMap(parse<unknown>(m.get('attrs'), {})) ?? {},
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
export function readForest(doc: Y.Doc): Forest | null {
  if (!hasForest(doc)) return null;
  const m = maps(doc);
  // Group nodes by tree, and children by parent.
  const byTree = new Map<string, Map<string, YNode>>();
  for (const [id, n] of m.nodes) {
    const tree = n.get('tree') as string;
    if (!byTree.has(tree)) byTree.set(tree, new Map());
    byTree.get(tree)!.set(id, n);
  }
  const trees: (Tree & { order: string })[] = [];
  for (const [treeId, t] of m.trees) {
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
    const build = (id: string): TreeNode => {
      visited.add(id);
      const node = readNode(id, nodes.get(id)!);
      if (isBranch(node)) {
        for (const c of children.get(id) ?? []) if (!visited.has(c.id)) node.children.push(build(c.id));
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
      name: (t.get('name') as string) ?? 'Untitled tree',
      root,
      createdAt: (t.get('createdAt') as string) ?? '',
      updatedAt: (t.get('updatedAt') as string) ?? '',
      order: (t.get('order') as string) ?? '',
    });
  }
  trees.sort(byOrder);
  const kits = [...m.kits.entries()]
    .map(([id, k]) => ({ id, order: (k.get('order') as string) ?? '', kit: parse<DesignKit | null>(k.get('data'), null) }))
    .filter((k): k is { id: string; order: string; kit: DesignKit } => !!k.kit)
    .sort(byOrder)
    .filter((k) => isObj(k.kit) && typeof k.kit.css === 'string')
    .map((k) => {
      // A peer's kit link must still be a stylesheet URL, as on import.
      const kit: DesignKit = { ...k.kit, id: k.id, name: String(k.kit.name ?? ''), enabled: k.kit.enabled !== false };
      if (kit.href !== undefined && (typeof kit.href !== 'string' || !isStylesheetUrl(kit.href))) delete kit.href;
      return kit;
    });
  const rawComponents = parse<unknown>(m.forest.get('components'), undefined);
  const components: ComponentDef[] = [];
  for (const [i, c] of (Array.isArray(rawComponents) ? rawComponents : []).entries()) {
    try {
      components.push(normalizeComponent(c, `components[${i}]`));
    } catch {
      // A malformed definition is skipped; its instances keep their last expansion.
    }
  }
  const updatedAt = trees.reduce((latest, t) => (t.updatedAt > latest ? t.updatedAt : latest), (m.forest.get('createdAt') as string) ?? '');
  return {
    id: m.forest.get('id') as string,
    name: (m.forest.get('name') as string) ?? 'Shared forest',
    version: 1,
    trees: trees.map(({ order: _, ...t }) => t),
    kits,
    ...(components?.length ? { components } : {}),
    createdAt: (m.forest.get('createdAt') as string) ?? updatedAt,
    updatedAt,
  };
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
