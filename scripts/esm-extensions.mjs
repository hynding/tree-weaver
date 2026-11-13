#!/usr/bin/env node
/**
 * Add file extensions to relative imports in a package's compiled output, so the
 * dist runs in plain Node (which needs `./model.js`, not `./model`) as well as in
 * bundlers. The sources keep extensionless imports (`moduleResolution: Bundler`).
 *
 *   node scripts/esm-extensions.mjs packages/core/dist
 *
 * Rewrites `.js` and `.d.ts` files in place. `./x` becomes `./x.js` when `x.js`
 * exists, or `./x/index.js` when `x` is a folder with an `index.js`; anything
 * else is left as it is.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bexport\s*\*\s*from\s*)(['"])(\.{1,2}\/[^'"]*)\2/g;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(js|d\.ts)$/.test(name) ? [path] : [];
  });
}

function withExtension(file, spec) {
  if (/\.(m?js|json)$/.test(spec)) return spec;
  const base = resolve(dirname(file), spec);
  if (existsSync(`${base}.js`)) return `${spec}.js`;
  if (existsSync(join(base, 'index.js'))) return `${spec.replace(/\/$/, '')}/index.js`;
  // Not a file in dist: most likely an import inside generated code (a template
  // string such as a Storybook story). Leave it alone; the Node smoke test catches
  // a real import that fails to resolve.
  return spec;
}

export function fixDir(dir) {
  let changed = 0;
  for (const file of files(dir)) {
    const source = readFileSync(file, 'utf8');
    const next = source.replace(SPECIFIER, (_m, lead, quote, spec) => `${lead}${quote}${withExtension(file, spec)}${quote}`);
    if (next !== source) {
      writeFileSync(file, next);
      changed++;
    }
  }
  return changed;
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('usage: esm-extensions.mjs <dist-dir>...');
  process.exit(2);
}
for (const dir of dirs) fixDir(resolve(dir));
