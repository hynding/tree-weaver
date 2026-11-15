import { createStore } from '@stencil/store';
import type { ChangeSource, DesignKit, DisplayId, DisplaySettings, Forest, ForestSummary } from '@tree-weaver/core';
import type { LibraryBranch } from '@tree-weaver/formats';

export type SidebarTab = 'branches' | 'outline' | 'classes' | 'tokens' | 'kits' | 'forest' | 'history';
export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';
export type DialogKind = null | 'export' | 'import' | 'displays' | 'storybook' | 'share';

/** Someone else in a shared forest. */
export interface CollabPeer {
  id: number;
  name: string;
  /** Index into the collaborator colours. */
  color: number;
  selectedId: string | null;
  treeId: string;
}

/**
 * Branches imported from a Storybook, kept in this browser (not in a forest) and offered in
 * every forest's palette under "From Storybook".
 */
export interface StorybookLibrary {
  id: string;
  name: string;
  /** The Storybook's base URL. For an uploaded Storybook, the address this browser serves it from. */
  source: string;
  /** Uploaded as a folder or zip, rather than read from a URL. */
  uploaded?: boolean;
  /** Set by the deployment (`TW_STORYBOOK_URLS`). */
  env?: boolean;
  items: LibraryBranch[];
  /** Design kits the library's branches need. They join a forest when one of its branches is first used. */
  kits: DesignKit[];
  importedAt: string;
}

/** A saved copy of a forest, named by someone or taken automatically before an outside change. */
export interface ForestVersion {
  id: string;
  forestId: string;
  name: string;
  createdAt: string;
  source: ChangeSource;
  auto?: boolean;
  forest: Forest;
}

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
}

export interface EditorState {
  ready: boolean;
  forest: Forest | null;
  /** Stylesheets set by the deployment (`TW_CSS_URLS`). They load before every forest's kits and are never saved. */
  envKits: DesignKit[];
  treeId: string;
  selectedId: string | null;
  hoverId: string | null;
  display: DisplayId;
  forests: ForestSummary[];
  storageKind: 'indexeddb' | 'localstorage' | 'memory' | null;
  saveState: SaveState;
  canUndo: boolean;
  canRedo: boolean;
  tab: SidebarTab;
  dialog: DialogKind;
  /** Showing the full-window preview instead of the editor. */
  preview: boolean;
  toasts: Toast[];
  /** Id of a node being dragged from the outline or canvas, so drop targets can validate. */
  dragNodeId: string | null;
  /** Kit shown expanded in the Kits tab. */
  openKitId: string | null;
  /** Custom rule shown expanded in the Classes tab. */
  openRuleId: string | null;
  /** While editing a component: the variant whose styles are shown and edited (null: the base). */
  componentVariant: string | null;
  /** Bumped when the canvas's stylesheets, markup or width change, so views that read the canvas refresh. */
  canvasVersion: number;
  /** Display sizes and breakpoints changed in this browser. `TW_DISPLAYS` values win over these. */
  displaySettings: DisplaySettings;
  /** Bumped when the display sizes or breakpoints change, so views that list displays refresh. */
  displaysVersion: number;
  /** Branch libraries imported from Storybooks. */
  libraries: StorybookLibrary[];
  /** Ids of libraries being (re)built in the background. */
  librariesLoading: string[];
  /** Saved versions of the open forest, newest first. */
  versions: ForestVersion[];
  /** Live collaboration: off, joining a room from a link, or sharing. */
  collabStatus: 'off' | 'joining' | 'live';
  collabLink: string;
  collabPeers: CollabPeer[];
  /** The name and colour others see. */
  collabName: string;
  collabColor: number;
}

export const { state, onChange, reset } = createStore<EditorState>({
  ready: false,
  forest: null,
  envKits: [],
  treeId: '',
  selectedId: null,
  hoverId: null,
  display: 'lg',
  forests: [],
  storageKind: null,
  saveState: 'saved',
  canUndo: false,
  canRedo: false,
  tab: 'branches',
  dialog: null,
  preview: false,
  toasts: [],
  dragNodeId: null,
  openKitId: null,
  openRuleId: null,
  componentVariant: null,
  canvasVersion: 0,
  displaySettings: {},
  displaysVersion: 0,
  libraries: [],
  librariesLoading: [],
  versions: [],
  collabStatus: 'off',
  collabLink: '',
  collabPeers: [],
  collabName: '',
  collabColor: 0,
});
