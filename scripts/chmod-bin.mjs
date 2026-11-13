#!/usr/bin/env node
// Mark CLI entry points executable after `tsc` writes them (tsc keeps the shebang but not the mode).
import { chmodSync } from 'node:fs';
for (const file of process.argv.slice(2)) chmodSync(file, 0o755);
