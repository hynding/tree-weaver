import { AUTO_VERSION_LIMIT, createId, diffForests, normalizeForest, type ChangeSource, type Forest, type ForestDiff } from '@tree-weaver/core';
import { createRecordStore, MemoryRecordStore, type RecordStore } from '@tree-weaver/storage';
import { commit, toast } from './actions';
import { onChange, state, type ForestVersion } from './editor';
import { isEmbedded } from './embed-flags';

/**
 * Saved versions of forests: named snapshots someone takes ("Before the redesign"), and
 * automatic ones taken before a host page or an agent changes the forest, so their changes
 * can be compared and rolled back. Kept in this browser (in memory when embedded), apart
 * from the forests, so a forest's file stays small.
 */

/** Automatic versions kept per forest; named ones stay until deleted. */
const AUTO_LIMIT = AUTO_VERSION_LIMIT;

let store: RecordStore<ForestVersion> | null = null;
let loadedFor = '';

async function versionStore(): Promise<RecordStore<ForestVersion>> {
  store ??= isEmbedded() ? new MemoryRecordStore<ForestVersion>() : await createRecordStore<ForestVersion>('tree-weaver-versions');
  return store;
}

const newestFirst = (a: ForestVersion, b: ForestVersion) => b.createdAt.localeCompare(a.createdAt);

async function loadVersions(forestId: string): Promise<void> {
  loadedFor = forestId;
  try {
    const all = await (await versionStore()).list();
    if (loadedFor !== forestId) return;
    state.versions = all.filter((v) => v.forestId === forestId).sort(newestFirst);
  } catch (err) {
    console.warn('Versions could not be loaded', err);
    state.versions = [];
  }
}

/** Load the open forest's versions now and whenever another forest opens. */
export function initVersions(): void {
  if (state.forest) void loadVersions(state.forest.id);
  onChange('forest', (forest) => {
    if (forest && forest.id !== loadedFor) void loadVersions(forest.id);
  });
}

/** Save the open forest as a version. Automatic versions past the limit are dropped, oldest first. */
export async function saveVersion(name: string, opts: { source?: ChangeSource; auto?: boolean } = {}): Promise<ForestVersion | null> {
  const forest = state.forest;
  if (!forest) return null;
  return saveForestVersion(forest, name, opts);
}

/** Save a forest (open or not) as a version of itself. */
export async function saveForestVersion(forest: Forest, name: string, opts: { source?: ChangeSource; auto?: boolean } = {}): Promise<ForestVersion | null> {
  const version: ForestVersion = {
    id: createId('v'),
    forestId: forest.id,
    name: name.trim() || (opts.auto ? 'Automatic' : `Version ${state.versions.filter((v) => !v.auto).length + 1}`),
    createdAt: new Date().toISOString(),
    source: opts.source ?? 'editor',
    ...(opts.auto ? { auto: true } : {}),
    forest: JSON.parse(JSON.stringify(forest)) as Forest,
  };
  const s = await versionStore();
  try {
    await s.put(version);
  } catch (err) {
    toast(`Could not save the version: ${(err as Error).message}`, 'error');
    return null;
  }
  let list = [version, ...state.versions.filter((v) => v.forestId === forest.id)];
  const autos = list.filter((v) => v.auto);
  for (const old of autos.slice(AUTO_LIMIT)) {
    await s.remove(old.id);
    list = list.filter((v) => v.id !== old.id);
  }
  if (state.forest?.id === forest.id) state.versions = list;
  return version;
}

/** Take an automatic version before a change from outside the editor, unless the latest version already matches. */
export async function versionBefore(source: ChangeSource, label: string): Promise<void> {
  const forest = state.forest;
  if (!forest) return;
  const latest = state.versions[0];
  if (latest && diffForests(latest.forest, forest).empty) return;
  await saveVersion(label, { source, auto: true });
}

function findVersion(id: string): ForestVersion | undefined {
  return state.versions.find((v) => v.id === id);
}

/** Bring back a version. It is one undoable change, so a restore can itself be undone. */
export function restoreVersion(id: string): boolean {
  const version = findVersion(id);
  const forest = state.forest;
  if (!version || !forest) return false;
  // Keep the open forest's id, so the restored copy replaces it rather than becoming another forest.
  const restored = normalizeForest({ ...JSON.parse(JSON.stringify(version.forest)), id: forest.id, updatedAt: new Date().toISOString() });
  commit(restored, true, { source: 'restore', label: `Restored “${version.name}”` });
  toast(`Restored “${version.name}”`, 'success');
  return true;
}

export async function deleteVersion(id: string): Promise<void> {
  await (await versionStore()).remove(id);
  state.versions = state.versions.filter((v) => v.id !== id);
}

export async function renameVersion(id: string, name: string): Promise<void> {
  const version = findVersion(id);
  if (!version || !name.trim()) return;
  const next = { ...version, name: name.trim(), auto: undefined };
  delete next.auto;
  await (await versionStore()).put(next);
  state.versions = state.versions.map((v) => (v.id === id ? next : v));
}

/** What changed from a version to the open forest. */
export function compareWithCurrent(id: string): ForestDiff | null {
  const version = findVersion(id);
  return version && state.forest ? diffForests(version.forest, state.forest) : null;
}

/** Remove every version of a forest (when the forest is deleted). */
export async function deleteForestVersions(forestId: string): Promise<void> {
  const s = await versionStore();
  for (const v of await s.list()) if (v.forestId === forestId) await s.remove(v.id);
  if (state.forest?.id === forestId) state.versions = [];
}
