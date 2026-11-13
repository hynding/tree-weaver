#!/usr/bin/env node
// npm only packs a LICENSE that sits in the package folder; copy the repository's one in before packing.
import { copyFileSync } from 'node:fs';
copyFileSync(new URL('../LICENSE', import.meta.url), 'LICENSE');
