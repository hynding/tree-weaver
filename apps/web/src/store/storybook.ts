import { cloneNode, createId, now, type DesignKit, type DisplayId } from '@tree-weaver/core';
import {
  filterStories,
  snapshotToBranch,
  storiesToTrees,
  storyKits,
  viewportDisplaySettings,
  type LibraryBranch,
  type StoryEntry,
  type StorySnapshot,
} from '@tree-weaver/formats';
import { createRecordStore, type RecordStore } from '@tree-weaver/storage';
import { ENV_STORYBOOK_INCLUDE, ENV_STORYBOOK_URLS, STORYBOOK_IMPORT_ENABLED } from '../config';
import { isSameOrigin, loadCatalog, snapshotStories, storybookBase } from '../utils/storybook';
import { removeUploadedStorybook } from '../utils/storybook-upload';
import { addTreesWithKits, insertWithKits, setDisplaySizes, toast, type DropPosition } from './actions';
import { state, type StorybookLibrary } from './editor';

/**
 * Storybook import: stories rendered as static snapshots become palette branches (kept per
 * browser as libraries), new trees, or both, with their styles as design kits.
 */

let libraries: RecordStore<StorybookLibrary> | null = null;

async function libraryStore(): Promise<RecordStore<StorybookLibrary>> {
  libraries ??= await createRecordStore<StorybookLibrary>('tree-weaver-libraries');
  return libraries;
}

const byName = (a: StorybookLibrary, b: StorybookLibrary) => Number(!!b.env) - Number(!!a.env) || a.name.localeCompare(b.name);

async function saveLibrary(lib: StorybookLibrary): Promise<void> {
  await (await libraryStore()).put(lib);
  state.libraries = [...state.libraries.filter((l) => l.id !== lib.id), lib].sort(byName);
}

/** A library's name from its URL, e.g. `design-system` for `https://x.com/design-system/`. */
export function storybookName(base: string): string {
  const parts = new URL(base).pathname.split('/').filter(Boolean);
  const last = parts.pop();
  const name = last === 'storybook-static' || last === 'storybook' ? (parts.pop() ?? last) : last;
  return name ? decodeURIComponent(name) : new URL(base).host;
}

/**
 * Load saved libraries, then build any library the deployment sets (`TW_STORYBOOK_URLS`,
 * same-origin only) that isn't saved yet. Runs in the background after startup.
 */
export async function initLibraries(): Promise<void> {
  try {
    const store = await libraryStore();
    state.libraries = (await store.list()).sort(byName);
  } catch (err) {
    console.warn('Storybook libraries could not be loaded', err);
    return;
  }
  if (!STORYBOOK_IMPORT_ENABLED) return;
  for (const url of ENV_STORYBOOK_URLS) {
    let base: string;
    try {
      base = storybookBase(url);
    } catch {
      console.warn(`TW_STORYBOOK_URLS: “${url}” is not a URL`);
      continue;
    }
    if (!isSameOrigin(base) || state.libraries.some((l) => l.source === base)) continue;
    await buildLibrary(base, { env: true, quiet: true });
  }
}

/** Render every story of a Storybook (within `TW_STORYBOOK_INCLUDE`) into a palette library. */
export async function buildLibrary(base: string, opts: { env?: boolean; quiet?: boolean; id?: string } = {}): Promise<StorybookLibrary | null> {
  const id = opts.id ?? state.libraries.find((l) => l.source === base)?.id ?? createId('sb');
  state.librariesLoading = [...state.librariesLoading, id];
  try {
    const catalog = await loadCatalog(base);
    const stories = filterStories(catalog.stories, ENV_STORYBOOK_INCLUDE);
    if (!stories.length) throw new Error(catalog.stories.length ? 'No stories match TW_STORYBOOK_INCLUDE' : 'This Storybook has no stories');
    const snapshots = await snapshotStories(base, stories, () => undefined);
    if (!snapshots.length) throw new Error('None of its stories could be read');
    const existing = state.libraries.find((l) => l.id === id);
    const lib = libraryFrom(id, existing?.name ?? storybookName(base), base, snapshots, existing?.uploaded ? 'copy' : 'link', {
      env: opts.env ?? existing?.env,
      uploaded: existing?.uploaded,
    });
    await saveLibrary(lib);
    if (!opts.quiet) toast(`Loaded ${lib.items.length} branch${lib.items.length === 1 ? '' : 'es'} from “${lib.name}”`, 'success');
    return lib;
  } catch (err) {
    if (opts.quiet) console.warn(`Storybook ${base}: ${(err as Error).message}`);
    else toast((err as Error).message, 'error');
    return null;
  } finally {
    state.librariesLoading = state.librariesLoading.filter((l) => l !== id);
  }
}

function libraryFrom(
  id: string,
  name: string,
  source: string,
  snapshots: StorySnapshot[],
  styles: 'link' | 'copy',
  flags: { env?: boolean; uploaded?: boolean } = {},
): StorybookLibrary {
  const items: LibraryBranch[] = snapshots.map((s) => ({ id: s.id, title: s.title, name: s.name, branch: snapshotToBranch(s) }));
  const lib: StorybookLibrary = { id, name, source, items, kits: storyKits(snapshots, { name, styles, source }), importedAt: now() };
  if (flags.env) lib.env = true;
  if (flags.uploaded) lib.uploaded = true;
  return lib;
}

export interface StorybookImportOptions {
  base: string;
  name: string;
  stories: StoryEntry[];
  /** Palette branches, new trees, or both. */
  as: 'palette' | 'trees' | 'both';
  /** Link stylesheet files, or copy their CSS into the forest. */
  styles: 'link' | 'copy';
  /** Use the Storybook's viewport sizes for the display types. */
  viewports: boolean;
  /** The Storybook was uploaded and is served by this browser. */
  uploaded?: boolean;
}

export type StoryProgress = (story: StoryEntry, result: { snapshot?: StorySnapshot; error?: string }) => void;

/** Import the chosen stories. Returns a one-line summary. */
export async function importStories(opts: StorybookImportOptions, onProgress: StoryProgress): Promise<string> {
  const snapshots = await snapshotStories(opts.base, opts.stories, onProgress);
  if (!snapshots.length) throw new Error('None of the chosen stories could be read');
  const notes: string[] = [];

  if (opts.as !== 'trees') {
    const existing = state.libraries.find((l) => l.source === opts.base);
    const fresh = libraryFrom(existing?.id ?? createId('sb'), existing?.name ?? opts.name, opts.base, snapshots, opts.styles, { env: existing?.env, uploaded: opts.uploaded });
    // Re-importing a library updates the stories it already had and keeps the rest.
    const lib: StorybookLibrary = existing
      ? {
          ...fresh,
          items: [...existing.items.filter((i) => !fresh.items.some((f) => f.id === i.id)), ...fresh.items],
          kits: mergeKits(existing.kits, fresh.kits),
        }
      : fresh;
    await saveLibrary(lib);
    notes.push(`${fresh.items.length} palette branch${fresh.items.length === 1 ? '' : 'es'}`);
    state.tab = 'branches';
  }

  if (opts.as !== 'palette') {
    const items = snapshots.map((s) => ({ id: s.id, title: s.title, name: s.name, branch: snapshotToBranch(s) }));
    const added = addTreesWithKits(storiesToTrees(items), storyKits(snapshots, { name: opts.name, styles: opts.styles, source: opts.base }));
    notes.push(`${added.trees.length} tree${added.trees.length === 1 ? '' : 's'}`);
    if (added.kits.length) notes.push(`${added.kits.length} design kit${added.kits.length === 1 ? '' : 's'}`);
  }

  if (opts.viewports) {
    const viewports = snapshots.flatMap((s) => s.viewports ?? []);
    const changed: DisplayId[] = viewports.length ? setDisplaySizes(viewportDisplaySettings(viewports)) : [];
    if (changed.length) notes.push(`sizes for ${changed.length} display type${changed.length === 1 ? '' : 's'}`);
  }

  const failed = opts.stories.length - snapshots.length;
  return `Imported ${notes.join(', ')} from “${opts.name}”${failed ? ` (${failed} stor${failed === 1 ? 'y' : 'ies'} failed)` : ''}`;
}

/** Kits from a re-import replace earlier ones with the same URL or name. */
function mergeKits(old: DesignKit[], fresh: DesignKit[]): DesignKit[] {
  const key = (k: DesignKit) => k.href ?? k.source + k.name;
  return [...old.filter((k) => !fresh.some((f) => key(f) === key(k))), ...fresh];
}

/** Add a Storybook branch to the current tree, with the kits it needs. */
export function insertLibraryBranch(libraryId: string, storyId: string, targetId?: string, position?: DropPosition): void {
  const lib = state.libraries.find((l) => l.id === libraryId);
  const item = lib?.items.find((i) => i.id === storyId);
  if (!lib || !item) return;
  insertWithKits(cloneNode(item.branch, true), lib.kits, targetId, position);
}

export async function removeLibrary(id: string): Promise<void> {
  const lib = state.libraries.find((l) => l.id === id);
  await (await libraryStore()).remove(id);
  // An uploaded Storybook's files go too; branches already in trees keep working (their styles were copied).
  if (lib?.uploaded) await removeUploadedStorybook(lib.source).catch((err) => console.warn(err));
  state.libraries = state.libraries.filter((l) => l.id !== id);
}

/** Render a library's stories again, picking up changes to the Storybook. */
export async function refreshLibrary(id: string): Promise<void> {
  const lib = state.libraries.find((l) => l.id === id);
  if (!lib) return;
  if (!isSameOrigin(lib.source)) {
    toast('This Storybook is on another site, so it can’t be read again from here', 'error');
    return;
  }
  await buildLibrary(lib.source, { id, env: lib.env });
}

/** Encode a library branch for drag and drop: `libraryId storyId`. */
export const libraryDragData = (libraryId: string, storyId: string): string => `${libraryId} ${storyId}`;

export function dropLibraryBranch(data: string, targetId: string, position: DropPosition): void {
  const [libraryId, storyId] = data.split(' ');
  if (libraryId && storyId) insertLibraryBranch(libraryId, storyId, targetId, position);
}
