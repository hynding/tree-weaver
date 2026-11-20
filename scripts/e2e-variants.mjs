#!/usr/bin/env node
/**
 * Browser check for breakpoint-aware component exports. For a component with several
 * variants (one named "Base" to test the reserved modifier), it renders many instances in
 * Chromium at every display size two ways: as the editor does (expandComponent +
 * renderTreeCss) and as the exported Svelte component does (variantClasses + its CSS), and
 * fails when any computed style differs. Needs Playwright with Chromium (set TW_CHROMIUM_PATH
 * to use another Chrome binary). Run after `pnpm build:packages`.
 *
 *   pnpm e2e:variants
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../packages', import.meta.url));
const core = await import(`${root}/core/dist/index.js`);
const formats = await import(`${root}/formats/dist/index.js`);
const { chromium } = createRequire(import.meta.url)('playwright');
const { createBranch, createComponent, text, expandComponent, renderTreeCss, renderNodeHtml, DISPLAYS } = core;

const t = createBranch({ tag: 'h3', styles: { lg: { margin: '0', 'font-size': '20px' }, tablet: { color: 'rgb(0, 0, 255)' } }, children: [text('Title')] }); t.id = 'b_t';
const p = createBranch({ tag: 'p', styles: { lg: { padding: '4px' } }, children: [text('Body')] }); p.id = 'b_p';
const r = createBranch({ tag: 'article', styles: { lg: { display: 'flex', gap: '16px' }, 'mobile-portrait': { gap: '2px' } }, children: [t, p] }); r.id = 'b_r';
const def = createComponent('Card', r, { variants: [
  { name: 'Stacked', styles: { b_r: { lg: { 'flex-direction': 'column' }, 'mobile-portrait': { gap: '4px' } }, b_t: { lg: { 'font-size': '14px' } } } },
  { name: 'Wide', styles: { b_r: { lg: { gap: '40px' }, tablet: { 'flex-direction': 'row-reverse' } }, b_p: { lg: { padding: '20px' }, xl: { padding: '30px' } }, b_t: { tablet: { color: 'rgb(255, 0, 0)' } } } },
  { name: 'Base', styles: { b_t: { 'mobile-landscape': { 'font-size': '9px' } } } },
]});
const names = ['Stacked', 'Wide', 'Base'];
const slug = { Stacked: 'stacked', Wide: 'wide', Base: 'base-2' };
const ids = DISPLAYS.map((d) => d.id);
// Every variant on its own, then random picks per display (unset, '-' or a variant).
const combos = [{}];
const choices = [undefined, '-', ...names];
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (const n of names) combos.push({ lg: n });
for (let i = 0; i < 60; i++) { const c = {}; for (const d of ids) { const v = choices[Math.floor(rnd() * choices.length)]; if (v !== undefined) c[d] = v; } combos.push(c); }

const svelte = formats.exportComponentDef(def, { framework: 'svelte' }).files[0].contents;
const fnSrc = svelte.slice(svelte.indexOf('const VARIANT_DISPLAYS'), svelte.indexOf('</script>'));
const variantClasses = new Function(`${fnSrc}; return variantClasses;`)();
const exportCss = svelte.slice(svelte.indexOf('<style>') + 7, svelte.indexOf('</style>')).replace(/:global\(([^)]*)\)/g, '$1');
const markupTpl = svelte.slice(svelte.indexOf('</script>') + 9, svelte.indexOf('<style>')).trim();

const browser = await chromium.launch(process.env.TW_CHROMIUM_PATH ? { executablePath: process.env.TW_CHROMIUM_PATH } : {});
const page = await browser.newPage();
const props = ['display', 'flex-direction', 'gap', 'font-size', 'color', 'padding', 'margin'];
let fails = 0, checks = 0;
for (const combo of combos) {
  const editorPicks = Object.fromEntries(Object.entries(combo));
  const exportPicks = Object.fromEntries(Object.entries(combo).map(([d, v]) => [d, v === '-' ? '-' : slug[v]]));
  const expanded = expandComponent(def, { component: def.id, variants: editorPicks }, 'b_i');
  const a = `<style>body{margin:0}${renderTreeCss(expanded)}</style>${renderNodeHtml(expanded)}`;
  const isEmpty = !Object.keys(exportPicks).length;
  const b = `<style>body{margin:0}${exportCss}</style>${markupTpl.replace('{variantClasses(variant)}', variantClasses(isEmpty ? '' : exportPicks))}`;
  for (const d of DISPLAYS) {
    await page.setViewportSize({ width: d.width, height: d.height });
    const read = async (html) => { await page.setContent(html); return page.evaluate((props) => [...document.querySelectorAll('article, article *')].map((e) => props.map((p) => getComputedStyle(e).getPropertyValue(p)).join('|')), props); };
    const ra = await read(a), rb = await read(b);
    checks++;
    if (JSON.stringify(ra) !== JSON.stringify(rb)) { fails++; if (fails < 6) console.log('MISMATCH', d.id, JSON.stringify(combo), '\n editor', ra, '\n export', rb); }
  }
}
await browser.close();
console.log(`Variant exports: ${checks} display checks, ${fails} mismatches with the editor.`);
if (fails) process.exit(1);
