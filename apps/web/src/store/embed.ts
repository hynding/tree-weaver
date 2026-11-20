import { applyPatch, idsOutside, formatDiff, diffLines, isDisplayId, replaceTree, type Tree } from '@tree-weaver/core';
import { expandShorthand } from '@tree-weaver/branches';
import { exportForest, exportTree, FORMATS, importDocument, type FormatId } from '@tree-weaver/formats';
import type { EditorMessage, HostMessage } from '@tree-weaver/embed';
import { allKits, commit, currentTree, importText, openDocument, redo, setDisplay, switchTree, toast, undo } from './actions';
import { compareWithCurrent, restoreVersion, saveVersion, versionBefore } from './versions';
import { onChange, state, type ForestVersion } from './editor';
import { allowedOrigins, isEmbedded, sourceUrl } from './embed-flags';

/**
 * The editor's links to the outside world:
 *
 * - `?src=<url>` and `#doc=<base64url>` open a document on startup, so an agent or a page
 *   can hand someone a link to a tree.
 * - With `?embed=1`, a `postMessage` API for the host page (see `@tree-weaver/embed` for the
 *   protocol and the `<tree-weaver-editor>` element that speaks it).
 */

const VERSION = '1';
const FORMAT_IDS = FORMATS.map((f) => f.id) as string[];

/** Origin allowed to drive the editor and receive its documents. */
let hostOrigin: string | null = null;

function post(message: EditorMessage, origin: string): void {
  window.parent.postMessage(message, origin);
}

/** Decode `#doc=` (base64url, UTF-8). */
function decodeHashDoc(hash: string): string | null {
  const m = /(?:^#|&)doc=([A-Za-z0-9_-]+={0,2})/.exec(hash);
  if (!m) return null;
  const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function fetchDocument(src: string): Promise<{ text: string; fileName: string }> {
  const url = new URL(src, location.href);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only http(s) links can be opened');
  const res = await fetch(url.href, { credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { text: await res.text(), fileName: decodeURIComponent(url.pathname.split('/').pop() ?? '') };
}

/** Open the document named in the URL, if any. */
async function openFromUrl(): Promise<void> {
  const src = sourceUrl();
  let hashDoc: string | null = null;
  try {
    hashDoc = decodeHashDoc(location.hash);
  } catch {
    toast('The link’s #doc= part is not valid base64url', 'error');
  }
  if (!src && hashDoc === null) return;
  try {
    const { text, fileName } = src ? await fetchDocument(src) : { text: hashDoc!, fileName: undefined };
    if (isEmbedded()) {
      const r = await openDocument(importDocument(text, undefined, fileName));
      toast(`Opened ${r.kind === 'forest' ? 'a forest' : 'a tree'} from the link`, 'success');
    } else {
      const { summary } = await importText(text, undefined, fileName);
      toast(summary, 'success');
      // Opened once: a reload shouldn't import it again.
      const clean = new URL(location.href);
      clean.searchParams.delete('src');
      clean.hash = clean.hash.replace(/(^#|&)doc=[^&]*/, '$1').replace(/^#&?$/, '');
      history.replaceState(history.state, '', clean.href);
    }
  } catch (err) {
    toast(`Could not open ${src ? src : 'the linked document'}: ${(err as Error).message}`, 'error');
  }
}

function pickTree(ref: string | undefined): Tree {
  const forest = state.forest!;
  if (ref === undefined) {
    const tree = currentTree();
    if (!tree) throw new Error('No tree is open');
    // A component's template is open on the canvas, which isn't one of the forest's trees.
    if (!forest.trees.some((t) => t.id === tree.id)) throw new Error('A component is open, not a tree; name the tree to patch with "tree"');
    return tree;
  }
  const lower = String(ref).toLowerCase();
  const tree = forest.trees.find((t) => t.id === ref) ?? forest.trees.find((t) => t.name.toLowerCase() === lower);
  if (!tree) throw new Error(`No tree "${ref}"`);
  return tree;
}

const versionInfo = (v: ForestVersion) => ({ id: v.id, name: v.name, createdAt: v.createdAt, source: v.source, auto: !!v.auto });

/** A version by id, or by name (newest match). */
function versionRef(ref: unknown): ForestVersion {
  if (typeof ref !== 'string' || !ref) throw new Error('"version" is missing');
  const lower = ref.toLowerCase();
  const v = state.versions.find((x) => x.id === ref) ?? state.versions.find((x) => x.name.toLowerCase() === lower);
  if (!v) throw new Error(`No version "${ref}"`);
  return v;
}

function forestJson() {
  const forest = state.forest!;
  return JSON.parse(exportForest(forest, 'json')).forest;
}

async function handle(msg: HostMessage): Promise<unknown> {
  switch (msg.type) {
    case 'ping':
      return { version: VERSION };
    case 'load': {
      if (msg.document === undefined || msg.document === null) throw new Error('"document" is missing');
      if (msg.format !== undefined && !FORMAT_IDS.includes(msg.format)) throw new Error(`Unknown format "${msg.format}"`);
      const text = typeof msg.document === 'string' ? msg.document : JSON.stringify(msg.document);
      const doc = importDocument(text, msg.format as FormatId | undefined);
      // Reloading what is open (an edited copy) is a change worth being able to roll back.
      const open = state.forest;
      const replacing = !!open && (doc.kind === 'forest' ? doc.forest.id === open.id : open.trees.some((t) => t.id === doc.tree.id));
      if (replacing) await versionBefore('host', msg.label ? `Before ${msg.label}` : 'Before a host page update');
      return openDocument(doc, { source: 'host', ...(msg.label ? { label: msg.label } : {}) });
    }
    case 'patch': {
      const forest = state.forest;
      if (!forest) throw new Error('Nothing is open');
      const tree = pickTree(msg.tree);
      const result = applyPatch(tree.root, msg.ops, { expandNode: (value, path) => expandShorthand(value, path), takenIds: idsOutside(forest.trees, tree.id) });
      if (!result.changes.length) return { changes: [], warnings: result.warnings };
      await versionBefore('agent', msg.label ? `Before ${msg.label}` : 'Before an agent patch');
      const updated: Tree = { ...tree, root: result.root, updatedAt: new Date().toISOString() };
      // The forest may have changed while the version saved; patch the newest copy of the tree.
      const current = state.forest!;
      if (current.trees.find((t) => t.id === tree.id) !== tree) throw new Error('The tree changed while the patch was being applied; nothing was changed');
      commit({ ...replaceTree(current, updated), updatedAt: updated.updatedAt }, true, { source: 'agent', ...(msg.label ? { label: msg.label } : {}) });
      return { changes: result.changes, warnings: result.warnings };
    }
    case 'undo':
      undo();
      return { canUndo: state.canUndo, canRedo: state.canRedo };
    case 'redo':
      redo();
      return { canUndo: state.canUndo, canRedo: state.canRedo };
    case 'saveVersion': {
      const v = await saveVersion(String(msg.name ?? ''), { source: 'host' });
      if (!v) throw new Error('The version could not be saved');
      return versionInfo(v);
    }
    case 'listVersions':
      return state.versions.map(versionInfo);
    case 'restoreVersion': {
      const v = versionRef(msg.version);
      restoreVersion(v.id);
      return versionInfo(v);
    }
    case 'diff': {
      const v = versionRef(msg.version);
      const diff = compareWithCurrent(v.id);
      if (!diff) throw new Error('Nothing is open');
      return { empty: diff.empty, changes: diffLines(diff), text: formatDiff(diff) };
    }
    case 'getDocument': {
      const format = (msg.format ?? 'json') as FormatId;
      if (!FORMAT_IDS.includes(format)) throw new Error(`Unknown format "${format}"`);
      const forest = state.forest;
      if (!forest) throw new Error('Nothing is open');
      const info = FORMATS.find((f) => f.id === format)!;
      if (msg.scope === 'tree' || !info.forest) {
        const tree = currentTree();
        if (!tree) throw new Error('No tree is open');
        return exportTree(tree, format, allKits().filter((k) => k.source !== 'env'));
      }
      return exportForest(forest, format);
    }
    case 'setDisplay':
      if (!isDisplayId(msg.display)) throw new Error(`Unknown display "${String(msg.display)}"`);
      setDisplay(msg.display);
      return null;
    case 'selectTree': {
      const lower = String(msg.tree).toLowerCase();
      const tree = state.forest?.trees.find((t) => t.id === msg.tree) ?? state.forest?.trees.find((t) => t.name.toLowerCase() === lower);
      if (!tree) throw new Error(`No tree "${msg.tree}"`);
      switchTree(tree.id);
      return null;
    }
    default:
      throw new Error(`Unknown message type "${(msg as { type?: string }).type}"`);
  }
}

function listen(): void {
  const allowed = allowedOrigins();
  window.addEventListener('message', (ev: MessageEvent) => {
    // Only the page that frames the editor may drive it.
    if (ev.source !== window.parent || window.parent === window) return;
    const msg = ev.data as HostMessage;
    if (!msg || typeof msg !== 'object' || msg.source !== 'tree-weaver-host') return;
    if (allowed.length ? !allowed.includes(ev.origin) : hostOrigin !== null && hostOrigin !== ev.origin) {
      console.warn(`Tree Weaver: ignoring a message from ${ev.origin}`);
      return;
    }
    hostOrigin = ev.origin;
    const reply = (body: { ok: true; result: unknown } | { ok: false; error: string }) => {
      if (msg.id !== undefined) post({ source: 'tree-weaver-editor', type: 'response', id: String(msg.id), ...body } as EditorMessage, ev.origin);
    };
    handle(msg).then(
      (result) => reply({ ok: true, result: result ?? null }),
      (err: unknown) => reply({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
  });

  // Tell the host about changes, at most every 300 ms, and only once it is known.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const origin = hostOrigin ?? (allowed.length === 1 ? allowed[0] : null);
      if (!origin || !state.forest) return;
      post({ source: 'tree-weaver-editor', type: 'change', forest: forestJson(), treeId: state.treeId }, origin);
    }, 300);
  };
  onChange('forest', changed);
  onChange('treeId', changed);

}

/** Call once the editor has started. */
export async function startLinks(): Promise<void> {
  const framed = isEmbedded() && window.parent !== window;
  if (framed) listen();
  await openFromUrl();
  // A #doc= link opened in a tab that already shows the editor only changes the hash.
  window.addEventListener('hashchange', () => {
    if (/(^#|&)doc=/.test(location.hash)) void openFromUrl();
  });
  // "ready" carries nothing, so it may go to any origin; the host learns it can talk now,
  // after any ?src= document has opened.
  if (framed) post({ source: 'tree-weaver-editor', type: 'ready', version: VERSION }, '*');
}
