#!/usr/bin/env node
/**
 * Browser check for the embeddable editor. Serves the built editor (apps/web/www) and a
 * host page on two different origins, then drives <tree-weaver-editor> in Chromium:
 * ready, load, getDocument, change events, the src attribute, ?src= and #doc= links, and
 * that a page on a third origin gets nothing back. Needs Playwright with Chromium
 * (set TW_CHROMIUM_PATH to use another Chrome binary). Run after `pnpm build`.
 *
 *   pnpm e2e:embed
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const repo = new URL('..', import.meta.url).pathname;
const www = join(repo, 'apps/web/www');
const examples = join(repo, 'examples');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

function serve(port, handler) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const raw = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const path = raw.endsWith('/') ? `${raw}index.html` : raw;
      try {
        const { body, type } = await handler(path);
        res.writeHead(200, { 'content-type': type ?? TYPES[extname(path)] ?? 'application/octet-stream', 'access-control-allow-origin': '*' });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    });
    server.listen(port, () => resolve(server));
  });
}

const EDITOR = 'http://localhost:4811';
const HOST_PAGES = {
  '/index.html': `<!doctype html><script type="module" src="${EDITOR}/embed.js"></script>
<tree-weaver-editor id="ed" editor="${EDITOR}/"></tree-weaver-editor>
<script type="module">window.changes = []; const ed = document.getElementById('ed');
ed.addEventListener('change', (e) => window.changes.push(e.detail)); ed.addEventListener('ready', () => (window.readyFired = true));</script>`,
  '/src.html': `<!doctype html><script type="module" src="${EDITOR}/embed.js"></script>
<tree-weaver-editor id="ed" editor="${EDITOR}/" src="logo.tree.json"></tree-weaver-editor>`,
  '/hostile.html': `<!doctype html><iframe id="f" src="${EDITOR}/?embed=1&origin=http://localhost:4812"></iframe>
<script>window.got = []; addEventListener('message', (e) => window.got.push(e.data));</script>`,
};

const host = (path) => (HOST_PAGES[path] ? { body: HOST_PAGES[path], type: 'text/html' } : readFile(join(examples, normalize(path))).then((body) => ({ body })));
const servers = await Promise.all([serve(4811, (p) => readFile(join(www, normalize(p))).then((body) => ({ body }))), serve(4812, host), serve(4813, host)]);

let playwright;
try {
  playwright = await import('playwright');
} catch {
  playwright = createRequire(import.meta.url)('playwright');
}
const executablePath = process.env.TW_CHROMIUM_PATH || undefined;
const browser = await playwright.chromium.launch(executablePath ? { executablePath } : {});
const check = (ok, label) => {
  if (!ok) throw new Error(`FAILED: ${label}`);
  console.log(`ok - ${label}`);
};

try {
  const page = await browser.newPage();
  if (process.env.DEBUG) {
    page.on('console', (m) => console.log('console:', m.text()));
    page.on('response', (r) => r.status() >= 400 && console.log('http', r.status(), r.url()));
  }
  await page.goto('http://localhost:4812/');
  await page.waitForFunction(() => window.readyFired === true, null, { timeout: 20000 });
  check(true, 'the element reports ready');
  const pricing = await readFile(join(examples, 'pricing-table.tree.json'), 'utf8');
  const loaded = await page.evaluate((d) => document.getElementById('ed').load(d), pricing);
  check(loaded.kind === 'tree' && loaded.trees === 1, 'load() opens a tree');
  const yaml = await page.evaluate(() => document.getElementById('ed').getDocument({ format: 'yaml', scope: 'tree' }));
  check(/^format: tree-weaver/m.test(yaml), 'getDocument() returns YAML');
  const forest = await page.evaluate(() => document.getElementById('ed').getForest());
  check(forest.trees[0].name === 'Pricing table', 'getForest() returns the forest');
  const bad = await page.evaluate(() => document.getElementById('ed').load('{"tree": 5}').then(() => null, (e) => e.message));
  check(typeof bad === 'string' && bad.length > 0, 'a bad document rejects with a message');
  await page.evaluate(() => document.getElementById('ed').load({ tree: { name: 'Edit me', root: { tag: 'body', children: ['Hello'] } } }));
  await page.waitForFunction(() => window.changes.some((c) => c.forest.trees[0]?.name === 'Edit me'), null, { timeout: 5000 });
  check(true, 'change events reach the host');

  await page.goto('http://localhost:4812/src.html');
  const names = await page.evaluate(async () => {
    const ed = document.getElementById('ed');
    await ed.ready;
    return (await ed.getForest()).trees.map((t) => t.name);
  });
  check(names.join() === 'Logo', 'the src attribute opens a document');

  await page.goto(`${EDITOR}/?src=${encodeURIComponent('http://localhost:4812/minimal.tree.json')}`);
  await page.waitForSelector('.toast', { timeout: 15000 });
  check(/Added tree/.test(await page.textContent('.toast')) && !page.url().includes('src='), '?src= adds the tree and cleans the URL');

  const doc = Buffer.from(JSON.stringify({ tree: { name: 'From hash', root: { tag: 'body', children: ['Hi'] } } })).toString('base64url');
  await page.goto(`${EDITOR}/#doc=${doc}`);
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /From hash/.test(t.textContent)), null, { timeout: 15000 });
  check(!page.url().includes('doc='), '#doc= opens the packed document and cleans the URL');

  await page.goto('http://localhost:4813/hostile.html');
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.getElementById('f').contentWindow.postMessage({ source: 'tree-weaver-host', id: 'x', type: 'getDocument' }, '*'));
  await page.waitForTimeout(1500);
  const got = await page.evaluate(() => window.got.map((m) => m.type));
  check(got.join() === 'ready', 'a page on another origin gets only "ready"');
} finally {
  await browser.close();
  servers.forEach((s) => s.close());
}
