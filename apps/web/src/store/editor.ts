import { createStore } from '@stencil/store';
import type { DesignKit, DisplayId, Forest, ForestSummary } from '@tree-weaver/core';

export type SidebarTab = 'branches' | 'outline' | 'classes' | 'kits' | 'forest';
export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';
export type DialogKind = null | 'export' | 'import';

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
  /** Bumped when the canvas's stylesheets, markup or width change, so views that read the canvas refresh. */
  canvasVersion: number;
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
  canvasVersion: 0,
});
