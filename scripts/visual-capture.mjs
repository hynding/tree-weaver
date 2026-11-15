#!/usr/bin/env node
/**
 * Visual regression, step 1: render every sample tree at every display size and save a
 * full-page screenshot plus the box of every branch.
 *
 *   node scripts/visual-capture.mjs <out-dir> [--root <repo>]
 *
 * Samples: the examples, the tree templates, every tree of every starter forest (when the repo
 * has them) and one page holding all the blueprints. `--root` points at another checkout whose
 * packages are built (`pnpm build:packages`), so CI can capture the pull request's base with the
 * pull request's script. Remote images are replaced with a fixed placeholder and scripts are
 * off, so two captures of the same document are identical. Compare two captures with
 * `scripts/visual-diff.mjs`. Needs Playwright with Chromium (TW_CHROMIUM_PATH to use another).
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const root = rootFlag >= 0 ? resolve(args.splice(rootFlag, 2)[1]) : here;
const out = resolve(args[0] ?? join(here, 'visual', 'current'));

const load = (pkg) => import(pathToFileURL(join(root, 'packages', pkg, 'dist', 'index.js')).href);
const [core, formats, branches, kits] = await Promise.all(['core', 'formats', 'branches', 'kits'].map(load));
const { PNG } = createRequire(import.meta.url)('pngjs');
const { chromium } = createRequire(import.meta.url)('playwright');

const basic = kits.createStarterKit();
/** @type {{ key: string, tree: any, kits: any[] }[]} */
const samples = [];
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';

for (const file of readdirSync(join(root, 'examples')).sort()) {
  if (!/\.(tree|forest)\.json$/.test(file)) continue;
  const doc = formats.importJson(readFileSync(join(root, 'examples', file), 'utf8'));
  const base = `example-${slug(file.replace(/\.(tree|forest)\.json$/, ''))}`;
  if (doc.kind === 'tree') samples.push({ key: base, tree: doc.tree, kits: doc.kits });
  else doc.forest.trees.forEach((tree) => samples.push({ key: `${base}/${slug(tree.name)}`, tree, kits: doc.forest.kits }));
}
for (const t of branches.TEMPLATES) samples.push({ key: `template-${t.id}`, tree: t.create(t.label), kits: [basic] });
for (const s of branches.STARTERS ?? []) {
  const forest = s.create();
  for (const tree of forest.trees) samples.push({ key: `starter-${s.id}/${slug(tree.name)}`, tree, kits: forest.kits });
}
const blueprints = branches.BLUEPRINTS.filter((b) => b.category !== 'SVG').map((b) => b.create());
samples.push({ key: 'blueprints', tree: core.createTree('All blueprints', core.createBranch({ tag: 'body', type: 'root', name: 'Body', children: blueprints })), kits: [basic] });

// A plain grey picture for every image, so remote images can't change or slow a capture.
const placeholder = new PNG({ width: 16, height: 9 });
placeholder.data.fill(0xc8);
const placeholderPng = PNG.sync.write(placeholder);

/**
 * Every branch's box, keyed by its position in the tree (`0.2.1`), with its tag and name. Ids
 * are no use here: starters and templates make new ids every time.
 */
const BOXES_SCRIPT = `(() => {
  const out = [];
  const visit = (el, path) => {
    let i = 0;
    for (const child of el.children) {
      if (child.hasAttribute('data-tw')) {
        const p = path ? path + '.' + i : String(i);
        const r = child.getBoundingClientRect();
        out.push({ path: p, tag: child.tagName.toLowerCase(), name: child.getAttribute('data-tw-name') || '', x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) });
        visit(child, p);
        i++;
      } else visit(child, path);
    }
  };
  visit(document.body, '');
  return out;
})()`;

const FREEZE_CSS = '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }';

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const executablePath = process.env.TW_CHROMIUM_PATH || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const manifest = { displays: core.DISPLAYS.map((d) => ({ id: d.id, label: d.label, width: d.width, height: d.height })), samples: [] };
try {
  for (const s of samples) {
    // No animations, transitions or blinking carets. (addStyleTag needs scripts, which are off.)
    const html = core.renderDocument(s.tree, { kits: s.kits }).replace('</head>', `<style>${FREEZE_CSS}</style>\n</head>`);
    const dir = join(out, s.key);
    mkdirSync(dir, { recursive: true });
    const entry = { key: s.key, name: s.tree.name, displays: {} };
    for (const d of core.DISPLAYS) {
      const page = await browser.newPage({ viewport: { width: d.width, height: d.height }, javaScriptEnabled: false, deviceScaleFactor: 1, reducedMotion: 'reduce' });
      await page.route(/^https?:/, (route) =>
        route.request().resourceType() === 'image' ? route.fulfill({ status: 200, contentType: 'image/png', body: placeholderPng }) : route.abort(),
      );
      await page.setContent(html, { waitUntil: 'load', timeout: 15000 }).catch(() => undefined);
      const boxes = await page.evaluate(BOXES_SCRIPT);
      await page.screenshot({ path: join(dir, `${d.id}.png`), fullPage: true, animations: 'disabled' });
      writeFileSync(join(dir, `${d.id}.boxes.json`), JSON.stringify(boxes));
      entry.displays[d.id] = { boxes: boxes.length };
      await page.close();
    }
    manifest.samples.push(entry);
  }
} finally {
  await browser.close();
}
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Captured ${samples.length} samples at ${core.DISPLAYS.length} displays into ${out}`);
