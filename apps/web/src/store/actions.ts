import { getBlueprint, getStarter, getTemplate } from '@tree-weaver/branches';
import {
  addTableColumn,
  applyDisplaySettings,
  changedDisplaySettings,
  cleanDisplaySettings,
  mergeDisplaySettings,
  addTableRow,
  ancestorsOf,
  canHaveChildren,
  cloneTree,
  walk,
  createBranch,
  createCustomKit,
  createForest,
  createRule,
  createId,
  duplicateNode,
  findNode,
  findParent,
  History,
  type ChangeMeta,
  type TimelineEntry,
  inSvgContext,
  insertNode,
  isBranch,
  isEditableKit,
  moveNode,
  removeNode,
  replaceTree,
  removeTableColumn,
  removeTableRow,
  parseRulesCss,
  renderDocument,
  renderForestIndex,
  setRuleStyle as setRuleDeclaration,
  setStyle,
  setStyles,
  applyGridLayout,
  applySmallScreen,
  clearAreas,
  startAreas,
  getGridLayout,
  type SmallScreenChoice,
  updateNode,
  updateTreeRoot,
  withRules,
  wrapNode,
  type Branch,
  type DesignKit,
  type DisplayField,
  type DisplayId,
  type DisplaySettings,
  type Forest,
  type Leaf,
  type StyleRule,
  type Tree,
  type TreeNode,
  addKitsBeforeTokens,
  displayProblems,
  isTokenKit,
  resetToken,
  setToken,
  type DesignToken,
  componentTreeId,
  saveComponent,
  detachInstance,
  findComponent,
  findTree,
  instancesOf,
  idsOutside,
  insertionProblem,
  instanceRoleIn,
  VOID_TAGS,
  instantiateComponent,
  isComponentTreeId,
  updateComponent,
  type ComponentDef,
  type ComponentInstance,
} from '@tree-weaver/core';
import {
  exportComponent,
  exportComponentDef,
  exportForest,
  exportStorybook,
  exportTree,
  getFormat,
  importDocument,
  suggestFileName,
  zip,
  zipStorybook,
  type ComponentFramework,
  type ComponentStyling,
  type FormatId,
  type TreeDocument,
} from '@tree-weaver/formats';
import { createEnvKits, createStarterKit, fetchKitCss, isEnvKit, kitClasses } from '@tree-weaver/kits';
import { DISPLAYS_LOCKED, ENV_CSS_URLS, ENV_DISPLAYS } from '../config';
import { createForestStore, MemoryForestStore, Preferences, type ForestStore } from '@tree-weaver/storage';
import { isEmbedded } from './embed-flags';
import { state, type SidebarTab, type Toast } from './editor';

/* ------------------------------------------------------------- selectors */

/** Every kit the trees load, in load order: the deployment's stylesheets first, then the forest's kits. */
export const allKits = (): DesignKit[] => [...state.envKits, ...(state.forest?.kits ?? [])];

export const currentTree = (): Tree | undefined => (state.forest ? findTree(state.forest, state.treeId, state.componentVariant) : undefined);

/** The component being edited, when the open tree is a component's template. */
export const editingComponent = (): ComponentDef | undefined =>
  state.forest && isComponentTreeId(state.treeId) ? state.forest.components?.find((c) => componentTreeId(c.id) === state.treeId) : undefined;

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
const prefs = new Preferences({
  forestId: '',
  treeId: '',
  display: 'lg' as DisplayId,
  tab: 'branches' as SidebarTab,
  displays: {} as DisplaySettings,
});
const history = new History<Forest>(150);
let saveTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * The stored version this tab last loaded or saved, by its `updatedAt` (set on every save). A
 * different one in storage at save time means another tab saved the forest in between.
 */
let baseline: { id: string; at: string } | null = null;
/** Tells this browser's other tabs that a forest was saved, so an idle one can pick it up. */
const tabs: BroadcastChannel | null = typeof BroadcastChannel === 'function' && !isEmbedded() ? new BroadcastChannel('tree-weaver-forests') : null;

/** Undo and redo in a shared forest, which undo only this editor's changes (see store/collab.ts). */
export interface HistoryOverride {
  undo(): void;
  redo(): void;
  /** Update `canUndo` and `canRedo`. */
  flags(): void;
}
let historyOverride: HistoryOverride | null = null;

export function setHistoryOverride(o: HistoryOverride | null): void {
  historyOverride = o;
  syncHistoryFlags();
}

function syncHistoryFlags() {
  if (historyOverride) return historyOverride.flags();
  state.canUndo = history.canUndo;
  state.canRedo = history.canRedo;
}

function scheduleSave() {
  state.saveState = 'unsaved';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveNow(), 400);
}

/** Save the open forest now. Resolves false (after telling the user) when the save failed. */
export async function saveNow(checkOtherTabs = true): Promise<boolean> {
  clearTimeout(saveTimer);
  const forest = state.forest;
  if (!forest) return true;
  state.saveState = 'saving';
  try {
    const at = new Date().toISOString();
    if (checkOtherTabs && baseline?.id === forest.id) {
      const stored = await store.load(forest.id);
      if (stored && stored.updatedAt !== baseline.at) {
        // Another tab saved this forest since: keep both, this tab's version as a copy.
        const copy: Forest = { ...forest, id: createId('f'), name: uniqueName(`${forest.name} (other tab)`, state.forests.map((f) => f.name)), updatedAt: at };
        await store.save(copy);
        state.forests = await store.list();
        openLoaded(copy, state.treeId);
        toast(`“${forest.name}” was changed in another tab, so your changes here are kept as “${copy.name}”.`, 'error');
        return true;
      }
    }
    await store.save({ ...forest, updatedAt: at });
    baseline = { id: forest.id, at };
    tabs?.postMessage({ id: forest.id, at });
    state.forests = await store.list();
    if (state.forest === forest) state.saveState = 'saved';
    else scheduleSave();
    return true;
  } catch (err) {
    state.saveState = 'error';
    toast(`Could not save locally: ${(err as Error).message}`, 'error');
    return false;
  }
}

/**
 * Save the open forest before something replaces it. When the save fails, the forest stays
 * open (replacing it would lose the unsaved edits) and this resolves false.
 */
async function saveBeforeLeaving(): Promise<boolean> {
  if (await saveNow()) return true;
  toast('The open forest stays open because its changes could not be saved. Export it to keep a copy, then try again.', 'error');
  return false;
}

/** Replace the forest. Records an undo step unless `record` is false; `meta` says where the change came from (default: the editor). */
export function commit(next: Forest, record = true, meta: ChangeMeta = {}): void {
  const prev = state.forest;
  if (next === prev) return;
  if (record && prev) history.push(prev, { source: 'editor', ...meta });
  state.forest = next;
  if (!findTree(next, state.treeId)) state.treeId = next.trees[0]?.id ?? '';
  if (state.componentVariant && !editingComponent()?.variants.some((v) => v.name === state.componentVariant)) state.componentVariant = null;
  const tree = currentTree();
  if (state.selectedId && (!tree || !findNode(tree.root, state.selectedId))) state.selectedId = null;
  syncHistoryFlags();
  scheduleSave();
}

/** Every state in this session's undo history, oldest first; the open forest is at offset 0. */
export function historyTimeline(): TimelineEntry<Forest>[] {
  return state.forest ? history.timeline(state.forest) : [];
}

/** Jump `offset` steps through the undo history (negative goes back). */
export function goToHistory(offset: number): void {
  if (!state.forest) return;
  if (historyOverride) {
    // Shared: going back is a new change for everyone, not a rewind of this tab's stack.
    const entry = history.timeline(state.forest).find((e) => e.offset === offset);
    if (entry) commit(withCurrentBreakpoints(entry.state), true, { label: 'Went back to an earlier state' });
    return;
  }
  const reached = history.go(state.forest, offset);
  if (reached) commit(withCurrentBreakpoints(reached), false);
  syncHistoryFlags();
}

function editTree(fn: (root: Branch) => Branch): void {
  const forest = state.forest;
  if (!forest || !state.treeId) return;
  try {
    const next = updateTreeRoot(forest, state.treeId, fn, state.componentVariant);
    // An edit to a component instance is undone by the instance, which is redrawn from its
    // component; say so rather than seem to accept it.
    // (A no-op edit leaves the forest as it was too, so the change is checked by content.)
    const tree = next === forest ? currentTree() : null;
    if (tree && JSON.stringify(fn(tree.root)) !== JSON.stringify(tree.root)) {
      toast(INSTANCE_EDIT, 'error');
      return;
    }
    commit(next);
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
  // Embedded editors keep documents in memory only: the host page owns them.
  store = isEmbedded() ? new MemoryForestStore() : await createForestStore();
  state.storageKind = store.kind;
  const saved = prefs.read();
  state.displaySettings = cleanDisplaySettings(saved.displays);
  applyDisplays();
  if (ENV_DISPLAYS.errors.length) console.warn(`TW_DISPLAYS: ${ENV_DISPLAYS.errors.join(' ')}`);
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
  // Another tab saved the forest open here: with nothing unsaved in this tab, show its version.
  tabs?.addEventListener('message', (e: MessageEvent<{ id: string; at: string }>) => {
    const { id, at } = e.data ?? {};
    if (!id || id !== state.forest?.id || state.saveState !== 'saved' || baseline?.at === at) return;
    void store.load(id).then((latest) => {
      if (!latest || state.forest?.id !== id || state.saveState !== 'saved') return;
      openLoaded(latest, state.treeId);
      toast('Updated with changes saved in another tab');
    });
  });
  window.addEventListener('beforeunload', () => {
    // No read first: the page may be gone before it answers.
    if (state.saveState !== 'saved') void saveNow(false);
  });
}

function openLoaded(forest: Forest, treeId: string) {
  baseline = { id: forest.id, at: forest.updatedAt };
  history.clear();
  state.forest = withCurrentBreakpoints(forest);
  state.treeId = forest.trees.some((t) => t.id === treeId) ? treeId : (forest.trees[0]?.id ?? '');
  state.selectedId = null;
  state.saveState = 'saved';
  syncHistoryFlags();
  prefs.write({ forestId: forest.id, treeId: state.treeId });
}

export function undo(): void {
  if (!state.forest) return;
  if (historyOverride) return historyOverride.undo();
  const prev = history.undo(state.forest);
  if (prev) commit(withCurrentBreakpoints(prev), false);
  syncHistoryFlags();
}

export function redo(): void {
  if (!state.forest) return;
  if (historyOverride) return historyOverride.redo();
  const next = history.redo(state.forest);
  if (next) commit(withCurrentBreakpoints(next), false);
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

/* ------------------------------------------------------------- displays */

/** Display values in effect: defaults, then this browser's changes, then `TW_DISPLAYS`. */
export const effectiveDisplaySettings = (): DisplaySettings =>
  mergeDisplaySettings(DISPLAYS_LOCKED ? {} : state.displaySettings, ENV_DISPLAYS.settings);

/** Whether a display value is fixed by the deployment, and so can't be changed here. */
export const isDisplayFieldLocked = (id: DisplayId, field: DisplayField): boolean =>
  DISPLAYS_LOCKED || ENV_DISPLAYS.settings[id]?.[field] !== undefined;

/** Editable kits store CSS generated from their rules; regenerate it so it uses the current breakpoints. */
export function withCurrentBreakpoints(forest: Forest): Forest {
  let changed = false;
  const kits = forest.kits.map((k) => {
    if (!isEditableKit(k)) return k;
    const next = withRules(k, k.rules);
    if (next.css === k.css) return k;
    changed = true;
    return next;
  });
  return changed ? { ...forest, kits } : forest;
}

function applyDisplays(): void {
  applyDisplaySettings(effectiveDisplaySettings());
  state.displaysVersion++;
  state.canvasVersion++;
}

function saveDisplaySettings(next: DisplaySettings): void {
  state.displaySettings = changedDisplaySettings(next);
  prefs.write({ displays: state.displaySettings });
  applyDisplays();
  const forest = state.forest;
  if (!forest) return;
  const refreshed = withCurrentBreakpoints(forest);
  // A new forest object re-renders everything that shows displays, even when no kit changed.
  commit(refreshed === forest ? { ...forest } : refreshed, false);
}

/** Change one display value in this browser. `null` goes back to the default. */
export function setDisplaySetting(id: DisplayId, field: DisplayField, value: number | null): void {
  if (isDisplayFieldLocked(id, field)) return;
  const entry = { ...state.displaySettings[id] };
  if (value === null) delete entry[field];
  else entry[field] = value;
  saveDisplaySettings({ ...state.displaySettings, [id]: entry });
  // Saved as asked, but a size that hides a display's own styles is worth saying.
  const problem = displayProblems()[0];
  if (problem) toast(problem, 'error');
}

/** Change several display values in this browser at once, skipping any the deployment locks. Returns the displays changed. */
export function setDisplaySizes(settings: DisplaySettings): DisplayId[] {
  const next: DisplaySettings = { ...state.displaySettings };
  const changed: DisplayId[] = [];
  for (const [id, values] of Object.entries(settings) as [DisplayId, DisplaySettings[DisplayId]][]) {
    const entry = { ...next[id] };
    let touched = false;
    for (const [field, value] of Object.entries(values ?? {}) as [DisplayField, number][]) {
      if (isDisplayFieldLocked(id, field)) continue;
      entry[field] = value;
      touched = true;
    }
    if (touched) {
      next[id] = entry;
      changed.push(id);
    }
  }
  if (changed.length) saveDisplaySettings(next);
  return changed;
}

/** Undo every display change made in this browser. Values from `TW_DISPLAYS` stay. */
export function resetDisplaySettings(): void {
  saveDisplaySettings({});
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

/** Shapes and SVG groups only go inside an `<svg>`, and HTML can't be drawn inside one. Says why with a toast. */
/** Said when an edit would change what an instance holds, which comes from its component. */
export const INSTANCE_EDIT = 'This is a component instance: it follows its component. Edit the component, or detach the instance, to change it';
export const INSIDE_INSTANCE = 'This is part of a component instance: edit the component, or detach the instance, to change it';

/** The instance a node is part of (itself, or its nearest instance ancestor). */
export function instanceOwner(root: Branch, id: string): Branch | null {
  const node = findNode(root, id);
  if (node && isBranch(node) && node.instance) return node;
  return [...ancestorsOf(root, id)].reverse().find((a) => a.instance) ?? null;
}

/** Why a branch can't take another tag where it is, or null (the same rules as a patch's `update`). */
function tagChangeProblem(root: Branch, node: Branch, tag: string): string | null {
  if (node.children.length && VOID_TAGS.has(tag.toLowerCase())) return `<${tag}> can't hold children, and this branch has ${node.children.length}`;
  const parent = findParent(root, node.id)?.parent;
  if (!parent) return null;
  const next: Branch = { ...node, tag };
  return insertionProblem(removeNode(root, node.id), parent.id, next);
}

function allowed(root: Branch, parentId: string, node: TreeNode): boolean {
  const owner = instanceOwner(root, parentId);
  // The node and everything it holds must suit where it lands (an <a> works in HTML and SVG, what it holds may not).
  const problem = owner ? `“${owner.name ?? 'This branch'}” is a component instance: edit the component to change what is inside it` : insertionProblem(root, parentId, node);
  if (problem) toast(problem, 'error');
  return !problem;
}

export function insertAt(node: TreeNode, targetId?: string, position?: DropPosition): void {
  insertWithKits(node, [], targetId, position);
}

/**
 * Insert a node and add the design kits it needs (those the forest doesn't have yet) in one
 * undo step. Used for branches from a Storybook library, which bring their styles along.
 */
export function insertWithKits(node: TreeNode, kits: DesignKit[], targetId?: string, position?: DropPosition): void {
  const tree = currentTree();
  const forest = state.forest;
  if (!tree || !forest) return;
  const target = targetId ? { targetId, position: position ?? 'inside' } : defaultTarget();
  const { parentId, index } = placement(tree.root, target.targetId, target.position);
  if (!allowed(tree.root, parentId, node)) return;
  const added = newKits(kits);
  try {
    const withKits = added.length ? { ...forest, kits: addKitsBeforeTokens(forest.kits, added) } : forest;
    commit(updateTreeRoot(withKits, tree.id, (root) => insertNode(root, parentId, node, index)));
  } catch (err) {
    toast((err as Error).message, 'error');
    return;
  }
  state.selectedId = node.id;
  if (added.length) toast(`Added ${added.length} design kit${added.length === 1 ? '' : 's'} for ${isBranch(node) && node.name ? `“${node.name}”` : 'this branch'}`, 'info');
}

/** The kits the forest (and the deployment) doesn't already have, matched by id, linked URL or CSS. */
export function newKits(kits: DesignKit[]): DesignKit[] {
  const known = new Set(allKits().flatMap((k) => (k.href ? [k.id, k.href] : [k.id, k.css])));
  return kits.filter((k) => !known.has(k.id) && !known.has(k.href ?? k.css));
}

/** Add trees and the kits they need to the open forest, in one undo step, and open the first tree. */
export function addTreesWithKits(trees: Tree[], kits: DesignKit[]): { trees: Tree[]; kits: DesignKit[] } {
  const forest = state.forest;
  if (!forest || !trees.length) return { trees: [], kits: [] };
  const names = forest.trees.map((t) => t.name);
  const named = trees.map((t) => {
    const name = uniqueName(t.name, names);
    names.push(name);
    return { ...t, name };
  });
  const added = newKits(kits);
  commit({ ...forest, trees: [...forest.trees, ...named], kits: addKitsBeforeTokens(forest.kits, added) });
  switchTree(named[0].id);
  return { trees: named, kits: added };
}

export function insertBlueprint(blueprintId: string, targetId?: string, position?: DropPosition): void {
  const bp = getBlueprint(blueprintId);
  if (bp) insertAt(bp.create(), targetId, position);
}

/** In a component instance's insides, edits would be undone by the instance at once: say so instead. */
function refusedInsideInstance(id: string): boolean {
  const tree = currentTree();
  if (!tree || instanceRoleIn(tree.root, id) !== 'inside') return false;
  toast(INSIDE_INSTANCE, 'error');
  return true;
}

export function moveTo(id: string, targetId: string, position: DropPosition): void {
  const tree = currentTree();
  const node = tree && findNode(tree.root, id);
  if (id === targetId || !tree || !node) return;
  // Moved out, the instance would put it straight back, leaving two nodes with one id.
  if (instanceRoleIn(tree.root, id) === 'inside') {
    toast(INSIDE_INSTANCE, 'error');
    return;
  }
  const { parentId, index } = placement(tree.root, targetId, position);
  // Checked against the tree without the node, as it will be once moved.
  const without = removeNode(tree.root, id);
  if (!allowed(findNode(without, parentId) ? without : tree.root, parentId, node)) return;
  editTree((root) => moveNode(root, id, parentId, index));
}

/** Move a node one step up or down among its siblings. */
export function nudge(id: string, delta: -1 | 1): void {
  const parent = parentOf(id);
  if (!parent) return;
  const index = parent.children.findIndex((c) => c.id === id);
  const to = index + delta;
  if (to < 0 || to >= parent.children.length || refusedInsideInstance(id)) return;
  editTree((root) => moveNode(root, id, parent.id, delta > 0 ? to + 1 : to));
}

/** In a component's view, the template's root stands for the whole component. */
function isTemplateRoot(tree: Tree, id: string): boolean {
  return isComponentTreeId(tree.id) && tree.root.children.some((c) => c.id === id);
}

export function removeSelected(): void {
  const id = state.selectedId;
  const tree = currentTree();
  if (!id || !tree || id === tree.root.id) return;
  if (isTemplateRoot(tree, id)) {
    toast('This is the component itself: delete it from the Components list instead', 'error');
    return;
  }
  if (refusedInsideInstance(id)) return;
  const parent = parentOf(id);
  editTree((root) => removeNode(root, id));
  state.selectedId = parent && parent.id !== tree.root.id ? parent.id : null;
}

export function duplicateSelected(): void {
  const id = state.selectedId;
  const tree = currentTree();
  if (!id || !tree || id === tree.root.id || isTemplateRoot(tree, id) || refusedInsideInstance(id)) return;
  let newId = id;
  const dup = (root: Branch) => {
    const res = duplicateNode(root, id);
    newId = res.id;
    return res.root;
  };
  // In a variant view the node shows base and variant styles merged, and a copy (with new ids)
  // would keep them as its base styles; so it is copied from the base template instead.
  if (state.componentVariant && state.forest && state.treeId) {
    try {
      commit(updateTreeRoot(state.forest, state.treeId, dup, null));
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  } else editTree(dup);
  state.selectedId = newId;
}

export function wrapSelected(tag = 'div', type = 'box'): void {
  const id = state.selectedId;
  const tree = currentTree();
  if (!id || !tree || id === tree.root.id || isTemplateRoot(tree, id) || refusedInsideInstance(id)) return;
  // Inside a drawing the wrapper is an SVG group.
  const parent = parentOf(id);
  const svg = !!parent && inSvgContext(tree.root, parent.id);
  const wrapper = svg ? createBranch({ tag: 'g', name: 'Group' }) : createBranch({ tag, type, name: 'Wrapper' });
  editTree((root) => wrapNode(root, id, wrapper));
  state.selectedId = wrapper.id;
}

export function selectParent(): void {
  if (!state.selectedId) return;
  const parent = parentOf(state.selectedId);
  if (parent) state.selectedId = parent.id;
}

export function updateBranch(id: string, patch: Partial<Omit<Branch, 'kind' | 'id' | 'children'>>): void {
  if (refusedInsideInstance(id)) return;
  const tree = currentTree();
  const node = tree && findNode(tree.root, id);
  if (tree && node && isBranch(node) && patch.tag !== undefined && patch.tag !== node.tag) {
    const problem = tagChangeProblem(tree.root, node, patch.tag);
    if (problem) {
      toast(problem, 'error');
      return;
    }
  }
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
  if (refusedInsideInstance(id)) return;
  editTree((root) => updateNode(root, id, (node) => (isBranch(node) ? node : { ...node, ...patch })));
}

export function setStyleValue(id: string, prop: string, value: string | null, display: DisplayId = state.display): void {
  if (refusedInsideInstance(id)) return;
  editTree((root) => setStyle(root, id, display, prop, value));
}

/** Set several style properties on one display as a single undo step. */
export function setStyleValues(id: string, patch: Record<string, string | null>, display: DisplayId = state.display): void {
  if (refusedInsideInstance(id)) return;
  editTree((root) => setStyles(root, id, display, patch));
}

/** Turn a branch into a ready-made grid layout on the current display. */
export function applyLayout(branchId: string, layoutId: string): void {
  const layout = getGridLayout(layoutId);
  if (!layout || refusedInsideInstance(branchId)) return;
  let created: string[] = [];
  editTree((root) => {
    const result = applyGridLayout(root, branchId, state.display, layout);
    created = result.created;
    return result.root;
  });
  if (created.length) toast(`${layout.label}: added ${created.length} ${created.length === 1 ? 'box' : 'boxes'} for the empty areas.`);
}

/** Choose what a grid does on a smaller display. */
export function setSmallScreen(branchId: string, display: DisplayId, choice: SmallScreenChoice): void {
  if (refusedInsideInstance(branchId)) return;
  editTree((root) => applySmallScreen(root, branchId, display, choice));
}

/** Give a grid named areas (one per child) on the current display, or take them away. */
export function gridAreasEdit(branchId: string, op: 'start' | 'clear'): void {
  editTree((root) => (op === 'start' ? startAreas : clearAreas)(root, branchId, state.display));
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
  if (isComponentTreeId(treeId) && !isComponentTreeId(state.treeId)) lastTreeId = state.treeId;
  state.treeId = treeId;
  state.selectedId = null;
  state.componentVariant = null;
  if (!isComponentTreeId(treeId)) prefs.write({ treeId });
}

/* ------------------------------------------------------------ components */

/** The last real tree, to go back to after editing a component. */
let lastTreeId = '';

/** Save a branch (or the open tree's root) as a reusable component; the branch becomes its first instance. */
export function saveAsComponent(branchId: string, name: string): ComponentDef | null {
  const forest = state.forest;
  const tree = currentTree();
  if (!forest || !tree || isComponentTreeId(tree.id)) return null;
  const node = findNode(tree.root, branchId);
  if (!node || !isBranch(node)) return null;
  if (instanceRoleIn(tree.root, node.id) === 'inside') {
    toast('This branch is part of a component instance. Edit the component, or detach the instance first.', 'error');
    return null;
  }
  // The branch itself becomes an instance, so it follows the component from now on.
  const saved = saveComponent(forest, tree.id, node.id, name);
  if (!saved) return null;
  const def = saved.component;
  commit(saved.forest, true, { label: `Saved “${def.name}” as a component` });
  toast(`Saved “${def.name}” as a component. It is in the Branches tab.`, 'success');
  return def;
}

/** Insert an instance of a component at the selection. */
export function insertComponent(componentId: string, targetId?: string, position?: DropPosition): void {
  const def = state.forest?.components?.find((c) => c.id === componentId);
  if (!def) return;
  const inst = instantiateComponent(def);
  // Inside a component's template an instance would refer to itself; insert a plain copy.
  insertAt(isComponentTreeId(state.treeId) ? detachInstance(inst) : inst, targetId, position);
}

/** Open a component's template on the canvas (optionally one of its variants). */
export function editComponent(componentId: string, variant: string | null = null): void {
  switchTree(componentTreeId(componentId));
  state.componentVariant = variant;
}

export function leaveComponent(): void {
  const forest = state.forest;
  if (!forest) return;
  switchTree(forest.trees.some((t) => t.id === lastTreeId) ? lastTreeId : (forest.trees[0]?.id ?? ''));
}

export function setComponentVariant(variant: string | null): void {
  state.componentVariant = variant;
  state.selectedId = null;
}

/** Change a component's name, description, props or variants. Instances follow. */
export function editComponentDef(componentId: string, fn: (def: ComponentDef) => ComponentDef, label?: string): void {
  const forest = state.forest;
  const def = forest?.components?.find((c) => c.id === componentId);
  if (!forest || !def) return;
  commit(updateComponent(forest, fn(def)), true, label ? { label } : {});
}

export function deleteComponent(componentId: string): void {
  const forest = state.forest;
  if (!forest) return;
  // Instances keep their content as plain branches.
  const detachAll = (node: TreeNode): TreeNode => (isBranch(node) ? { ...(node.instance?.component === componentId ? detachInstance(node) : node), children: node.children.map(detachAll) } : node);
  if (isComponentTreeId(state.treeId) && state.treeId === componentTreeId(componentId)) leaveComponent();
  commit({ ...forest, components: (forest.components ?? []).filter((c) => c.id !== componentId), trees: forest.trees.map((t) => ({ ...t, root: detachAll(t.root) as Branch })) });
}

/** Set an instance's props or variants. */
export function updateInstance(branchId: string, fn: (instance: ComponentInstance) => ComponentInstance): void {
  editTree((root) => updateNode(root, branchId, (n) => (isBranch(n) && n.instance ? { ...n, instance: fn(n.instance) } : n)));
}

export function detachInstanceAt(branchId: string): void {
  editTree((root) => updateNode(root, branchId, (n) => (isBranch(n) ? detachInstance(n) : n)));
}

export const componentUses = (componentId: string): number => (state.forest ? instancesOf(state.forest, componentId).length : 0);
export { findComponent };

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
  if (!(await saveBeforeLeaving())) return;
  const forest = freshForest(name || uniqueName('New forest', state.forests.map((f) => f.name)));
  openLoaded(forest, '');
  await saveNow();
  toast(`Planted “${forest.name}”`, 'success');
}

/** A new forest from the template gallery, with the starter's tokens, components and trees. */
export async function newForestFromStarter(id: string, name?: string): Promise<void> {
  const starter = getStarter(id);
  if (!starter) return toast(`No template "${id}"`, 'error');
  if (!(await saveBeforeLeaving())) return;
  const forest = starter.create(name || uniqueName(starter.label, state.forests.map((f) => f.name)));
  state.dialog = null;
  openLoaded(forest, '');
  await saveNow();
  toast(`Planted “${forest.name}” from the ${starter.label.toLowerCase()} template`, 'success');
}

export async function openForest(id: string): Promise<void> {
  if (id === state.forest?.id) return;
  if (!(await saveBeforeLeaving())) return;
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

/* ------------------------------------------------------------- tokens */

/** Set (or add) a design token in the forest's token kit; every var(--name) follows. */
export function setTokenValue(token: DesignToken): boolean {
  const forest = state.forest;
  if (!forest) return false;
  try {
    commit({ ...forest, kits: setToken(forest.kits, token) });
    return true;
  } catch (err) {
    toast((err as Error).message, 'error');
    return false;
  }
}

/** Drop a token edit, so the kit's own value shows again. */
export function resetTokenValue(name: string): void {
  const forest = state.forest;
  if (forest) commit({ ...forest, kits: resetToken(forest.kits, name) });
}

/* ------------------------------------------------------------- kits */

export function addKit(kit: DesignKit): void {
  const forest = state.forest;
  if (!forest) return;
  commit({ ...forest, kits: addKitsBeforeTokens(forest.kits, [kit]) });
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
/**
 * An editable kit no other kit loads after (tokens kits aside), for styles moved off a branch:
 * they came after every kit as the branch's own styles, and must still beat the kits it matches.
 */
function withLastCustomKit(forest: Forest): { forest: Forest; kitId: string } {
  const kits = forest.kits;
  for (let i = kits.length - 1; i >= 0; i--) {
    if (isEditableKit(kits[i])) return { forest, kitId: kits[i].id };
    if (!isTokenKit(kits[i])) break;
  }
  const kit = createCustomKit();
  return { forest: { ...forest, kits: addKitsBeforeTokens(kits, [kit]) }, kitId: kit.id };
}

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

/** Replace an editable kit's rules from CSS text. Returns what had to be left out or tidied. */
export function setRulesCss(kitId: string, css: string): string[] {
  const forest = state.forest;
  const kit = customKits().find((k) => k.id === kitId);
  if (!forest || !kit) return [];
  const { rules, skipped, reordered, changed } = parseRulesCss(css, kit.rules);
  commit(editRules(forest, kitId, () => rules));
  return [...skipped, ...reordered, ...changed];
}

/**
 * Turn a pasted or uploaded kit into an editable one, so its rules can be edited one by one.
 * Kits with at-rules an editable kit can't hold stay as they are; returns those at-rules.
 */
export function makeKitEditable(kitId: string): string[] {
  const forest = state.forest;
  const kit = forest?.kits.find((k) => k.id === kitId);
  if (!forest || !kit || kit.href || isEditableKit(kit)) return [];
  const { rules, skipped, reordered, changed } = parseRulesCss(kit.css);
  // Only convert when nothing would be lost or would render differently.
  if (skipped.length || reordered.length || changed.length) return [...skipped, ...reordered, ...changed];
  commit({ ...forest, kits: forest.kits.map((k) => (k.id === kitId ? withRules(k, rules) : k)) });
  return [];
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
  // An instance (its root too) is redrawn from its component, which would undo the change.
  const role = instanceRoleIn(tree.root, branchId);
  if (role === 'inside' || role === 'root') {
    toast(role === 'inside' ? INSIDE_INSTANCE : 'This is a component instance: edit the component to save its styles as a class', 'error');
    return;
  }
  // A class a kit defines, or another branch already wears, would pick up these styles too.
  const inUse =
    kitClasses(allKits()).includes(className) ||
    [...forest.trees.map((t) => t.root), ...(forest.components ?? []).map((c) => c.root)].some((root) => {
      let found = false;
      walk(root, (n) => {
        if (found) return false;
        if (isBranch(n) && n.id !== branchId && n.classes.includes(className)) found = true;
      });
      return found;
    });
  if (inUse) {
    toast(`“.${className}” is already used, so these styles would restyle everything with it. Pick another name.`, 'error');
    return;
  }
  // A variant view shows base and variant styles merged; moving those into a class would lose the base.
  if (state.componentVariant) {
    toast('Switch to the base view to save styles as a class', 'error');
    return;
  }
  const selector = `.${className}`;
  if (findRule({ selector })) {
    toast(`“${selector}” already exists. Pick another name, or add the class from the list.`, 'error');
    return;
  }
  const rule = createRule(selector, node.styles);
  const { forest: withKit, kitId } = withLastCustomKit(forest);
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
    if (!(await saveNow())) throw new Error('The open forest’s changes could not be saved, so it stays open. Export it to keep a copy, then import again.');
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
  // Node ids are unique across a forest (collab and history match nodes by id): importing a
  // tree the forest already holds, or one with clashing ids, gives it fresh ids.
  const taken = new Set<string>();
  for (const t of forest.trees) walk(t.root, (n) => void taken.add(n.id));
  let clash = false;
  walk(tree.root, (n) => {
    if (taken.has(n.id)) clash = true;
  });
  if (clash) tree = cloneTree(tree, true);
  else if (forest.trees.some((t) => t.id === tree.id)) tree = { ...tree, id: createId('t') };
  tree = { ...tree, name: uniqueName(tree.name, forest.trees.map((t) => t.name)) };
  // Skip kits the forest already has, and the deployment's own stylesheets.
  const added = newKits(doc.kits);
  commit({ ...forest, trees: [...forest.trees, tree], kits: addKitsBeforeTokens(forest.kits, added) });
  switchTree(tree.id);
  const kitNote = added.length ? ` and ${added.length} design kit${added.length === 1 ? '' : 's'}` : '';
  return { summary: `Added tree “${tree.name}”${kitNote}` };
}

/** A forest as saved on this device, or null. */
export async function loadStoredForest(id: string): Promise<Forest | null> {
  try {
    return (await store.load(id)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Replace what is open with a document, without keeping the old forest around. Used by
 * the embed API, where the host page owns the data. A tree opens in a forest of its own.
 */
export async function openDocument(doc: TreeDocument, meta: ChangeMeta = {}): Promise<{ kind: 'forest' | 'tree'; trees: number }> {
  // A new version of what is open (the host sent back an edited copy) is an undoable change, not a fresh start.
  const open = state.forest;
  if (open && doc.kind === 'forest' && doc.forest.id === open.id) {
    commit(withCurrentBreakpoints(doc.forest), true, meta);
    await saveNow();
    return { kind: 'forest', trees: doc.forest.trees.length };
  }
  if (open && doc.kind === 'tree' && open.trees.some((t) => t.id === doc.tree.id)) {
    const added = newKits(doc.kits);
    // Node ids are unique across the forest: one the forest's other trees use gets a fresh id.
    const taken = idsOutside(open.trees, doc.tree.id);
    const reId = (n: TreeNode): TreeNode => {
      const id = taken.has(n.id) ? createId(isBranch(n) ? 'b' : 'l') : n.id;
      return isBranch(n) ? { ...n, id, children: n.children.map(reId) } : { ...n, id };
    };
    const incoming = taken.size ? { ...doc.tree, root: { ...(reId(doc.tree.root) as Branch), id: doc.tree.root.id } } : doc.tree;
    commit({ ...replaceTree(open, incoming), kits: addKitsBeforeTokens(open.kits, added) }, true, meta);
    switchTree(doc.tree.id);
    await saveNow();
    return { kind: 'tree', trees: 1 };
  }
  let forest: Forest;
  if (doc.kind === 'forest') forest = doc.forest;
  else {
    forest = createForest(doc.tree.name, [doc.tree]);
    forest.kits = doc.kits.filter((k) => !isEnvKit(k));
  }
  // Edits still waiting for the debounced save would be lost when the forest is replaced.
  if (open && state.saveState !== 'saved' && !(await saveNow())) throw new Error('The open forest’s changes could not be saved, so it stays open');
  openLoaded(forest, '');
  await saveNow();
  return { kind: doc.kind, trees: forest.trees.length };
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
  const kits = format === 'html' || format === 'svg' ? allKits() : forest.kits;
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

/** The current tree as a React, Vue, Svelte, SwiftUI or Flutter component (or HTML + CSS files); several files come as a zip. */
export function exportComponentCurrent(framework: ComponentFramework, styling: ComponentStyling): ExportOutput {
  const tree = currentTree()!;
  // Only the forest's kits: the deployment's stylesheets are the host app's to load.
  // With a component open, export the component itself: its props and variants become code.
  const def = editingComponent();
  const out = def ? exportComponentDef(def, { framework, styling, kits: state.forest!.kits }) : exportComponent(tree, { framework, styling, kits: state.forest!.kits });
  if (out.files.length === 1) {
    const file = out.files[0];
    return { text: file.contents, fileName: file.path, mime: 'text/plain' };
  }
  const text = out.files.map((f) => `/* ===== ${f.path} ===== */\n${f.contents}`).join('\n');
  const folder = framework === 'html' ? suggestFileName(tree.name, 'tree', 'html').replace(/\.tree\.html$|\.html$/, '') : out.name;
  return { text, fileName: `${folder}.zip`, mime: 'application/zip', bytes: zip(out.files.map((f) => ({ path: `${folder}/${f.path}`, content: f.contents }))) };
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

/* ---------------------------------------------------------------- preview */

/** A tree as it ships: its kits and responsive CSS, with none of the editor's outlines or handles. */
export function treePage(tree: Tree): string {
  return renderDocument(tree, { kits: allKits() });
}

/**
 * Open a page in a new browser tab. Blob pages have no base URL, so linked kits get absolute
 * hrefs first. The URL is kept alive so the tab can be reloaded.
 */
function openPage(html: string): boolean {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const tab = window.open(url, '_blank');
  if (!tab) toast('The browser blocked the new tab. Allow pop-ups for this site and try again.', 'error');
  return !!tab;
}

const absoluteKits = (): DesignKit[] => allKits().map((k) => (k.href ? { ...k, href: new URL(k.href, document.baseURI).href } : k));

/** Open one tree in a new tab, as a snapshot of how it looks now. */
export function openTreeInTab(treeId: string): void {
  const tree = state.forest?.trees.find((t) => t.id === treeId);
  if (tree) openPage(renderDocument(tree, { kits: absoluteKits() }));
}

/** Open the whole forest in a new tab: an index page that links to a page per tree. */
export function openForestInTab(): void {
  const forest = state.forest;
  if (!forest) return;
  const kits = absoluteKits();
  const entries = forest.trees.map((t) => ({
    name: t.name,
    href: URL.createObjectURL(new Blob([renderDocument(t, { kits })], { type: 'text/html;charset=utf-8' })),
  }));
  openPage(renderForestIndex(forest.name, entries));
}
