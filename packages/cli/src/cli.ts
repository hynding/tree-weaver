#!/usr/bin/env node
import { run } from './run';

run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`tree-weaver: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
