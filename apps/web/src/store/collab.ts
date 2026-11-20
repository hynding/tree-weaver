import { hasForest, pruneStrays, LOCAL_ORIGIN, newRoom, parseRoomHash, readForest, roomHash, sharedTypes, writeForest, Y, type CollabRoom } from '@tree-weaver/collab';
import { createRecordStore, type RecordStore } from '@tree-weaver/storage';
import { WebrtcProvider } from 'y-webrtc';
import { COLLAB_ENABLED, COLLAB_ICE_SERVERS, COLLAB_SIGNALING } from '../config';
import { diffForests, isEditableKit, type Forest } from '@tree-weaver/core';
import { commit, loadStoredForest, openDocument, saveNow, setHistoryOverride, toast, withCurrentBreakpoints } from './actions';
import { saveForestVersion } from './versions';
import { onChange, state, type CollabPeer } from './editor';
import { isEmbedded } from './embed-flags';

/**
 * Live collaboration: share the open forest with a link and edit it together in real time.
 *
 * The site is static, so there is no Tree Weaver server. Browsers in a room talk to each other
 * directly over WebRTC; a small public signaling server (configurable with
 * `TW_COLLAB_SIGNALING`) only introduces them. Everything sent is encrypted with the room key,
 * which lives in the link's `#collab=` fragment and is never sent to any server. Tabs of the same
 * browser also sync over a BroadcastChannel, with no network at all.
 *
 * Edits merge per node and field (see `@tree-weaver/collab`), and undo in a shared forest
 * undoes only your own changes.
 */

const COLORS = 8;
const PRUNE_ORIGIN = 'tree-weaver-prune';
const NAME_KEY = 'tree-weaver:collab-name';

interface Session {
  room: CollabRoom;
  doc: Y.Doc;
  provider: WebrtcProvider;
  undo: Y.UndoManager;
  /** The forest the document showed when this editor last read or wrote it. */
  synced: Forest | null;
  stop: (() => void)[];
  /** True while joining opens the room's forest. */
  opening?: boolean;
}

let session: Session | null = null;
let lastUndoAction = 'Undo';

/* ------------------------------------------------------- room state on this device */

interface SavedRoom {
  id: string;
  /** The shared document's state, base64, so a reload rejoins with everything it had (even offline). */
  update: string;
  savedAt: string;
}

let rooms: RecordStore<SavedRoom> | null = null;
async function roomStore(): Promise<RecordStore<SavedRoom>> {
  rooms ??= await createRecordStore<SavedRoom>('tree-weaver-rooms');
  return rooms;
}

const toBase64 = (bytes: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function saveRoom(s: Session): Promise<void> {
  try {
    await (await roomStore()).put({ id: s.room.room, update: toBase64(Y.encodeStateAsUpdate(s.doc)), savedAt: new Date().toISOString() });
  } catch (err) {
    console.warn('Could not keep the shared forest on this device', err);
  }
}

async function loadRoom(room: CollabRoom, doc: Y.Doc): Promise<void> {
  try {
    const saved = await (await roomStore()).get(room.room);
    if (saved) Y.applyUpdate(doc, fromBase64(saved.update), 'saved');
  } catch (err) {
    console.warn('Could not read the shared forest kept on this device', err);
  }
}

const shareLink = (room: CollabRoom): string => {
  const url = new URL(location.href);
  url.search = '';
  url.hash = roomHash(room);
  return url.href;
};

function myName(): string {
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) return saved;
  } catch {
    // Storage disabled.
  }
  const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];
  const adjectives = ['Amber', 'Brisk', 'Calm', 'Clever', 'Golden', 'Jolly', 'Keen', 'Lucky', 'Mossy', 'Quiet', 'Rapid', 'Sunny', 'Swift', 'Tidy', 'Witty'];
  const animals = ['Badger', 'Finch', 'Fox', 'Hare', 'Heron', 'Lynx', 'Moth', 'Otter', 'Owl', 'Wren'];
  return `${pick(adjectives)} ${pick(animals)}`;
}

/** Change the name others see. */
export function setMyName(name: string): void {
  const clean = name.trim().slice(0, 40);
  if (!clean) return;
  state.collabName = clean;
  try {
    localStorage.setItem(NAME_KEY, clean);
  } catch {
    // Best effort.
  }
  publishPresence();
}

function publishPresence(): void {
  session?.provider.awareness.setLocalStateField('user', {
    name: state.collabName,
    color: state.collabColor,
    selectedId: state.selectedId,
    treeId: state.treeId,
  });
}

function readPeers(): void {
  if (!session) return;
  const aw = session.provider.awareness;
  const peers: CollabPeer[] = [];
  aw.getStates().forEach((s, id) => {
    if (id === aw.clientID) return;
    const u = (s as { user?: Partial<CollabPeer> }).user;
    if (!u) return;
    const color = Math.trunc(Number(u.color));
    peers.push({
      id,
      name: (typeof u.name === 'string' ? u.name : 'Someone').slice(0, 40),
      color: Number.isFinite(color) ? ((color % COLORS) + COLORS) % COLORS : 0,
      selectedId: typeof u.selectedId === 'string' ? u.selectedId : null,
      treeId: typeof u.treeId === 'string' ? u.treeId : '',
    });
  });
  state.collabPeers = peers.sort((a, b) => a.id - b.id);
}

function syncFlags(): void {
  if (!session) return;
  state.canUndo = session.undo.undoStack.length > 0;
  state.canRedo = session.undo.redoStack.length > 0;
}

/** Apply what others changed (or an undo) to the editor. */
function pull(origin: unknown): void {
  const s = session;
  if (!s) return;
  let read: Forest | null;
  try {
    pruneStrays(s.doc, PRUNE_ORIGIN);
    read = readForest(s.doc);
  } catch (err) {
    // A peer's change this can't read: keep what is open rather than fail on every update.
    console.warn('Could not read the shared forest', err);
    return;
  }
  if (!read) return;
  // Kit CSS generated from rules follows this browser's breakpoints; it is never shared (see `sharable`).
  const next = withCurrentBreakpoints(read);
  // Nothing visible changed (e.g. only tidying): keep the forest as it is.
  if (state.forest && state.forest.id === next.id && diffForests(state.forest, next).empty) {
    s.synced = state.forest;
    return;
  }
  s.synced = next;
  commit(next, true, origin === s.undo ? { source: 'editor', label: lastUndoAction } : { source: 'collab' });
}

/** Write a change made here into the shared document. */
function push(forest: Forest | null): void {
  const s = session;
  // While joining, the forest open here is not the shared one; nothing to send.
  if (!s || !s.synced || !forest || forest === s.synced) return;
  if (forest.id !== s.synced?.id) {
    // Another forest was opened: this one is no longer shared from here.
    stopSharing(`Stopped sharing “${s.synced?.name ?? 'the forest'}”`);
    return;
  }
  writeForest(s.doc, sharable(s.synced), sharable(forest), LOCAL_ORIGIN);
  s.synced = forest;
}

/**
 * The forest as shared: an editable kit's CSS is generated from its rules with each browser's own
 * breakpoints, so only the rules are shared and each browser makes its own CSS. Kept by object
 * identity per forest, so unchanged forests compare equal node for node.
 */
const sharableCache = new WeakMap<Forest, Forest>();
function sharable(forest: Forest): Forest {
  let out = sharableCache.get(forest);
  if (!out) {
    out = forest.kits.some(isEditableKit) ? { ...forest, kits: forest.kits.map((k) => (isEditableKit(k) ? { ...k, css: '' } : k)) } : forest;
    sharableCache.set(forest, out);
  }
  return out;
}

function connect(room: CollabRoom, doc: Y.Doc, synced: Forest | null): Session {
  const provider = new WebrtcProvider(room.room, doc, {
    signaling: COLLAB_SIGNALING,
    password: room.key,
    ...(COLLAB_ICE_SERVERS.length ? { peerOpts: { config: { iceServers: COLLAB_ICE_SERVERS } } } : {}),
  });
  const undo = new Y.UndoManager(sharedTypes(doc), { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 400 });
  const s: Session = { room, doc, provider, undo, synced, stop: [] };
  // Updates arrive in transactions; read the result once per batch.
  let pending: unknown = undefined;
  let scheduled = false;
  const onUpdate = (_u: Uint8Array, origin: unknown) => {
    if (origin === LOCAL_ORIGIN || origin === PRUNE_ORIGIN) return;
    pending = origin;
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (session === s && hasForest(doc)) {
        if (state.collabStatus === 'joining') void openShared(s);
        else pull(pending);
      }
    });
  };
  doc.on('update', onUpdate);
  s.stop.push(() => doc.off('update', onUpdate));
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const onAnyUpdate = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveRoom(s), 250);
  };
  doc.on('update', onAnyUpdate);
  s.stop.push(() => {
    doc.off('update', onAnyUpdate);
    clearTimeout(saveTimer);
    void saveRoom(s);
  });
  undo.on('stack-item-added', syncFlags);
  undo.on('stack-item-popped', syncFlags);
  provider.awareness.on('change', readPeers);
  provider.on('peers', () => readPeers());
  s.stop.push(onChange('forest', (f) => push(f)));
  s.stop.push(onChange('selectedId', publishPresence));
  s.stop.push(onChange('treeId', publishPresence));
  return s;
}

async function openShared(s: Session): Promise<void> {
  if (s.opening) return;
  s.opening = true;
  try {
    // Save local edits first, while still joining (remote updates wait meanwhile), so that what
    // the room holds is read and opened in one go, after the last await.
    while (state.saveState !== 'saved' && state.forest) {
      if (!(await saveNow())) {
        // The open forest couldn't be saved, so it stays open; sharing it would mix the two forests.
        if (session === s) stopSharing('Could not join: the open forest’s changes could not be saved');
        return;
      }
    }
    if (session !== s) return;
    const read = readForest(s.doc);
    if (!read) return;
    const forest = withCurrentBreakpoints(read);
    // This device may already hold the forest (an earlier join, edits made after leaving, or the
    // same file imported): keep that copy as a version before the room's replaces it.
    const local = state.forest?.id === forest.id ? state.forest : await loadStoredForest(forest.id);
    if (session !== s) return;
    if (local && !diffForests(local, forest).empty) await saveForestVersion(local, 'Before joining the shared forest', { source: 'collab', auto: true });
    if (session !== s) return;
    const latest = readForest(s.doc);
    if (!latest) return;
    const current = withCurrentBreakpoints(latest);
    s.synced = current;
    state.collabStatus = 'live';
    // Everything is saved, so this opens the forest without waiting.
    await openDocument({ kind: 'forest', forest: current });
    finishJoin(s, current);
  } catch (err) {
    if (session === s) stopSharing(`Could not join: ${(err as Error).message}`);
  } finally {
    s.opening = false;
  }
}

function finishJoin(s: Session, forest: Forest): void {
  installHistory(s);
  // The "waiting" dialog has done its job.
  if (state.dialog === 'share') state.dialog = null;
  toast(`Joined “${forest.name}”`, 'success');
}

function installHistory(s: Session): void {
  setHistoryOverride({
    undo: () => {
      lastUndoAction = 'Undo';
      s.undo.undo();
    },
    redo: () => {
      lastUndoAction = 'Redo';
      s.undo.redo();
    },
    flags: syncFlags,
  });
  syncFlags();
  publishPresence();
}

/** Share the open forest: start a room and return its link. */
export function startSharing(): string | null {
  if (!COLLAB_ENABLED || isEmbedded()) return null;
  if (session) return state.collabLink;
  const forest = state.forest;
  if (!forest) return null;
  const room = newRoom();
  const doc = new Y.Doc();
  writeForest(doc, null, sharable(forest), 'setup');
  session = connect(room, doc, forest);
  state.collabLink = shareLink(room);
  state.collabStatus = 'live';
  installHistory(session);
  void saveRoom(session);
  // The link in the address bar too, so a reload rejoins the room.
  history.replaceState(history.state, '', state.collabLink);
  return state.collabLink;
}

/** Leave the room. The forest stays open and saved here. */
export function stopSharing(message = 'Stopped sharing'): void {
  const s = session;
  if (!s) return;
  session = null;
  s.stop.forEach((off) => off());
  s.undo.destroy();
  s.provider.destroy();
  s.doc.destroy();
  setHistoryOverride(null);
  state.collabStatus = 'off';
  state.collabLink = '';
  state.collabPeers = [];
  // Take this room's link out of the address bar (but not another room's, when following a new link).
  if (parseRoomHash(location.hash)?.room === s.room.room) {
    const url = new URL(location.href);
    url.hash = url.hash.replace(/(^#|&)collab=[^&]*/, '$1').replace(/^#&?$/, '');
    history.replaceState(history.state, '', url.href);
  }
  toast(message);
}

/** Join the room in the address bar (`#collab=`), if any. Call once the editor has started. */
export function startCollab(): void {
  state.collabName = myName();
  state.collabColor = Math.floor(Math.random() * COLORS);
  let joining = '';
  const join = async () => {
    const room = parseRoomHash(location.hash);
    if (!room || !COLLAB_ENABLED || isEmbedded()) return;
    if (session?.room.room === room.room || joining === room.room) return;
    if (session) stopSharing();
    joining = room.room;
    state.collabStatus = 'joining';
    state.collabLink = shareLink(room);
    const doc = new Y.Doc();
    // Rejoining: start from what this device kept, so the forest opens at once (even with nobody else online).
    await loadRoom(room, doc);
    // Another link was followed meanwhile: that join wins.
    if (joining !== room.room) {
      doc.destroy();
      return;
    }
    joining = '';
    if (session) stopSharing();
    session = connect(room, doc, null);
    if (hasForest(doc)) await openShared(session);
    else state.dialog = 'share';
  };
  void join();
  window.addEventListener('hashchange', () => void join());
  // Best effort: IndexedDB writes may not finish while a page unloads, which is why saves are frequent.
  window.addEventListener('beforeunload', () => {
    if (session) void saveRoom(session);
    session?.provider.destroy();
  });
}
