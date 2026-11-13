import { slugify, unzip } from '@tree-weaver/formats';

/**
 * Uploaded Storybooks: the files of a `storybook-static` folder or zip are kept in IndexedDB
 * and served to the story iframe on this site's own origin by a small service worker
 * (`storybook-sw.js`), at `<app>/__storybook__/<id>/...`. Being on the same origin is what
 * lets Tree Weaver read the rendered stories. The service worker only answers requests
 * under `__storybook__/`; everything else goes to the network as usual.
 */

/** Must match `storybook-sw.js`. */
const DB_NAME = 'tree-weaver-storybook-files';
const STORE = 'files';
const PREFIX = '__storybook__/';

export interface UploadedFile {
  /** Path inside the upload, with `/` separators. */
  path: string;
  data: Blob;
}

interface FileRecord {
  /** `<id>/<path inside the Storybook>`. */
  path: string;
  type: string;
  data: Blob;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'path' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Saving the Storybook was cancelled'));
  });

/** The folder the app is served from, e.g. `https://hynding.github.io/tree-weaver/`. */
const appBase = (): URL => new URL('./', location.href);

/** Whether this browser can serve an uploaded Storybook (service workers need HTTPS or localhost). */
export const canUploadStorybook = (): boolean => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && window.isSecureContext && typeof indexedDB !== 'undefined';

let registering: Promise<void> | null = null;

/** Register the service worker that serves uploaded Storybooks, and wait until it is running. */
export function ensureStorybookWorker(): Promise<void> {
  registering ??= (async () => {
    if (!canUploadStorybook()) throw new Error('This browser can’t serve an uploaded Storybook (it needs service workers over HTTPS)');
    const base = appBase();
    const reg = await navigator.serviceWorker.register(new URL('storybook-sw.js', base).href, { scope: base.pathname });
    const worker = reg.active ?? reg.waiting ?? reg.installing;
    if (worker && worker.state !== 'activated') {
      await new Promise<void>((resolve) => {
        const check = () => worker.state === 'activated' && resolve();
        worker.addEventListener('statechange', check);
        check();
      });
    }
  })().catch((err) => {
    registering = null;
    throw err;
  });
  return registering;
}

/** The Storybook's root inside an upload: the folder that holds `iframe.html`. */
export function storybookRoot(paths: string[]): string {
  const candidates = paths.filter((p) => /(^|\/)iframe\.html$/.test(p)).map((p) => p.slice(0, -'iframe.html'.length));
  if (!candidates.length) throw new Error('This isn’t a built Storybook: there is no iframe.html. Upload the storybook-static folder (from `storybook build`).');
  // The shallowest one, in case the Storybook bundles other pages.
  return candidates.sort((a, b) => a.split('/').length - b.split('/').length)[0];
}

/** Store an uploaded Storybook and return the URL it is served from. Uploading the same name again replaces it. */
export async function saveUploadedStorybook(name: string, files: UploadedFile[]): Promise<string> {
  const root = storybookRoot(files.map((f) => f.path));
  const id = slugify(name, 'storybook');
  await ensureStorybookWorker();
  await removeUploadedStorybook(id);
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const f of files) {
      if (!f.path.startsWith(root)) continue;
      const rel = f.path.slice(root.length);
      if (!rel || rel.split('/').some((part) => part === '..')) continue;
      const record: FileRecord = { path: `${id}/${rel}`, type: f.data.type, data: f.data };
      store.put(record);
    }
    await done(tx);
  } finally {
    db.close();
  }
  return new URL(`${PREFIX}${encodeURIComponent(id)}/`, appBase()).href;
}

/** Delete an uploaded Storybook's files, by its id or the URL it's served from. */
export async function removeUploadedStorybook(idOrUrl: string): Promise<void> {
  const marker = `/${PREFIX}`;
  const id = idOrUrl.includes(marker) ? decodeURIComponent(idOrUrl.split(marker)[1].split('/')[0]) : idOrUrl;
  if (!id || typeof indexedDB === 'undefined') return;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(IDBKeyRange.bound(`${id}/`, `${id}/￿`));
    await done(tx);
  } finally {
    db.close();
  }
}

/** Inflate raw DEFLATE data with the browser's own decompressor. */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw' as CompressionFormat));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Files from a zip archive. */
export async function filesFromZip(file: File): Promise<UploadedFile[]> {
  const entries = await unzip(new Uint8Array(await file.arrayBuffer()), inflateRaw);
  return entries.filter((e) => !e.path.startsWith('__MACOSX/')).map((e) => ({ path: e.path, data: new Blob([e.data as BlobPart]) }));
}

/** Files picked with a folder input (`webkitdirectory`). */
export const filesFromInput = (list: FileList): UploadedFile[] =>
  Array.from(list).map((f) => ({ path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, data: f }));

/** Files from a folder dropped onto the page. */
export async function filesFromDrop(items: DataTransferItemList): Promise<{ files: UploadedFile[]; zip?: File }> {
  const entries = Array.from(items)
    .map((i) => (i.kind === 'file' ? i.webkitGetAsEntry?.() : null))
    .filter((e): e is FileSystemEntry => !!e);
  const single = entries.length === 1 ? entries[0] : null;
  if (single?.isFile && /\.zip$/i.test(single.name)) {
    const zip = await new Promise<File>((resolve, reject) => (single as FileSystemFileEntry).file(resolve, reject));
    return { files: [], zip };
  }
  const files: UploadedFile[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      files.push({ path: `${prefix}${entry.name}`, data: file });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns a batch at a time; keep reading until it returns none.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
    }
  };
  for (const entry of entries) await walk(entry, '');
  return { files };
}
