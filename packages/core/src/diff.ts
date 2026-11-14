import { isBranch, type Branch, type DesignKit, type Forest, type Tree, type TreeNode } from './model';

/**
 * Differences between two versions of a tree or forest, for reviewing a change (an agent's
 * patch, an undo step, a saved version) before keeping or rolling it back. Nodes are matched
 * by id, so a node that moved keeps its identity.
 */

export type NodeChangeKind = 'added' | 'removed' | 'moved' | 'changed';

/** What changed on a node that is in both versions. */
export type NodeField = 'tag' | 'name' | 'type' | 'classes' | 'attrs' | 'styles' | 'value' | 'leaf type';

export interface NodeChange {
  kind: NodeChangeKind;
  id: string;
  /** A short human name for the node: its name, type, tag, or the start of its text. */
  label: string;
  /** For `changed`: which parts changed. */
  fields?: NodeField[];
  /** For `changed` styles: the displays whose styles changed. */
  displays?: string[];
}

export interface TreeDiff {
  id: string;
  name: string;
  status: 'added' | 'removed' | 'changed' | 'unchanged';
  /** Set when the tree's name changed. */
  renamed?: { from: string; to: string };
  changes: NodeChange[];
}

export interface KitDiff {
  id: string;
  name: string;
  status: 'added' | 'removed' | 'changed';
}

export interface ForestDiff {
  renamed?: { from: string; to: string };
  trees: TreeDiff[];
  kits: KitDiff[];
  /** True when nothing differs. */
  empty: boolean;
}

interface Placed {
  node: TreeNode;
  parent: string | null;
}

function index(root: Branch): Map<string, Placed> {
  const map = new Map<string, Placed>();
  const visit = (node: TreeNode, parent: string | null) => {
    map.set(node.id, { node, parent });
    if (isBranch(node)) node.children.forEach((c) => visit(c, node.id));
  };
  visit(root, null);
  return map;
}

/** A short human name for a node. */
function nodeLabel(node: TreeNode): string {
  if (isBranch(node)) return node.name || node.type || `<${node.tag}>`;
  if (node.type === 'text') {
    const t = node.value.trim().replace(/\s+/g, ' ');
    return t ? `“${t.length > 24 ? `${t.slice(0, 23)}…` : t}”` : 'empty text';
  }
  if (node.type === 'image') return node.attrs?.alt ? `image “${node.attrs.alt}”` : 'image';
  return `<${node.value}>`;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Order-insensitive comparison of string maps (attrs, style declarations). */
function sameMap(a: Record<string, string> | undefined, b: Record<string, string> | undefined): boolean {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  return ka.length === kb.length && ka.every((k) => (a ?? {})[k] === (b ?? {})[k]);
}

function compareNodes(a: TreeNode, b: TreeNode): { fields: NodeField[]; displays: string[] } {
  const fields: NodeField[] = [];
  const displays: string[] = [];
  if (a.kind !== b.kind) return { fields: ['tag'], displays };
  if (isBranch(a) && isBranch(b)) {
    if (a.tag !== b.tag) fields.push('tag');
    if ((a.name ?? '') !== (b.name ?? '')) fields.push('name');
    if ((a.type ?? '') !== (b.type ?? '')) fields.push('type');
    if (!same(a.classes, b.classes)) fields.push('classes');
    if (!sameMap(a.attrs, b.attrs)) fields.push('attrs');
    const ids = new Set([...Object.keys(a.styles), ...Object.keys(b.styles)]);
    for (const d of ids) if (!sameMap(a.styles[d as keyof typeof a.styles], b.styles[d as keyof typeof b.styles])) displays.push(d);
    if (displays.length) fields.push('styles');
  } else if (!isBranch(a) && !isBranch(b)) {
    if (a.type !== b.type) fields.push('leaf type');
    if (a.value !== b.value) fields.push('value');
    if (!sameMap(a.attrs, b.attrs)) fields.push('attrs');
  }
  return { fields, displays };
}

/**
 * Children of `parent` that are in both versions under the same parent, and whose order
 * among those shared children changed. Uses a longest increasing subsequence so that moving
 * one child reports that child, not every sibling it passed.
 */
function reordered(before: Branch, after: Branch, keep: (id: string) => boolean): string[] {
  const a = before.children.map((c) => c.id).filter(keep);
  const b = after.children.map((c) => c.id).filter(keep);
  const pos = new Map(a.map((id, i) => [id, i]));
  const seq = b.map((id) => pos.get(id)!);
  // Longest increasing subsequence (patience sorting, with back-links).
  const tails: number[] = [];
  const tailIdx: number[] = [];
  const prev = new Array<number>(seq.length).fill(-1);
  seq.forEach((v, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = v;
    tailIdx[lo] = i;
    prev[i] = lo > 0 ? tailIdx[lo - 1] : -1;
  });
  const stay = new Set<number>();
  for (let i = tailIdx[tails.length - 1] ?? -1; i >= 0; i = prev[i]) stay.add(i);
  return b.filter((_, i) => !stay.has(i));
}

/** Node-level changes from `before` to `after` (two versions of one tree root). */
export function diffNodes(before: Branch, after: Branch): NodeChange[] {
  const a = index(before);
  const b = index(after);
  const changes: NodeChange[] = [];
  const moved = new Set<string>();
  for (const [id, pb] of b) {
    const pa = a.get(id);
    if (pa && pa.parent !== pb.parent) moved.add(id);
  }
  // Same parent, new position among the children both versions share.
  for (const [id, pb] of b) {
    const pa = a.get(id);
    if (!pa || !isBranch(pa.node) || !isBranch(pb.node)) continue;
    const keep = (cid: string) => a.get(cid)?.parent === id && b.get(cid)?.parent === id;
    for (const cid of reordered(pa.node, pb.node, keep)) moved.add(cid);
  }
  const walk = (node: TreeNode, insideAdded: boolean) => {
    const pa = a.get(node.id);
    // New nodes inside a new branch are part of that branch's addition.
    if (!pa) {
      if (!insideAdded) changes.push({ kind: 'added', id: node.id, label: nodeLabel(node) });
    } else {
      if (moved.has(node.id)) changes.push({ kind: 'moved', id: node.id, label: nodeLabel(node) });
      const { fields, displays } = compareNodes(pa.node, node);
      if (fields.length) changes.push({ kind: 'changed', id: node.id, label: nodeLabel(node), fields, ...(displays.length ? { displays } : {}) });
    }
    // Keep walking an added branch: nodes that existed before may have been moved into it (a wrap).
    if (isBranch(node)) node.children.forEach((c) => walk(c, !pa));
  };
  walk(after, false);
  // Report only the top of a removed subtree.
  const removedTop = (id: string, p: Placed) => !b.has(id) && (p.parent === null || b.has(p.parent));
  for (const [id, p] of a) if (removedTop(id, p)) changes.push({ kind: 'removed', id, label: nodeLabel(p.node) });
  return changes;
}

/** Differences between two versions of a tree. Either may be missing (the tree was added or removed). */
export function diffTrees(before: Tree | undefined, after: Tree | undefined): TreeDiff {
  if (!before && !after) throw new Error('diffTrees needs at least one tree');
  if (!before) return { id: after!.id, name: after!.name, status: 'added', changes: [] };
  if (!after) return { id: before.id, name: before.name, status: 'removed', changes: [] };
  const changes = diffNodes(before.root, after.root);
  const renamed = before.name !== after.name ? { from: before.name, to: after.name } : undefined;
  return { id: after.id, name: after.name, status: changes.length || renamed ? 'changed' : 'unchanged', ...(renamed ? { renamed } : {}), changes };
}

const kitChanged = (a: DesignKit, b: DesignKit) =>
  a.name !== b.name || a.css !== b.css || a.enabled !== b.enabled || (a.href ?? '') !== (b.href ?? '') || !same(a.rules, b.rules);

/** Differences between two versions of a forest. Trees and kits are matched by id. */
export function diffForests(before: Forest, after: Forest): ForestDiff {
  const trees: TreeDiff[] = [];
  const beforeTrees = new Map(before.trees.map((t) => [t.id, t]));
  const afterIds = new Set(after.trees.map((t) => t.id));
  for (const t of after.trees) {
    const d = diffTrees(beforeTrees.get(t.id), t);
    if (d.status !== 'unchanged') trees.push(d);
  }
  for (const t of before.trees) if (!afterIds.has(t.id)) trees.push(diffTrees(t, undefined));
  const kits: KitDiff[] = [];
  const beforeKits = new Map(before.kits.map((k) => [k.id, k]));
  const afterKits = new Set(after.kits.map((k) => k.id));
  for (const k of after.kits) {
    const old = beforeKits.get(k.id);
    if (!old) kits.push({ id: k.id, name: k.name, status: 'added' });
    else if (kitChanged(old, k)) kits.push({ id: k.id, name: k.name, status: 'changed' });
  }
  for (const k of before.kits) if (!afterKits.has(k.id)) kits.push({ id: k.id, name: k.name, status: 'removed' });
  const renamed = before.name !== after.name ? { from: before.name, to: after.name } : undefined;
  return { ...(renamed ? { renamed } : {}), trees, kits, empty: !renamed && !trees.length && !kits.length };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function changePhrase(c: NodeChange): string {
  switch (c.kind) {
    case 'added':
      return `Added ${c.label}`;
    case 'removed':
      return `Removed ${c.label}`;
    case 'moved':
      return `Moved ${c.label}`;
    default: {
      const f = c.fields ?? [];
      if (f.length === 1 && f[0] === 'value') return `Edited ${c.label}`;
      if (f.length === 1 && f[0] === 'name') return `Renamed ${c.label}`;
      const what = f.map((x) => (x === 'attrs' ? 'attributes' : x)).join(', ');
      return `Changed ${what} on ${c.label}`;
    }
  }
}

/** All the change phrases of a diff, one per change. */
export function diffLines(diff: ForestDiff): string[] {
  const lines: string[] = [];
  if (diff.renamed) lines.push(`Renamed forest “${diff.renamed.from}” to “${diff.renamed.to}”`);
  for (const t of diff.trees) {
    if (t.status === 'added') lines.push(`Added tree “${t.name}”`);
    else if (t.status === 'removed') lines.push(`Removed tree “${t.name}”`);
    else {
      if (t.renamed) lines.push(`Renamed tree “${t.renamed.from}” to “${t.renamed.to}”`);
      for (const c of t.changes) lines.push(`${changePhrase(c)}${diff.trees.length > 1 ? ` (${t.name})` : ''}`);
    }
  }
  for (const k of diff.kits) lines.push(`${k.status === 'added' ? 'Added' : k.status === 'removed' ? 'Removed' : 'Changed'} kit “${k.name}”`);
  return lines;
}

/** A one-line description of a diff, for a history entry: the change itself when there is one, else counts. */
export function describeDiff(diff: ForestDiff): string {
  if (diff.empty) return 'No changes';
  const lines = diffLines(diff);
  if (lines.length === 1) return lines[0];
  const counts = { added: 0, removed: 0, moved: 0, changed: 0 };
  for (const t of diff.trees) for (const c of t.changes) counts[c.kind]++;
  const parts = (Object.entries(counts) as [NodeChangeKind, number][]).filter(([, n]) => n).map(([k, n]) => `${k} ${plural(n, 'node')}`);
  if (!parts.length) return `${lines[0]} and ${plural(lines.length - 1, 'more change')}`;
  const nodeChanges = counts.added + counts.removed + counts.moved + counts.changed;
  const others = lines.length - nodeChanges;
  const sentence = parts.join(', ') + (others > 0 ? `, and ${plural(others, 'other change')}` : '');
  return `${sentence[0].toUpperCase()}${sentence.slice(1)}`;
}

/** A diff as plain text, one change per line with a +, -, ~ or > marker. */
export function formatDiff(diff: ForestDiff): string {
  if (diff.empty) return 'No changes.';
  const marker = (line: string) => (line.startsWith('Added') ? '+' : line.startsWith('Removed') ? '-' : line.startsWith('Moved') ? '>' : '~');
  return diffLines(diff)
    .map((l) => `${marker(l)} ${l}`)
    .join('\n');
}
