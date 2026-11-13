/*
 * Tree Weaver: serves Storybooks uploaded in the Storybook import.
 *
 * The files live in IndexedDB (written by src/utils/storybook-upload.ts). Requests under
 * `<scope>__storybook__/<id>/` are answered from there, so an uploaded Storybook runs on the
 * editor's own origin and its rendered stories can be read. Every other request is left alone.
 */
const DB_NAME = 'tree-weaver-storybook-files';
const STORE = 'files';
const PREFIX = '__storybook__/';

const TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  cjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  txt: 'text/plain; charset=utf-8',
  mp4: 'video/mp4',
  webm: 'video/webm',
  wasm: 'application/wasm',
};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' && request.method !== 'HEAD') return;
  const url = new URL(request.url);
  const root = new URL(PREFIX, self.registration.scope);
  if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) return;
  event.respondWith(serve(url.pathname.slice(root.pathname.length)));
});

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'path' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function read(path) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(path);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function serve(rawPath) {
  let path;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    return new Response('Bad path', { status: 400 });
  }
  if (path === '' || path.endsWith('/')) path += 'index.html';
  let record = await read(path);
  // `<id>/` with no file: the Storybook's manager page.
  if (!record && !path.split('/').pop().includes('.')) record = await read(`${path}/index.html`);
  if (!record) return new Response('Not found in the uploaded Storybook', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const ext = path.split('.').pop().toLowerCase();
  return new Response(record.data, {
    headers: {
      'Content-Type': TYPES[ext] || record.type || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    },
  });
}
