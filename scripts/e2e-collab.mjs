#!/usr/bin/env node
/**
 * Browser check for live collaboration. Serves the built editor (apps/web/www), starts a local
 * y-webrtc signaling server, and opens the editor in two separate browser contexts (so they can
 * only meet over WebRTC): one shares its forest, the other joins with the link, both edit, and
 * each sees the other's changes, presence, and undo of only its own change. Needs Playwright
 * with Chromium (set TW_CHROMIUM_PATH to use another Chrome binary). Run after `pnpm build`.
 *
 *   pnpm e2e:collab
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const www = join(repo, 'apps/web/www');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const PORT = 4821;
const SIGNAL_PORT = 4822;

const server = await new Promise((resolve) => {
  const s = createServer(async (req, res) => {
    const raw = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const path = raw.endsWith('/') ? `${raw}index.html` : raw;
    try {
      const body = await readFile(join(www, normalize(path)));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  s.listen(PORT, () => resolve(s));
});

const signaling = spawn(process.execPath, [join(repo, 'apps/web/node_modules/y-webrtc/bin/server.js')], { env: { ...process.env, PORT: String(SIGNAL_PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

let playwright;
try {
  playwright = await import('playwright');
} catch {
  playwright = createRequire(import.meta.url)('playwright');
}
const executablePath = process.env.TW_CHROMIUM_PATH || undefined;
// Let WebRTC use plain local addresses between the two contexts.
const browser = await playwright.chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
const check = (ok, label) => {
  if (!ok) throw new Error(`FAILED: ${label}`);
  console.log(`ok - ${label}`);
};

async function editor() {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: process.env.SHOT ? 2 : 1 });
  await context.addInitScript((url) => (globalThis.__TW_COLLAB_SIGNALING__ = [url]), `ws://localhost:${SIGNAL_PORT}`);
  const page = await context.newPage();
  if (process.env.DEBUG) page.on('console', (m) => console.log('console:', m.text()));
  return page;
}

const canvasText = (page) => page.frameLocator('tw-canvas iframe').locator('body').innerText();

try {
  const a = await editor();
  await a.goto(`http://localhost:${PORT}/`);
  await a.waitForSelector('tw-canvas');
  await a.click('button:has-text("Share")');
  await a.click('button:has-text("Start sharing")');
  const link = await a.inputValue('#share-link');
  check(/#collab=tw-[0-9a-z]+\.[0-9a-z]+$/.test(link), 'sharing gives a #collab= link with the room key in the fragment');
  check(a.url().includes('#collab='), 'the sharer’s address bar holds the link, so a reload rejoins');
  await a.click('button:has-text("Done")');

  const b = await editor();
  await b.goto(link);
  await b.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Joined/.test(t.textContent)), null, { timeout: 30000 });
  check(true, 'a second browser joins with the link and gets the forest');
  check((await canvasText(b)).includes('Weave layouts that fit every screen'), 'the joined forest shows on the canvas');
  check(await b.isDisabled('button[aria-label="Undo"]'), 'joining adds nothing to undo');

  // Presence.
  await a.waitForFunction(() => /Live · 2/.test(document.querySelector('tw-toolbar')?.textContent ?? ''), null, { timeout: 15000 });
  check(true, 'each side sees the other in the toolbar');

  const hasFooter = (page) => page.evaluate(() => !!document.querySelector('tw-canvas iframe')?.contentDocument?.querySelector('footer'));
  const waitFooter = (page, present) =>
    page.waitForFunction((want) => (document.querySelector('tw-canvas iframe')?.contentDocument?.body.innerText ?? '').includes('Made with Tree Weaver') === want, present, { timeout: 15000 });

  // A deletes the footer; B sees it go.
  await a.frameLocator('tw-canvas iframe').getByText('Made with Tree Weaver').click();
  await a.keyboard.press('Delete');
  await waitFooter(a, false);
  await waitFooter(b, false);
  check(true, 'an edit in one browser shows up in the other');

  // B renames the forest; A sees it.
  await b.fill('#forest-name', 'Shared site');
  await b.press('#forest-name', 'Enter');
  await a.waitForFunction(() => document.querySelector('#forest-name')?.value === 'Shared site', null, { timeout: 15000 });
  check(true, 'edits from both sides merge');

  // Undo in A takes back only A's change (the delete), not B's rename.
  await a.click('button[aria-label="Undo"]');
  await waitFooter(a, true);
  await waitFooter(b, true);
  const names = await Promise.all([a, b].map((p) => p.inputValue('#forest-name')));
  check(names.every((n) => n === 'Shared site'), 'undo takes back only your own change, for everyone');
  void hasFooter;

  // History tab labels B's change as a collaborator's.
  await a.click('#tab-history');
  const historyText = await a.textContent('tw-history-panel');
  check(/Collaborator/.test(historyText), 'the History tab shows collaborators’ changes');

  // B's selection shows on A's canvas.
  await b.frameLocator('tw-canvas iframe').locator('h1').first().click();
  await a.waitForFunction(() => !!document.querySelector('tw-canvas iframe')?.contentDocument?.querySelector('[data-tw-peer]'), null, { timeout: 15000 });
  check(true, 'what a collaborator selects is outlined on your canvas');
  // SHOT=<dir> saves screenshots of the sharer's editor and Share dialog.
  if (process.env.SHOT) {
    await a.screenshot({ path: join(process.env.SHOT, 'collab-canvas.png') });
    await a.click('button:has-text("Live")');
    await a.screenshot({ path: join(process.env.SHOT, 'collab-share-dialog.png') });
    await a.click('button:has-text("Done")');
  }

  // B reloads and rejoins from what it kept, then A stops sharing.
  await b.reload();
  await b.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Joined/.test(t.textContent)), null, { timeout: 30000 });
  check(true, 'a reload rejoins the room');
  await a.click('button:has-text("Live")');
  await a.click('button:has-text("Stop sharing")');
  check(!a.url().includes('collab='), 'stopping removes the link from the address bar');
} finally {
  await browser.close();
  server.close();
  signaling.kill();
}
