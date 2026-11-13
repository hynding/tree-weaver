#!/usr/bin/env node
/**
 * Give every published package the same version, so they release together.
 *
 *   pnpm release:version 0.2.0
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  console.error('usage: pnpm release:version <x.y.z>');
  process.exit(2);
}
const root = new URL('../packages/', import.meta.url).pathname;
for (const dir of readdirSync(root)) {
  const file = join(root, dir, 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  if (pkg.private) continue;
  pkg.version = version;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`${pkg.name}@${version}`);
}
