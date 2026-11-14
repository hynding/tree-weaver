#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server';

const HELP = `tree-weaver-mcp: the Tree Weaver MCP server (stdio)

Usage: tree-weaver-mcp [--root <dir>] [--read-only]

  --root <dir>   Folder the tools may read and write (default: the current directory)
  --read-only    Never write files; tools return documents instead
  -v, --version  Print the version

Add it to an MCP client, e.g. { "command": "npx", "args": ["-y", "@tree-weaver/mcp", "--root", "."] }.
`;

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    'read-only': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
  strict: true,
});

const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

if (values.help) process.stdout.write(HELP);
else if (values.version) process.stdout.write(`${version}\n`);
else {
  const root = values.root ?? process.env.TW_MCP_ROOT ?? process.cwd();
  const server = createServer({ root, readOnly: !!values['read-only'], version });
  await server.connect(new StdioServerTransport());
  process.stderr.write(`tree-weaver-mcp ${version}: serving ${root}${values['read-only'] ? ' (read-only)' : ''}\n`);
}
