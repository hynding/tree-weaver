#!/usr/bin/env node
/**
 * Check the packages the way npm users get them: pack every package, install the
 * tarballs into an empty project, then use them from plain Node and run the CLI.
 * Run after `pnpm build:packages`.
 *
 *   pnpm smoke
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = new URL('..', import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), 'tree-weaver-smoke-'));
const packs = join(work, 'packs');
const app = join(work, 'app');
const sh = (cmd, args, cwd = app) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

console.log(`Packing into ${packs}`);
execFileSync('pnpm', ['-r', '--filter', './packages/**', 'pack', '--pack-destination', packs], { cwd: repo, stdio: 'inherit' });

const tarballs = {};
for (const file of readdirSync(packs)) {
  const name = file.startsWith('tree-weaver-') && !/^tree-weaver-\d/.test(file) ? `@tree-weaver/${file.replace(/^tree-weaver-(.+)-\d+\.\d+\.\d+.*\.tgz$/, '$1')}` : 'tree-weaver';
  tarballs[name] = `file:${join(packs, file)}`;
}
console.log(tarballs);

execFileSync('mkdir', ['-p', app]);
writeFileSync(
  join(app, 'package.json'),
  JSON.stringify({ name: 'smoke', private: true, type: 'module', dependencies: { 'tree-weaver': tarballs['tree-weaver'] }, overrides: tarballs }, null, 2),
);
sh('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error']);

writeFileSync(
  join(app, 'use.mjs'),
  `import { createTree, validateDocument, exportTree, getBlueprint, kitManifest, createStarterKit, insertNode } from 'tree-weaver';
import { importDocument } from '@tree-weaver/formats';
import { MemoryForestStore } from 'tree-weaver/storage';
let tree = createTree('Smoke');
tree = { ...tree, root: insertNode(tree.root, tree.root.id, getBlueprint('hero').create()) };
const json = exportTree(tree, 'json', [createStarterKit()]);
const result = validateDocument(JSON.parse(json));
if (!result.valid) throw new Error('invalid');
if (importDocument(json).kind !== 'tree') throw new Error('round trip');
if (!exportTree(tree, 'html').includes('<!doctype html>')) throw new Error('html');
if (!kitManifest([createStarterKit()]).classes.includes('container')) throw new Error('kit');
if (typeof MemoryForestStore !== 'function') throw new Error('storage');
console.log('library ok');
`,
);
console.log(sh('node', ['use.mjs']).trim());

const bin = join(app, 'node_modules', '.bin', 'tree-weaver');
sh(bin, ['new', 'home.tree.json', '--template', 'landing']);
sh(bin, ['add', 'home.tree.json', 'card', '--parent', '/1']);
console.log(sh(bin, ['validate', 'home.tree.json', join(repo, 'examples', 'site.forest.json')]).trim());
sh(bin, ['render', 'home.tree.json', '-o', 'home.html']);
if (!readFileSync(join(app, 'home.html'), 'utf8').startsWith('<!doctype html>')) throw new Error('render');
console.log(`cli ok (tree-weaver ${sh(bin, ['--version']).trim()})`);
