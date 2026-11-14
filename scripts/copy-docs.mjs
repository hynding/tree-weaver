#!/usr/bin/env node
// Copy guides from docs/ into a package's dist so a published package can serve them.
//   node ../../scripts/copy-docs.mjs dist/docs format.md shorthand.md
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [dest, ...names] = process.argv.slice(2);
mkdirSync(dest, { recursive: true });
for (const name of names) copyFileSync(new URL(`../docs/${name}`, import.meta.url), join(dest, name));
