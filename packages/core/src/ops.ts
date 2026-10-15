import { cloneNode } from './create';
import type { Branch, DisplayId, Forest, StyleMap, Tree, TreeNode } from './model';
import { isBranch } from './model';

/**
 * Pure, immutable operations on trees. Every mutation returns a new root and only
 * copies the branches along the path to the change, so unchanged subtrees are shared.
 */

/** Tags that can never hold children. */
export const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);

export function canHaveChildren(node: TreeNode | null | undefined): node is Branch {
  return isBranch(node) && !VOID_TAGS.has(node.tag.toLowerCase());
}

export type Visitor = (node: TreeNode, parent: Branch | null, index: number, depth: number) => void | false;

/** Depth-first, pre-order walk. Return `false` from the visitor to skip a node's children. */
export function walk(root: TreeNode, visit: Visitor): void {
  const step = (node: TreeNode, parent: Branch | null, index: number, depth: number) => {
    if (visit(node, parent, index, depth) === false) return;
    if (isBranch(node)) node.children.forEach((child, i) => step(child, node, i, depth + 1));
  };
  step(root, null, 0, 0);
}

export function findNode(root: TreeNode, id: string): TreeNode | null {
  let found: TreeNode | null = null;
  walk(root, (node) => {
    if (found) return false;
    if (node.id === id) found = node;
  });
  return found;
}

/** Branches from the root down to (and excluding) the node with `id`. Empty when not found or root. */
export function ancestorsOf(root: Branch, id: string): Branch[] {
  const path: Branch[] = [];
  const search = (branch: Branch): boolean => {
    for (const child of branch.children) {
      if (child.id === id) return true;
      if (isBranch(child)) {
        path.push(child);
        if (search(child)) return true;
        path.pop();
      }
    }
    return false;
  };
  if (root.id === id) return [];
  path.push(root);
  return search(root) ? path : [];
}

export function findParent(root: Branch, id: string): { parent: Branch; index: number } | null {
  const chain = ancestorsOf(root, id);
  const parent = chain[chain.length - 1];
  if (!parent) return null;
  return { parent, index: parent.children.findIndex((c) => c.id === id) };
}

export function countNodes(root: TreeNode): { branches: number; leaves: number } {
  const count = { branches: 0, leaves: 0 };
  walk(root, (n) => {
    if (isBranch(n)) count.branches++;
    else count.leaves++;
  });
  return count;
}

/** Replace the node with `id` by `updater(node)`, copying the path to it. Returns the same root if nothing changed. */
export function updateNode(root: Branch, id: string, updater: (node: TreeNode) => TreeNode): Branch {
  const rec = (node: TreeNode): TreeNode => {
    if (node.id === id) return updater(node);
    if (!isBranch(node)) return node;
    let changed = false;
    const children = node.children.map((child) => {
      const next = rec(child);
      if (next !== child) changed = true;
      return next;
    });
    return changed ? { ...node, children } : node;
  };
  const next = rec(root);
  if (!isBranch(next)) throw new Error('The root of a tree must stay a branch');
  return next;
}

export function updateBranch(root: Branch, id: string, patch: Partial<Omit<Branch, 'kind' | 'id'>>): Branch {
  return updateNode(root, id, (node) => (isBranch(node) ? { ...node, ...patch } : node));
}

/** Insert `node` into the branch `parentId` at `index` (appends when omitted). */
export function insertNode(root: Branch, parentId: string, node: TreeNode, index?: number): Branch {
  return updateNode(root, parentId, (parent) => {
    if (!canHaveChildren(parent)) throw new Error(`"${parentId}" cannot hold children`);
    const children = [...parent.children];
    const at = index === undefined ? children.length : Math.max(0, Math.min(index, children.length));
    children.splice(at, 0, node);
    return { ...parent, children };
  });
}

export function removeNode(root: Branch, id: string): Branch {
  if (root.id === id) throw new Error('The root branch cannot be removed');
  const hit = findParent(root, id);
  if (!hit) return root;
  return updateNode(root, hit.parent.id, (parent) => ({
    ...(parent as Branch),
    children: (parent as Branch).children.filter((c) => c.id !== id),
  }));
}

export function isDescendant(root: Branch, ancestorId: string, id: string): boolean {
  const ancestor = findNode(root, ancestorId);
  if (!ancestor || ancestorId === id) return false;
  return findNode(ancestor, id) !== null;
}

/**
 * Move node `id` into `targetParentId` before the child currently at `index`
 * (appends when omitted). Index is measured before the node is taken out, which is
 * what drag and drop hit-testing produces.
 */
export function moveNode(root: Branch, id: string, targetParentId: string, index?: number): Branch {
  if (id === root.id) throw new Error('The root branch cannot be moved');
  if (id === targetParentId || isDescendant(root, id, targetParentId)) {
    throw new Error('A branch cannot be moved inside itself');
  }
  const node = findNode(root, id);
  const from = findParent(root, id);
  if (!node || !from) return root;
  let at = index;
  if (at !== undefined && from.parent.id === targetParentId && from.index < at) at -= 1;
  return insertNode(removeNode(root, id), targetParentId, node, at);
}

/** Duplicate a node (with fresh ids) right after itself. */
export function duplicateNode(root: Branch, id: string): { root: Branch; id: string } {
  const node = findNode(root, id);
  const hit = findParent(root, id);
  if (!node || !hit) return { root, id };
  const copy = cloneNode(node, true);
  return { root: insertNode(root, hit.parent.id, copy, hit.index + 1), id: copy.id };
}

/** Wrap a node in a new branch, which takes the node's place. */
export function wrapNode(root: Branch, id: string, wrapper: Branch): Branch {
  const node = findNode(root, id);
  const hit = findParent(root, id);
  if (!node || !hit) return root;
  const wrapped: Branch = { ...wrapper, children: [...wrapper.children, node] };
  return updateNode(root, hit.parent.id, (parent) => {
    const children = [...(parent as Branch).children];
    children[hit.index] = wrapped;
    return { ...(parent as Branch), children };
  });
}

/** Set (or with `null` / empty string, clear) one style property on one display. */
export function setStyle(root: Branch, id: string, display: DisplayId, prop: string, value: string | null): Branch {
  return updateNode(root, id, (node) => {
    if (!isBranch(node)) return node;
    const current: StyleMap = { ...node.styles[display] };
    if (value === null || value.trim() === '') delete current[prop];
    else current[prop] = value.trim();
    const styles = { ...node.styles };
    if (Object.keys(current).length) styles[display] = current;
    else delete styles[display];
    return { ...node, styles };
  });
}

export function setStyles(root: Branch, id: string, display: DisplayId, patch: Record<string, string | null>): Branch {
  return Object.entries(patch).reduce((acc, [prop, value]) => setStyle(acc, id, display, prop, value), root);
}

/** Replace a tree inside a forest. Touches `updatedAt` on both. */
export function replaceTree(forest: Forest, tree: Tree): Forest {
  const ts = new Date().toISOString();
  return {
    ...forest,
    trees: forest.trees.map((t) => (t.id === tree.id ? { ...tree, updatedAt: ts } : t)),
    updatedAt: ts,
  };
}

/** Apply `fn` to the root of tree `treeId` inside a forest. */
export function updateTreeRoot(forest: Forest, treeId: string, fn: (root: Branch) => Branch): Forest {
  const tree = forest.trees.find((t) => t.id === treeId);
  if (!tree) return forest;
  const root = fn(tree.root);
  return root === tree.root ? forest : replaceTree(forest, { ...tree, root });
}
