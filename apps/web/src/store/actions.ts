import { getBlueprint, getTemplate } from '@tree-weaver/branches';
import {
  addTableColumn,
  addTableRow,
  ancestorsOf,
  canHaveChildren,
  cloneTree,
  createBranch,
  createForest,
  createId,
  duplicateNode,
  findNode,
  findParent,
  History,
  insertNode,
  isBranch,
  moveNode,
  removeNode,
  removeTableColumn,
  removeTableRow,
  setStyle,
  updateNode,
  updateTreeRoot,
  wrapNode,
  type Branch,
  type DesignKit,
  type DisplayId,
  type Forest,
  type Leaf,
  type Tree,
  type TreeNode,
} from '@tree-weaver/core';
import { exportForest, exportTree, getFormat, importDocument, suggestFileName, type FormatId } from '@tree-weaver/formats';
import { createEnvKits, createStarterKit, fetchKitCss } from '@tree-weaver/kits';
import { ENV_CSS_URLS } from '../config';
import { createForestStore, Preferences, type ForestStore } from '@tree-weaver/storage';
import { state, type SidebarTab, type Toast } from './editor';

/* ------------------------------------------------------------- selectors */

/** Every kit the trees load, in load order: the deployment's stylesheets first, then the forest's kits. */
export const allKits = (): DesignKit[] => [...state.envKits, ...(state.forest?.kits ?? [])];

export const currentTree = (): Tree | undefined => state.forest?.trees.find((t) => t.id === state.treeId);

export const selectedNode = (): TreeNode | null => {
  const tree = currentTree();
  return tree && state.selectedId ? findNode(tree.root, state.selectedId) : null;
};

export const parentOf = (id: string): Branch | null => {
  const tree = currentTree();
  return tree ? (findParent(tree.root, id)?.parent ?? null) : null;
};

export const pathTo = (id: string): Branch[] => {
  const tree = currentTree();
  return tree ? ancestorsOf(tree.root, id) : [];
};

/* ------------------------------------------------------- persistence */

let store: ForestStore;
const prefs = new Preferences({ forestId: '', treeId: '', display: 'lg' as DisplayId, tab: 'branches' as SidebarTab });
const history = new History<Forest>(150);
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function syncHistoryFlags() {
  state.canUndo = history.canUndo;
  state.canRedo = history.canRedo;
}

function scheduleSave() {
  state.saveState = 'unsaved';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveNow(), 400);
}

export async function saveNow(): Promise<void> {
  clearTimeout(saveTimer);
  const forest = state.forest;
  if (!forest) return;
  state.saveState = 'saving';
  try {
    await store.save(forest);
    state.forests = await store.list();
    if (state.forest === forest) state.saveState = 'saved';
    else scheduleSave();
  } catch (err) {
    state.saveState = 'error';
    toast(`Could not save locally: ${(err as Error).message}`, 'error');
  }
}

/** Replace the forest. Records an undo step unless `record` is false. */
export function commit(next: Forest, record = true): void {
  const prev = state.forest;
  if (next === prev) return;
  if (record && prev) history.push(prev);
  state.forest = next;
  if (!next.trees.some((t) => t.id === state.treeId)) state.treeId = next.trees[0]?.id ?? '';
  const tree = currentTree();
  if (state.selectedId && (!tree || !findNode(tree.root, state.selectedId))) state.selectedId = null;
  syncHistoryFlags();
  scheduleSave();
}

function editTree(fn: (root: Branch) => Branch): void {
  const forest = state.forest;
  if (!forest || !state.treeId) return;
  try {
    commit(updateTreeRoot(forest, state.treeId, fn));
  } catch (err) {
    toast((err as Error).message, 'error');
  }
}

/* ------------------------------------------------------------ lifecycle */

function freshForest(name = 'My forest'): Forest {
  const landing = getTemplate('landing')!.create('Home');
  const forest = createForest(name, [landing]);
  forest.kits = [createStarterKit()];
  return forest;
}

export async function init(): Promise<void> {
  state.envKits = createEnvKits(ENV_CSS_URLS);
  void Promise.all(state.envKits.map((k) => refreshKit(k.id, true)));
  store = await createForestStore();
  state.storageKind = store.kind;
  const saved = prefs.read();
  state.display = saved.display;
  state.tab = saved.tab;
  state.forests = await store.list();
  const id = saved.forestId && state.forests.some((f) => f.id === saved.forestId) ? saved.forestId : state.forests[0]?.id;
  const forest = id ? await store.load(id) : null;
  if (forest) openLoaded(forest, saved.treeId);
  else {
    openLoaded(freshForest(), '');
    await saveNow();
  }
  state.ready = true;
  window.addEventListener('beforeunload', () => {
    if (state.saveState !== 'saved') void saveNow();
  });
}

function openLoaded(forest: Forest, treeId: string) {
  history.clear();
  state.forest = forest;
  state.treeId = forest.trees.some((t) => t.id === treeId) ? treeId : (forest.trees[0]?.id ?? '');
  state.selectedId = null;
  state.saveState = 'saved';
  syncHistoryFlags();
  prefs.write({ forestId: forest.id, treeId: state.treeId });
}

export function undo(): void {
  if (!state.forest) return;
  const prev = history.undo(state.forest);
  if (prev) commit(prev, false);
  syncHistoryFlags();
}

export function redo(): void {
  if (!state.forest) return;
  const next = history.redo(state.forest);
  if (next) commit(next, false);
  syncHistoryFlags();
}

/* --------------------------------------------------------------- ui state */

let toastSeq = 0;
export function toast(message: string, tone: Toast['tone'] = 'info'): void {
  const t: Toast = { id: ++toastSeq, message, tone };
  state.toasts = [...state.toasts, t];
  setTimeout(() => (state.toasts = state.toasts.filter((x) => x.id !== t.id)), tone === 'error' ? 6000 : 3200);
}

export function select(id: string | null): void {
  state.selectedId = id;
}

export function setDisplay(display: DisplayId): void {
  state.display = display;
  prefs.write({ display });
}

export function setTab(tab: SidebarTab): void {
  state.tab = tab;
  prefs.write({ tab });
}

/* ------------------------------------------------------- tree editing */

export type DropPosition = 'before' | 'after' | 'inside';

/** Where a new node goes when added without a drop target: into the selected branch, or after the selection. */
function defaultTarget(): { targetId: string; position: DropPosition } {
  const tree = currentTree()!;
  const sel = selectedNode();
  if (!sel) return { targetId: tree.root.id, position: 'inside' };
  if (canHaveChildren(sel)) return { targetId: sel.id, position: 'inside' };
  return { targetId: sel.id, position: 'after' };
}

function placement(root: Branch, targetId: string, position: DropPosition): { parentId: string; index?: number } {
  if (position === 'inside' || targetId === root.id) {
    const target = findNode(root, targetId);
    if (canHaveChildren(target)) return { parentId: targetId };
  }
  const hit = findParent(root, targetId);
  if (!hit) return { parentId: root.id };
  return { parentId: hit.parent.id, index: position === 'before' ? hit.index : hit.index + 1 };
}

export function insertAt(node: TreeNode, targetId?: string, position?: DropPosition): void {
  const tree = currentTree();
  if (!tree) return;
  const target = targetId ? { targetId, position: position ?? 'inside' } : defaultTarget();
  editTree((root) => {
    const { parentId, index } = placement(root, target.targetId, target.position);
    return insertNode(root, parentId, node, index);
  });
  state.selectedId = node.id;
}

export function insertBlueprint(blueprintId: string, targetId?: string, position?: DropPosition): void {
  const bp = getBlueprint(blueprintId);
  if (bp) insertAt(bp.create(), targetId, position);
}

export function moveTo(id: string, targetId: string, position: DropPosition): void {
  if (id === targetId) return;
  editTree((root) => {
    const { parentId, index } = placement(root, targetId, position);
    return moveNode(root, id, parentId, index);
  });
}

/** Move a node one step up or down among its siblings. */
export function nudge(id: string, delta: -1 | 1): void {
  const parent = parentOf(id);
  if (!parent) return;
  const index = parent.children.findIndex((c) => c.id === id);
  const to = index + delta;
  if (to < 0 || to >= parent.children.length) return;
  editTree((root) => moveNode(root, id, parent.id, delta > 0 ? to + 1 : to));
}

export function removeSelected(): void {
  const id = state.selectedId;
  const tree = currentTree();
  if (!id || !tree || id === tree.root.id) return;
  const parent = parentOf(id);
  editTree((root) => removeNode(root, id));
  state.selectedId = parent && parent.id !== tree.root.id ? parent.id : null;
}

export function duplicateSelected(): void {
  const id = state.selectedId;
  const tree = currentTree();
  if (!id || !tree || id === tree.root.id) return;
  let newId = id;
  editTree((root) => {
    const res = duplicateNode(root, id);
    newId = res.id;
    return res.root;
  });
  state.selectedId = newId;
}

export function wrapSelected(tag = 'div', type = 'box'): void {
  const id = state.selectedId;
  const tree = currentTree();
  if (!id || !tree || id === tree.root.id) return;
  const wrapper = createBranch({ tag, type, name: 'Wrapper' });
  editTree((root) => wrapNode(root, id, wrapper));
  state.selectedId = wrapper.id;
}

export function selectParent(): void {
  if (!state.selectedId) return;
  const parent = parentOf(state.selectedId);
  if (parent) state.selectedId = parent.id;
}

export function updateBranch(id: string, patch: Partial<Omit<Branch, 'kind' | 'id' | 'children'>>): void {
  editTree((root) =>
    updateNode(root, id, (node) => {
      if (!isBranch(node)) return node;
      const next: Branch = { ...node, ...patch };
      for (const key of ['name', 'type'] as const) if (!next[key]) delete next[key];
      return next;
    }),
  );
}

export function updateLeaf(id: string, patch: Partial<Omit<Leaf, 'kind' | 'id'>>): void {
  editTree((root) => updateNode(root, id, (node) => (isBranch(node) ? node : { ...node, ...patch })));
}

export function setStyleValue(id: string, prop: string, value: string | null, display: DisplayId = state.display): void {
  editTree((root) => setStyle(root, id, display, prop, value));
}

export function tableEdit(tableId: string, op: 'add-row' | 'remove-row' | 'add-column' | 'remove-column', index?: number): void {
  editTree((root) => {
    switch (op) {
      case 'add-row':
        return addTableRow(root, tableId, index);
      case 'remove-row':
        return removeTableRow(root, tableId, index ?? 0);
      case 'add-column':
        return addTableColumn(root, tableId, index);
      case 'remove-column':
        return removeTableColumn(root, tableId, index ?? 0);
    }
  });
}

/* ----------------------------------------------------- trees and forests */

export function switchTree(treeId: string): void {
  state.treeId = treeId;
  state.selectedId = null;
  prefs.write({ treeId });
}

export function addTree(templateId = 'blank', name?: string): void {
  const forest = state.forest;
  const template = getTemplate(templateId) ?? getTemplate('blank')!;
  if (!forest) return;
  const tree = template.create(name || uniqueName(template.id === 'blank' ? 'New tree' : template.label, forest.trees.map((t) => t.name)));
  commit({ ...forest, trees: [...forest.trees, tree], updatedAt: new Date().toISOString() });
  switchTree(tree.id);
}

export function renameTree(treeId: string, name: string): void {
  const forest = state.forest;
  if (!forest || !name.trim()) return;
  commit({ ...forest, trees: forest.trees.map((t) => (t.id === treeId ? { ...t, name: name.trim(), updatedAt: new Date().toISOString() } : t)) });
}

export function duplicateTree(treeId: string): void {
  const forest = state.forest;
  const tree = forest?.trees.find((t) => t.id === treeId);
  if (!forest || !tree) return;
  const copy = { ...cloneTree(tree, true), name: uniqueName(`${tree.name} copy`, forest.trees.map((t) => t.name)) };
  const index = forest.trees.indexOf(tree);
  const trees = [...forest.trees];
  trees.splice(index + 1, 0, copy);
  commit({ ...forest, trees });
  switchTree(copy.id);
}

export function deleteTree(treeId: string): void {
  const forest = state.forest;
  if (!forest) return;
  if (forest.trees.length <= 1) {
    toast('A forest needs at least one tree', 'error');
    return;
  }
  commit({ ...forest, trees: forest.trees.filter((t) => t.id !== treeId) });
}

export function moveTree(treeId: string, delta: -1 | 1): void {
  const forest = state.forest;
  if (!forest) return;
  const i = forest.trees.findIndex((t) => t.id === treeId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= forest.trees.length) return;
  const trees = [...forest.trees];
  [trees[i], trees[j]] = [trees[j], trees[i]];
  commit({ ...forest, trees });
}

export function renameForest(name: string): void {
  if (state.forest && name.trim()) commit({ ...state.forest, name: name.trim() });
}

export async function newForest(name?: string): Promise<void> {
  await saveNow();
  const forest = freshForest(name || uniqueName('New forest', state.forests.map((f) => f.name)));
  openLoaded(forest, '');
  await saveNow();
  toast(`Planted “${forest.name}”`, 'success');
}

export async function openForest(id: string): Promise<void> {
  if (id === state.forest?.id) return;
  await saveNow();
  const forest = await store.load(id);
  if (!forest) {
    toast('That forest could not be loaded', 'error');
    return;
  }
  openLoaded(forest, '');
}

export async function deleteForest(id: string): Promise<void> {
  await store.remove(id);
  state.forests = await store.list();
  if (id === state.forest?.id) {
    const next = state.forests[0];
    const forest = next ? await store.load(next.id) : null;
    if (forest) openLoaded(forest, '');
    else {
      openLoaded(freshForest(), '');
      await saveNow();
    }
  }
}

function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/* ------------------------------------------------------------- kits */

export function addKit(kit: DesignKit): void {
  const forest = state.forest;
  if (!forest) return;
  commit({ ...forest, kits: [...forest.kits, kit] });
  toast(`Added design kit “${kit.name}”`, 'success');
}

export function updateKit(id: string, patch: Partial<Omit<DesignKit, 'id'>>): void {
  const forest = state.forest;
  if (!forest) return;
  commit({ ...forest, kits: forest.kits.map((k) => (k.id === id ? { ...k, ...patch } : k)) });
}

export function removeKit(id: string): void {
  const forest = state.forest;
  if (!forest) return;
  commit({ ...forest, kits: forest.kits.filter((k) => k.id !== id) });
}

/**
 * Fetch a linked kit's CSS again so its classes and tokens are current. The stylesheet
 * itself always loads from its URL; this only refreshes what the editor can list.
 */
export async function refreshKit(id: string, quiet = false): Promise<void> {
  const kit = allKits().find((k) => k.id === id);
  if (!kit?.href) return;
  const css = await fetchKitCss(kit.href);
  if (state.envKits.some((k) => k.id === id)) {
    state.envKits = state.envKits.map((k) => (k.id === id ? { ...k, css } : k));
  } else if (css !== kit.css) {
    updateKit(id, { css });
  }
  if (!quiet) toast(css ? `Reloaded “${kit.name}”` : `“${kit.name}” still loads, but its server does not share the CSS, so its classes are not listed`, css ? 'success' : 'info');
}

export function moveKit(id: string, delta: -1 | 1): void {
  const forest = state.forest;
  if (!forest) return;
  const i = forest.kits.findIndex((k) => k.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= forest.kits.length) return;
  const kits = [...forest.kits];
  [kits[i], kits[j]] = [kits[j], kits[i]];
  commit({ ...forest, kits });
}

/* ------------------------------------------------------- import / export */

export interface ImportResult {
  summary: string;
}

/** Import text in any supported format. Forests open as new forests; trees join the current forest. */
export async function importText(text: string, format?: FormatId, fileName?: string): Promise<ImportResult> {
  const doc = importDocument(text, format, fileName);
  if (doc.kind === 'forest') {
    await saveNow();
    let forest = doc.forest;
    if (state.forests.some((f) => f.id === forest.id)) {
      forest = { ...forest, id: createId('f'), name: uniqueName(forest.name, state.forests.map((f) => f.name)) };
    }
    openLoaded(forest, '');
    await saveNow();
    return { summary: `Opened forest “${forest.name}” with ${forest.trees.length} tree${forest.trees.length === 1 ? '' : 's'}` };
  }
  const forest = state.forest;
  if (!forest) throw new Error('No forest is open');
  let tree = doc.tree;
  if (forest.trees.some((t) => t.id === tree.id)) tree = { ...tree, id: createId('t') };
  tree = { ...tree, name: uniqueName(tree.name, forest.trees.map((t) => t.name)) };
  // Skip kits the forest already has, and the deployment's own stylesheets.
  const known = new Set(allKits().flatMap((k) => (k.href ? [k.id, k.href] : [k.id, k.css])));
  const newKits = doc.kits.filter((k) => !known.has(k.id) && !known.has(k.href ?? k.css));
  commit({ ...forest, trees: [...forest.trees, tree], kits: [...forest.kits, ...newKits] });
  switchTree(tree.id);
  const kitNote = newKits.length ? ` and ${newKits.length} design kit${newKits.length === 1 ? '' : 's'}` : '';
  return { summary: `Added tree “${tree.name}”${kitNote}` };
}

export interface ExportOutput {
  text: string;
  fileName: string;
  mime: string;
}

export function exportCurrent(format: FormatId, scope: 'tree' | 'forest'): ExportOutput {
  const forest = state.forest!;
  const info = getFormat(format);
  if (scope === 'forest') {
    return { text: exportForest(forest, format), fileName: suggestFileName(forest.name, 'forest', format), mime: info.mime };
  }
  const tree = currentTree()!;
  // A standalone page loads the deployment's stylesheets too; data formats carry only the forest's kits.
  const kits = format === 'html' ? allKits() : forest.kits;
  return { text: exportTree(tree, format, kits), fileName: suggestFileName(tree.name, 'tree', format), mime: info.mime };
}

export function download(output: ExportOutput): void {
  const blob = new Blob([output.text], { type: `${output.mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = output.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
