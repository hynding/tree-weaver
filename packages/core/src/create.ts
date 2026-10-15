import type { Branch, DesignKit, DisplayStyles, Forest, Leaf, LeafType, Tree, TreeNode } from './model';
import { SCHEMA_VERSION } from './model';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short random id with a readable prefix, e.g. `b_k3j9x0qa`. */
export function createId(prefix: string): string {
  let out = '';
  const bytes = new Uint8Array(8);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}

export const now = (): string => new Date().toISOString();

export interface BranchInit {
  tag?: string;
  type?: string;
  name?: string;
  classes?: string[];
  attrs?: Record<string, string>;
  styles?: DisplayStyles;
  children?: TreeNode[];
}

export function createBranch(init: BranchInit = {}): Branch {
  const branch: Branch = {
    kind: 'branch',
    id: createId('b'),
    tag: init.tag ?? 'div',
    classes: init.classes ? [...init.classes] : [],
    attrs: { ...init.attrs },
    styles: cloneStyles(init.styles ?? {}),
    children: init.children ? [...init.children] : [],
  };
  if (init.type) branch.type = init.type;
  if (init.name) branch.name = init.name;
  return branch;
}

export function createLeaf(value = '', type: LeafType = 'text', attrs?: Record<string, string>): Leaf {
  const leaf: Leaf = { kind: 'leaf', id: createId('l'), type, value };
  if (attrs && Object.keys(attrs).length) leaf.attrs = { ...attrs };
  return leaf;
}

/** Shorthand for a text leaf. */
export const text = (value: string): Leaf => createLeaf(value, 'text');

export function createTree(name = 'Untitled tree', root?: Branch): Tree {
  const ts = now();
  return {
    id: createId('t'),
    name,
    root: root ?? createBranch({ tag: 'body', type: 'root', name: 'Body' }),
    createdAt: ts,
    updatedAt: ts,
  };
}

export function createForest(name = 'Untitled forest', trees?: Tree[]): Forest {
  const ts = now();
  return {
    id: createId('f'),
    name,
    version: SCHEMA_VERSION,
    trees: trees ?? [createTree('Home')],
    kits: [],
    createdAt: ts,
    updatedAt: ts,
  };
}

export function createKit(name: string, css: string, source?: string): DesignKit {
  const kit: DesignKit = { id: createId('k'), name, css, enabled: true };
  if (source) kit.source = source;
  return kit;
}

export function cloneStyles(styles: DisplayStyles): DisplayStyles {
  const out: DisplayStyles = {};
  for (const [display, map] of Object.entries(styles)) {
    if (map) out[display as keyof DisplayStyles] = { ...map };
  }
  return out;
}

/** Deep clone a node. With `freshIds` every branch and leaf gets a new id (for duplicates and inserts). */
export function cloneNode<T extends TreeNode>(node: T, freshIds = false): T {
  if (node.kind === 'leaf') {
    const leaf: Leaf = { ...node, id: freshIds ? createId('l') : node.id };
    if (node.attrs) leaf.attrs = { ...node.attrs };
    return leaf as T;
  }
  const branch: Branch = {
    ...node,
    id: freshIds ? createId('b') : node.id,
    classes: [...node.classes],
    attrs: { ...node.attrs },
    styles: cloneStyles(node.styles),
    children: node.children.map((c) => cloneNode(c, freshIds)),
  };
  return branch as T;
}

export function cloneTree(tree: Tree, freshIds = false): Tree {
  const ts = now();
  return {
    ...tree,
    id: freshIds ? createId('t') : tree.id,
    root: cloneNode(tree.root, freshIds),
    ...(freshIds ? { createdAt: ts, updatedAt: ts } : {}),
  };
}
