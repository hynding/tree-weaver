#!/usr/bin/env node
/**
 * Visual regression, step 2: compare two captures from `scripts/visual-capture.mjs`.
 *
 *   node scripts/visual-diff.mjs <before-dir> <after-dir> <report-dir> [--summary <file.md>]
 *
 * For every sample and display it compares the screenshots pixel by pixel and the branch boxes
 * by position in the tree, and writes `<report-dir>/index.html` (before, after and a diff image
 * for everything that changed, with the branches that moved or resized) and `report.json`.
 * `--summary` also writes a Markdown summary (CI appends it to the job summary).
 *
 * Exits 1 when anything changed, unless VISUAL_CHANGES_APPROVED=true. New and removed samples
 * are listed but don't count as changes.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const pixelmatch = (await import('pixelmatch')).default;

const args = process.argv.slice(2);
const summaryFlag = args.indexOf('--summary');
const summaryFile = summaryFlag >= 0 ? resolve(args.splice(summaryFlag, 2)[1]) : null;
const [beforeDir, afterDir, reportDir] = args.map((a) => resolve(a));
if (!beforeDir || !afterDir || !reportDir) {
  console.error('Usage: visual-diff.mjs <before-dir> <after-dir> <report-dir> [--summary <file.md>]');
  process.exit(2);
}

/** Share of differing pixels below which a screenshot counts as unchanged (anti-aliasing noise). */
const PIXEL_TOLERANCE = 0.0001;
/** Box changes smaller than this (px) are rounding. */
const BOX_TOLERANCE = 1;

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const before = readJson(join(beforeDir, 'manifest.json'));
const after = readJson(join(afterDir, 'manifest.json'));
const beforeKeys = new Map(before.samples.map((s) => [s.key, s]));
const afterKeys = new Map(after.samples.map((s) => [s.key, s]));
const displays = after.displays;

/** Pad an image to a size with a magenta background, so different heights still compare. */
function padded(png, width, height) {
  if (png.width === width && png.height === height) return png;
  const out = new PNG({ width, height });
  for (let i = 0; i < out.data.length; i += 4) out.data.set([255, 0, 255, 255], i);
  PNG.bitblt(png, out, 0, 0, png.width, png.height, 0, 0);
  return out;
}

function compareBoxes(a, b) {
  const byPath = new Map(a.map((x) => [x.path, x]));
  const seen = new Set();
  const changes = [];
  const label = (x) => `${x.name || `<${x.tag}>`} (${x.path})`;
  for (const n of b) {
    const o = byPath.get(n.path);
    seen.add(n.path);
    if (!o) {
      changes.push({ kind: 'added', label: label(n), after: n });
      continue;
    }
    if (o.tag !== n.tag) {
      changes.push({ kind: 'replaced', label: `${label(o)} → <${n.tag}>`, before: o, after: n });
      continue;
    }
    const moved = Math.abs(o.x - n.x) > BOX_TOLERANCE || Math.abs(o.y - n.y) > BOX_TOLERANCE;
    const resized = Math.abs(o.w - n.w) > BOX_TOLERANCE || Math.abs(o.h - n.h) > BOX_TOLERANCE;
    if (moved || resized) changes.push({ kind: resized ? (moved ? 'moved and resized' : 'resized') : 'moved', label: label(n), before: o, after: n });
  }
  for (const o of a) if (!seen.has(o.path)) changes.push({ kind: 'removed', label: label(o), before: o });
  // Causes first: what was added, removed or resized usually pushes everything after it.
  const rank = { added: 0, removed: 0, replaced: 0, resized: 1, 'moved and resized': 1, moved: 2 };
  return changes.sort((x, y) => rank[x.kind] - rank[y.kind]);
}

rmSync(reportDir, { recursive: true, force: true });
mkdirSync(reportDir, { recursive: true });
const results = [];
for (const s of after.samples) {
  const prev = beforeKeys.get(s.key);
  if (!prev) continue;
  for (const d of displays) {
    const aPng = join(beforeDir, s.key, `${d.id}.png`);
    const bPng = join(afterDir, s.key, `${d.id}.png`);
    if (!existsSync(aPng) || !existsSync(bPng)) continue;
    const a = PNG.sync.read(readFileSync(aPng));
    const b = PNG.sync.read(readFileSync(bPng));
    const width = Math.max(a.width, b.width);
    const height = Math.max(a.height, b.height);
    const diff = new PNG({ width, height });
    const pixels = pixelmatch(padded(a, width, height).data, padded(b, width, height).data, diff.data, width, height, { threshold: 0.1 });
    const share = pixels / (width * height);
    const boxes = compareBoxes(readJson(join(beforeDir, s.key, `${d.id}.boxes.json`)), readJson(join(afterDir, s.key, `${d.id}.boxes.json`)));
    const sizeChanged = a.width !== b.width || a.height !== b.height;
    const changed = share > PIXEL_TOLERANCE || boxes.length > 0 || sizeChanged;
    const result = { key: s.key, name: s.name, display: d.id, label: d.label, pixels, share, before: { width: a.width, height: a.height }, after: { width: b.width, height: b.height }, boxes, changed };
    if (changed) {
      const dir = join(reportDir, s.key);
      mkdirSync(dir, { recursive: true });
      copyFileSync(aPng, join(dir, `${d.id}.before.png`));
      copyFileSync(bPng, join(dir, `${d.id}.after.png`));
      writeFileSync(join(dir, `${d.id}.diff.png`), PNG.sync.write(diff));
    }
    results.push(result);
  }
}
const added = after.samples.filter((s) => !beforeKeys.has(s.key)).map((s) => s.key);
const removed = before.samples.filter((s) => !afterKeys.has(s.key)).map((s) => s.key);
const changed = results.filter((r) => r.changed);
writeFileSync(join(reportDir, 'report.json'), `${JSON.stringify({ compared: results.length, changed, added, removed }, null, 2)}\n`);

/* ------------------------------------------------------------------ report */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pct = (share) => `${(share * 100).toFixed(share < 0.01 ? 3 : 1)}%`;
const BOX_LIMIT = 12;
const boxList = (r) =>
  r.boxes.length
    ? `<ul>${r.boxes
        .slice(0, BOX_LIMIT)
        .map((c) => `<li><b>${esc(c.kind)}</b> ${esc(c.label)}${c.before && c.after ? ` <span class="m">${c.before.w}×${c.before.h} at ${c.before.x},${c.before.y} → ${c.after.w}×${c.after.h} at ${c.after.x},${c.after.y}</span>` : ''}</li>`)
        .join('')}${r.boxes.length > BOX_LIMIT ? `<li>…and ${r.boxes.length - BOX_LIMIT} more</li>` : ''}</ul>`
    : '<p class="m">No branch moved or resized; only pixels changed (color, text, borders).</p>';
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visual changes</title>
<style>
body { font: 14px/1.5 system-ui, sans-serif; margin: 0; padding: 24px; color: #1f2328; background: #f6f8fa; }
h1 { margin: 0 0 8px; } h2 { margin: 32px 0 8px; font-size: 18px; } .m { color: #59636e; }
section { background: #fff; border: 1px solid #d1d9e0; border-radius: 10px; padding: 16px; margin: 16px 0; }
.shots { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: start; }
.shots figure { margin: 0; } .shots img { width: 100%; border: 1px solid #d1d9e0; background: #fff; }
figcaption { font-weight: 600; margin-bottom: 4px; }
@media (max-width: 800px) { .shots { grid-template-columns: 1fr; } }
</style></head><body>
<h1>Visual changes</h1>
<p class="m">${changed.length} of ${results.length} screenshots changed.${added.length ? ` New samples: ${esc(added.join(', '))}.` : ''}${removed.length ? ` Removed: ${esc(removed.join(', '))}.` : ''} The diff marks changed pixels in red; magenta is where one page is taller than the other.</p>
${changed
  .map(
    (r) => `<section><h2>${esc(r.key)} · ${esc(r.label)}</h2>
<p class="m">${pct(r.share)} of pixels changed · page ${r.before.width}×${r.before.height} → ${r.after.width}×${r.after.height}</p>
${boxList(r)}
<div class="shots">${['before', 'after', 'diff'].map((k) => `<figure><figcaption>${k[0].toUpperCase()}${k.slice(1)}</figcaption><a href="${esc(r.key)}/${r.display}.${k}.png"><img loading="lazy" src="${esc(r.key)}/${r.display}.${k}.png" alt="${k} ${esc(r.key)} ${esc(r.label)}"></a></figure>`).join('')}</div>
</section>`,
  )
  .join('\n')}
</body></html>
`;
writeFileSync(join(reportDir, 'index.html'), html);

const lines = [];
if (!changed.length) lines.push(`### Visual regression: no changes`, ``, `${results.length} screenshots (${after.samples.length} samples × ${displays.length} displays) look the same as the base.`);
else {
  lines.push(`### Visual regression: ${changed.length} screenshot${changed.length === 1 ? '' : 's'} changed`, ``, `| Sample | Display | Pixels | Page size | Branches |`, `| --- | --- | --- | --- | --- |`);
  for (const r of changed) {
    const size = r.before.height === r.after.height && r.before.width === r.after.width ? `${r.after.width}×${r.after.height}` : `${r.before.width}×${r.before.height} → ${r.after.width}×${r.after.height}`;
    const branches = r.boxes.length ? r.boxes.slice(0, 3).map((c) => `${c.kind}: ${c.label}`).join('; ') + (r.boxes.length > 3 ? `; +${r.boxes.length - 3} more` : '') : 'none moved';
    lines.push(`| ${r.key} | ${r.label} | ${pct(r.share)} | ${size} | ${branches.replace(/\|/g, '\\|')} |`);
  }
  lines.push(``, `Download the **visual-report** artifact and open \`index.html\` for before, after and diff images.`);
}
if (added.length) lines.push(``, `New samples (no baseline): ${added.join(', ')}`);
if (removed.length) lines.push(``, `Removed samples: ${removed.join(', ')}`);
const summary = `${lines.join('\n')}\n`;
if (summaryFile) writeFileSync(summaryFile, summary);
console.log(summary);

const approved = process.env.VISUAL_CHANGES_APPROVED === 'true';
if (changed.length && !approved) {
  console.error(`${changed.length} screenshots changed. If the changes are intended, add the "visual-change" label to the pull request.`);
  process.exit(1);
}
if (changed.length) console.log('The changes are approved (visual-change label).');
