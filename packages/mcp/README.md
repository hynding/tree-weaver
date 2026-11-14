# @tree-weaver/mcp

An [MCP](https://modelcontextprotocol.io) server that lets AI agents create, patch, validate, render
and screenshot [Tree Weaver](https://github.com/hynding/tree-weaver) layouts.

```sh
claude mcp add tree-weaver -- npx -y @tree-weaver/mcp --root .
```

```json
{ "mcpServers": { "tree-weaver": { "command": "npx", "args": ["-y", "@tree-weaver/mcp", "--root", "/path/to/site"] } } }
```

Tools: `create_tree`, `outline`, `patch_tree`, `validate`, `render_html`, `convert`, `screenshot`,
`catalog`, `kit_manifest`. Resources: the document and patch JSON Schemas and the format, shorthand
and patch guides. Prompt: `build_layout`.

The tools only touch files inside `--root`. Screenshots need Playwright (`npm i playwright`).

Full guide: [docs/mcp.md](https://github.com/hynding/tree-weaver/blob/main/docs/mcp.md).
