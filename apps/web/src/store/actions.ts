import { getBlueprint, getTemplate } from '@tree-weaver/branches';
import {
  addTableColumn,
  addTableRow,
  ancestorsOf,
  canHaveChildren,
  cloneTree,
  createBranch,
  createCustomKit,
  createForest,
  createRule,
  createId,
  duplicateNode,
  findNode,
  findParent,
  History,
  insertNode,
  isBranch,
  isEditableKit,
  moveNode,
  removeNode,
  removeTableColumn,
  removeTableRow,
  parseRulesCss,
  setRuleStyle as setRuleDeclaration,
  setStyle,
  updateNode,
  updateTreeRoot,
  withRules,
  wrapNode,
  type Branch,
  type DesignKit,
  type DisplayId,
  type Forest,
  type Leaf,
  type StyleRule,
  type Tree,
  type TreeNode,
} from '@tree-weaver/core';
import { exportForest, exportStorybook, exportTree, getFormat, importDocument, suggestFileName, zipStorybook, type FormatId } from '@tree-weaver/formats';
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

/** Open the Kits tab with one kit's details showing. */
export function showKit(id: string): void {
  state.openKitId = id;
  setTab('kits');
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

/* ------------------------------------------------ custom classes and selectors */

/** The forest's editable kits, which hold its custom classes and selectors. */
export const customKits = (): (DesignKit & { rules: StyleRule[] })[] => (state.forest?.kits ?? []).filter(isEditableKit);

/** Find a custom rule by id, or by selector. */
export function findRule(match: { id?: string; selector?: string }, kitId?: string): { kit: DesignKit & { rules: StyleRule[] }; rule: StyleRule } | null {
  for (const kit of customKits()) {
    if (kitId && kit.id !== kitId) continue;
    const rule = kit.rules.find((r) => (match.id ? r.id === match.id : r.selector === match.selector));
    if (rule) return { kit, rule };
  }
  return null;
}

/** Open a rule in the Classes tab. */
export function showRule(id: string): void {
  state.openRuleId = id;
  setTab('classes');
}

function editRules(forest: Forest, kitId: string, fn: (rules: StyleRule[]) => StyleRule[]): Forest {
  return {
    ...forest,
    kits: forest.kits.map((k) => (k.id === kitId && isEditableKit(k) ? withRules(k, fn(k.rules)) : k)),
  };
}

/** The forest with an editable kit to add rules to, created (last, so it wins over other kits) when missing. */
function withCustomKit(forest: Forest): { forest: Forest; kitId: string } {
  const existing = forest.kits.find(isEditableKit);
  if (existing) return { forest, kitId: existing.id };
  const kit = createCustomKit();
  return { forest: { ...forest, kits: [...forest.kits, kit] }, kitId: kit.id };
}

/** Add a custom rule and open it. A selector that already has a rule opens that rule instead. */
export function addRule(selector: string): string | null {
  const forest = state.forest;
  if (!forest) return null;
  const existing = findRule({ selector: createRule(selector).selector });
  if (existing) {
    showRule(existing.rule.id);
    return existing.rule.id;
  }
  const rule = createRule(selector);
  if (!rule.selector) return null;
  const { forest: withKit, kitId } = withCustomKit(forest);
  commit(editRules(withKit, kitId, (rules) => [...rules, rule]));
  showRule(rule.id);
  return rule.id;
}

export function renameRule(kitId: string, ruleId: string, selector: string): void {
  const forest = state.forest;
  if (forest) commit(editRules(forest, kitId, (rules) => rules.map((r) => (r.id === ruleId ? { ...r, selector: createRule(selector).selector || r.selector } : r))));
}

export function setRuleStyle(kitId: string, ruleId: string, prop: string, value: string | null, display: DisplayId = state.display): void {
  const forest = state.forest;
  if (forest) commit(editRules(forest, kitId, (rules) => rules.map((r) => (r.id === ruleId ? setRuleDeclaration(r, display, prop, value) : r))));
}

export function removeRule(kitId: string, ruleId: string): void {
  const forest = state.forest;
  if (forest) commit(editRules(forest, kitId, (rules) => rules.filter((r) => r.id !== ruleId)));
}

/** Move a rule earlier or later; later rules win over earlier ones of equal specificity. */
export function moveRule(kitId: string, ruleId: string, delta: -1 | 1): void {
  const forest = state.forest;
  if (!forest) return;
  commit(
    editRules(forest, kitId, (rules) => {
      const i = rules.findIndex((r) => r.id === ruleId);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= rules.length) return rules;
      const next = [...rules];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    }),
  );
}

/** Replace an editable kit's rules from CSS text. Returns what had to be left out. */
export function setRulesCss(kitId: string, css: string): string[] {
  const forest = state.forest;
  const kit = customKits().find((k) => k.id === kitId);
  if (!forest || !kit) return [];
  const { rules, skipped } = parseRulesCss(css, kit.rules);
  commit(editRules(forest, kitId, () => rules));
  return skipped;
}

/**
 * Turn a pasted or uploaded kit into an editable one, so its rules can be edited one by one.
 * Kits with at-rules an editable kit can't hold stay as they are; returns those at-rules.
 */
export function makeKitEditable(kitId: string): string[] {
  const forest = state.forest;
  const kit = forest?.kits.find((k) => k.id === kitId);
  if (!forest || !kit || kit.href || isEditableKit(kit)) return [];
  const { rules, skipped } = parseRulesCss(kit.css);
  // Only convert when nothing would be lost.
  if (skipped.length) return skipped;
  commit({ ...forest, kits: forest.kits.map((k) => (k.id === kitId ? withRules(k, rules) : k)) });
  return skipped;
}

/**
 * Move a branch's own styles (every display) into a new class, put the class on the
 * branch, and clear its inspector styles. One undo step.
 */
export function extractClass(branchId: string, className: string): void {
  const forest = state.forest;
  const tree = currentTree();
  const node = tree ? findNode(tree.root, branchId) : null;
  if (!forest || !tree || !isBranch(node)) return;
  const selector = `.${className}`;
  if (findRule({ selector })) {
    toast(`“${selector}” already exists. Pick another name, or add the class from the list.`, 'error');
    return;
  }
  const rule = createRule(selector, node.styles);
  const { forest: withKit, kitId } = withCustomKit(forest);
  const next = updateTreeRoot(editRules(withKit, kitId, (rules) => [...rules, rule]), tree.id, (root) =>
    updateNode(root, branchId, (n) => (isBranch(n) ? { ...n, classes: [...new Set([...n.classes, className])], styles: {} } : n)),
  );
  commit(next);
  toast(`Moved the styles into “${selector}”`, 'success');
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
  /** The file's text, or a preview of it when the download is binary. */
  text: string;
  fileName: string;
  mime: string;
  /** Binary content to download instead of `text`, e.g. a zip. */
  bytes?: Uint8Array;
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

/** A Storybook project (zipped) for the current tree or the whole forest. */
export function exportStorybookCurrent(scope: 'tree' | 'forest'): ExportOutput {
  const forest = state.forest!;
  const tree = currentTree()!;
  // The deployment's stylesheets load first in the Storybook preview too.
  const project = exportStorybook({ ...forest, kits: allKits() }, scope === 'tree' ? { treeIds: [tree.id] } : {});
  const stories = project.files.find((f) => f.path.endsWith('.stories.js'));
  const listing = project.files.map((f) => `  ${f.path}`).join('\n');
  const text = `${project.name}/\n${listing}\n${stories ? `\n// ${stories.path}\n${stories.content}` : ''}`;
  return { text, fileName: `${project.name}.zip`, mime: 'application/zip', bytes: zipStorybook(project) };
}

export function download(output: ExportOutput): void {
  const blob = output.bytes
    ? new Blob([output.bytes as BlobPart], { type: output.mime })
    : new Blob([output.text], { type: `${output.mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = output.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
