# The Tree Weaver MCP server

`@tree-weaver/mcp` lets any [MCP](https://modelcontextprotocol.io) client (Claude Code, Claude
Desktop, Cursor, VS Code, ChatGPT and others) build and edit Tree Weaver layouts directly: create a
tree, patch it, validate it, render it and look at it on every display, without glue code.

It runs locally over stdio and works on files in one folder, its **workspace**.

## Add it to a client

Claude Code:

```sh
claude mcp add tree-weaver -- npx -y @tree-weaver/mcp --root .
```

Claude Desktop, Cursor, Windsurf and most other clients (`mcpServers` in their JSON config):

```json
{
  "mcpServers": {
    "tree-weaver": { "command": "npx", "args": ["-y", "@tree-weaver/mcp", "--root", "/path/to/site"] }
  }
}
```

VS Code (`.vscode/mcp.json`):

```json
{
  "servers": {
    "tree-weaver": { "type": "stdio", "command": "npx", "args": ["-y", "@tree-weaver/mcp", "--root", "${workspaceFolder}"] }
  }
}
```

Options:

| Option | Meaning |
| --- | --- |
| `--root <dir>` | The workspace: the only folder the tools may read and write. Default: the current directory (or `TW_MCP_ROOT`). |
| `--read-only` | Never write files; tools return documents in their results instead. |

Screenshots need Playwright next to the server (`npm i playwright && npx playwright install chromium`),
or set `TW_CHROMIUM_PATH` to a Chrome or Chromium binary. Every other tool works without it.

## Tools

| Tool | What it does |
| --- | --- |
| `create_tree` | Start a tree from a template (`landing`, `dashboard`, `article`, `drawing`, `blank`) or from [shorthand](shorthand.md), with the Weaver Basic starter kit. Writes `path` (never overwrites unless `overwrite: true`) or returns the document. The result includes the outline. |
| `outline` | Every branch and leaf with its path (`/1/0`) and id (`#b_…`). |
| `patch_tree` | Apply [patch operations](patch.md) in order, all or nothing: `insert`, `replace`, `remove`, `move`, `duplicate`, `wrap`, `update`, `setStyles`, `setText`. Nodes may be shorthand. Writes the file back, or returns the result for an inline `document`. `dryRun` describes the changes without writing. |
| `validate` | The strict check, with a path and a fix hint for every problem. |
| `render_html` | A standalone HTML page with kits and responsive CSS inlined. |
| `export_component` | A tree as a React, Vue or Svelte component, or HTML with CSS files, styled with a CSS file or Tailwind classes. Returns every file, or writes them into `outputDir`. See [exporting components](export.md). |
| `convert` | Between JSON, YAML, XML, HTML, Markdown and SVG. |
| `screenshot` | A PNG per display (default `lg`, `tablet`, `mobile-portrait`) from headless Chromium, with page height and a warning when content overflows sideways. Scripts are disabled while rendering. |
| `catalog` | Blueprints, templates, displays or formats. |
| `kit_manifest` | Classes, tokens and media queries of `.css` files or a document's kits. |

Tools that read a document take either `path` (a workspace file) or `document` (its text), so an
agent can also work without files. Failures come back as tool errors with a message that says what
to fix, and a failed patch changes nothing.

## Resources and prompts

| URI | Content |
| --- | --- |
| `tree-weaver://schema/document` | JSON Schema for documents |
| `tree-weaver://schema/patch` | JSON Schema for patches |
| `tree-weaver://guide/format` | [Format guide](format.md) |
| `tree-weaver://guide/shorthand` | [Shorthand guide](shorthand.md) |
| `tree-weaver://guide/patch` | [Patch guide](patch.md) |
| `tree-weaver://guide/export` | [Component export guide](export.md) |
| `tree-weaver://catalog/blueprints`, `…/templates` | The building blocks, as JSON |

The `build_layout` prompt takes a brief and walks the model through create, refine, validate and
screenshot.

## Safety

- Every path is resolved inside the workspace; `..`, absolute paths and symlinks that lead outside
  it are refused.
- `create_tree` won't replace an existing file unless asked; `--read-only` turns off writes entirely.
- Rendering goes through the same sanitizing as the editor (no scripts, event handlers or
  `javascript:` URLs), and screenshots run with JavaScript disabled.

## From code

```ts
import { createServer } from '@tree-weaver/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

await createServer({ root: './site' }).connect(new StdioServerTransport());
```

`createServer` returns an `McpServer` from the official SDK, so any transport works.
