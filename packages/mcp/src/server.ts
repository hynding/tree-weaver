import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { DISPLAY_IDS, TREE_WEAVER_PATCH_SCHEMA, TREE_WEAVER_SCHEMA } from '@tree-weaver/core';
import { FORMATS, type FormatId } from '@tree-weaver/formats';
import { BLUEPRINTS, TEMPLATES } from '@tree-weaver/branches';
import { Tools, ToolError, type ToolOutput } from './tools';
import { Workspace } from './workspace';

export interface ServerOptions {
  /** Folder the tools may read and write (default: the current directory). */
  root?: string;
  /** Refuse every write; tools return documents instead. */
  readOnly?: boolean;
  /** Reported to clients. */
  version?: string;
}

export const INSTRUCTIONS = `Tree Weaver builds responsive web layouts as JSON trees. A forest (project) holds trees (layouts);
a tree is made of branches (HTML or SVG elements with classes, attributes, per-display styles and children)
and leaves (text, images, SVG shapes). Styles are keyed by display: "lg" is the base, and "xl", "tablet",
"mobile-landscape", "mobile-portrait" hold only overrides (phones inherit tablet).

Workflow: create_tree (from a template or compact shorthand) -> outline (paths like /1/0 and ids) ->
patch_tree (small edits by path or id; nodes may be shorthand such as "h2: Pricing" or "@card") ->
validate -> screenshot (see each display) or render_html, and export_component to hand the layout to a
React, Vue or Svelte codebase. Prefer the design kit's classes
(kit_manifest) over inline styles. Read tree-weaver://guide/shorthand and tree-weaver://guide/patch
for the full syntax. File paths are relative to the server's workspace folder.`;

const FORMAT_IDS = FORMATS.map((f) => f.id) as [FormatId, ...FormatId[]];
const DISPLAY_ENUM = DISPLAY_IDS as unknown as [string, ...string[]];

const source = {
  path: z.string().optional().describe('A file in the workspace (.json, .yaml, .xml, .html, .md or .svg)'),
  document: z.string().optional().describe('The document text itself, instead of a path'),
  format: z.enum(FORMAT_IDS).optional().describe('Input format, when the extension or content does not make it clear'),
};
const treeRef = z.string().optional().describe('Which tree of a forest: id, name or 1-based number (default: the first)');
const output = z.string().optional().describe('Write the result to this workspace file instead of returning it');

function toResult(out: ToolOutput): CallToolResult {
  const content: CallToolResult['content'] = [{ type: 'text', text: out.text }];
  for (const img of out.images ?? []) {
    content.push({ type: 'text', text: img.label });
    content.push({ type: 'image', data: img.data, mimeType: img.mimeType });
  }
  // Big documents are already in the text; keep the structured copy small.
  const data = out.data && 'document' in out.data ? { ...out.data, document: undefined } : out.data;
  return data ? { content, structuredContent: JSON.parse(JSON.stringify(data)) as Record<string, unknown> } : { content };
}

function wrap<A>(fn: (args: A) => ToolOutput | Promise<ToolOutput>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return toResult(await fn(args));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: err instanceof ToolError ? message : `Error: ${message}` }], isError: true };
    }
  };
}

async function readDoc(name: string): Promise<string> {
  // Built package: dist/docs/<name>. In the repository: ../../../docs/<name>.
  for (const url of [new URL(`./docs/${name}`, import.meta.url), new URL(`../../../docs/${name}`, import.meta.url)]) {
    try {
      return await readFile(url, 'utf8');
    } catch {
      // try the next place
    }
  }
  return `See https://github.com/hynding/tree-weaver/blob/main/docs/${name}`;
}

/** An MCP server with Tree Weaver's tools, resources and prompts. Connect it to any transport. */
export function createServer(options: ServerOptions = {}): McpServer {
  const ws = new Workspace(options.root ?? process.cwd(), options.readOnly);
  const tools = new Tools(ws);
  const server = new McpServer({ name: 'tree-weaver', title: 'Tree Weaver', version: options.version ?? '0.1.0' }, { instructions: INSTRUCTIONS });
  const writes = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  const reads = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    'create_tree',
    {
      title: 'Create a tree',
      description:
        'Start a tree from a template or from compact shorthand, with the Weaver Basic starter kit. Writes it to "path" (refuses to overwrite unless "overwrite" is true), or returns it. The result includes the outline with paths and ids.',
      inputSchema: {
        path: z.string().optional().describe('Workspace file to write, e.g. "home.tree.json" (the extension picks the format)'),
        template: z.enum(TEMPLATES.map((t) => t.id) as [string, ...string[]]).optional().describe('Template to start from (default "blank")'),
        shorthand: z
          .union([z.string(), z.array(z.unknown()), z.record(z.string(), z.unknown())])
          .optional()
          .describe('A shorthand document instead of a template: a list of page nodes, e.g. ["h1: Hello", {"grid": 3, "children": ["@card", "@card", "@card"]}], or {"tree": {"name": ..., "root": [...]}}. JSON/YAML text also works'),
        name: z.string().optional().describe('Name of the tree (and forest)'),
        forest: z.boolean().optional().describe('Wrap the tree in a forest'),
        starterKit: z.boolean().optional().describe('Include the Weaver Basic design kit (default true)'),
        format: z.enum(FORMAT_IDS).optional().describe('Output format when there is no path or extension (default json)'),
        overwrite: z.boolean().optional().describe('Replace an existing file'),
      },
      annotations: { ...writes, title: 'Create a tree' },
    },
    wrap((args) => tools.createTree(args)),
  );

  server.registerTool(
    'outline',
    {
      title: 'Outline a tree',
      description: 'List every branch and leaf of a tree with its path (/1/0) and id (#b_...). Use these as "target" and "parent" in patch_tree.',
      inputSchema: { ...source, tree: treeRef },
      annotations: { ...reads, title: 'Outline a tree' },
    },
    wrap((args) => tools.outline(args)),
  );

  server.registerTool(
    'patch_tree',
    {
      title: 'Edit a tree',
      description:
        'Apply operations to a tree, in order, all or nothing: insert, replace, remove, move, duplicate, wrap, update, setStyles, setText. Nodes may be shorthand. Targets are paths ("/1/0") or ids. Writes the file back (or to "output"); with "document" it returns the result. Example ops: [{"op":"insert","parent":"/1","node":"h2: Pricing"},{"op":"setStyles","target":"/1","styles":{"padding":"4rem 0","tablet":{"padding":"2rem 0"}}},{"op":"setText","target":"/0/0","value":"Welcome"}]. Schema: tree-weaver://schema/patch.',
      inputSchema: {
        ...source,
        ops: z.union([z.array(z.record(z.string(), z.unknown())), z.string()]).describe('The operations, as a list (or its JSON/YAML text)'),
        tree: treeRef,
        dryRun: z.boolean().optional().describe('Check and describe the changes without writing'),
        output,
      },
      annotations: { ...writes, title: 'Edit a tree' },
    },
    wrap((args) => tools.patchTree(args)),
  );

  server.registerTool(
    'validate',
    {
      title: 'Validate a document',
      description: 'Strictly check a forest or tree. Every problem comes with a path and a fix hint. JSON and YAML are checked as written; other formats are imported first.',
      inputSchema: { ...source, strict: z.boolean().optional().describe('Count warnings as errors') },
      annotations: { ...reads, title: 'Validate a document' },
    },
    wrap((args) => tools.validate(args)),
  );

  server.registerTool(
    'render_html',
    {
      title: 'Render HTML',
      description: 'Render a tree as a standalone HTML page with its design kits and responsive CSS inlined. Returns the HTML, or writes it to "output".',
      inputSchema: { ...source, tree: treeRef, output, kits: z.array(z.string()).optional().describe('Extra .css files in the workspace to add as design kits') },
      annotations: { ...writes, readOnlyHint: false, title: 'Render HTML' },
    },
    wrap((args) => tools.renderHtml(args)),
  );

  server.registerTool(
    'export_component',
    {
      title: 'Export a component',
      description:
        'Turn a tree into source code for a codebase: a React (.jsx/.tsx), Vue or Svelte component, or an HTML page with CSS files. Styles become a CSS file with readable class names, or Tailwind classes with displays as responsive variants; design kits go to kits.css. Returns every file, or writes them into "outputDir".',
      inputSchema: {
        ...source,
        framework: z.enum(['react', 'vue', 'svelte', 'html']).describe('What to write'),
        styling: z.enum(['css', 'tailwind']).optional().describe('css (default): a stylesheet with generated classes; tailwind: utility classes'),
        tree: treeRef,
        name: z.string().optional().describe('Component name (default: from the tree name, in PascalCase)'),
        typescript: z.boolean().optional().describe('React only: write .tsx'),
        outputDir: z.string().optional().describe('Workspace folder to write the files into, instead of returning them'),
        kits: z.array(z.string()).optional().describe('Extra .css files in the workspace to add as design kits'),
      },
      annotations: { ...writes, readOnlyHint: false, title: 'Export a component' },
    },
    wrap((args) => tools.exportComponent(args)),
  );

  server.registerTool(
    'convert',
    {
      title: 'Convert a document',
      description: 'Convert between json, yaml, xml, html, markdown and svg. Forests stay forests in json, yaml and xml; the other formats take one tree.',
      inputSchema: { ...source, to: z.enum(FORMAT_IDS).describe('Format to write'), tree: treeRef, output },
      annotations: { ...writes, title: 'Convert a document' },
    },
    wrap((args) => tools.convert(args)),
  );

  server.registerTool(
    'screenshot',
    {
      title: 'Screenshot a tree',
      description:
        'Render a tree in headless Chromium and return a PNG per display, plus page height and sideways overflow. Use it to check responsive layouts. Default displays: lg, tablet, mobile-portrait. Needs Playwright installed next to the server.',
      inputSchema: {
        ...source,
        tree: treeRef,
        displays: z.array(z.enum(DISPLAY_ENUM)).optional().describe(`Displays to capture: ${DISPLAY_IDS.join(', ')}`),
        fullPage: z.boolean().optional().describe('Capture the whole page, not just the first screen (default true)'),
        kits: z.array(z.string()).optional().describe('Extra .css files in the workspace to add as design kits'),
      },
      annotations: { ...reads, title: 'Screenshot a tree' },
    },
    wrap((args) => tools.screenshot(args as Parameters<Tools['screenshot']>[0])),
  );

  server.registerTool(
    'catalog',
    {
      title: 'List building blocks',
      description: 'List the blueprints (ready-made branches such as card, hero, grid-3, table), tree templates, displays or file formats.',
      inputSchema: { kind: z.enum(['blueprints', 'templates', 'displays', 'formats']).describe('What to list') },
      annotations: { ...reads, title: 'List building blocks' },
    },
    wrap((args) => tools.catalog(args)),
  );

  server.registerTool(
    'kit_manifest',
    {
      title: 'List design kit classes',
      description: 'List the classes, design tokens and media queries of .css files, or of the design kits inside documents. Use these classes instead of inventing inline styles.',
      inputSchema: { paths: z.array(z.string()).min(1).describe('.css files or documents in the workspace') },
      annotations: { ...reads, title: 'List design kit classes' },
    },
    wrap((args) => tools.kitManifest(args)),
  );

  /* ------------------------------------------------------------ resources */

  const json = (value: unknown) => JSON.stringify(value, null, 2);
  const resources: { name: string; uri: string; title: string; description: string; mimeType: string; read: () => Promise<string> | string }[] = [
    { name: 'document-schema', uri: 'tree-weaver://schema/document', title: 'Document JSON Schema', description: 'Draft 2020-12 schema for forests, trees, branches, leaves and kits', mimeType: 'application/schema+json', read: () => json(TREE_WEAVER_SCHEMA) },
    { name: 'patch-schema', uri: 'tree-weaver://schema/patch', title: 'Patch JSON Schema', description: 'Schema for patch_tree operations', mimeType: 'application/schema+json', read: () => json(TREE_WEAVER_PATCH_SCHEMA) },
    { name: 'format-guide', uri: 'tree-weaver://guide/format', title: 'Format guide', description: 'The model, displays and cascade, layout recipes, kits, validation', mimeType: 'text/markdown', read: () => readDoc('format.md') },
    { name: 'shorthand-guide', uri: 'tree-weaver://guide/shorthand', title: 'Shorthand guide', description: 'Compact authoring syntax for nodes and documents', mimeType: 'text/markdown', read: () => readDoc('shorthand.md') },
    { name: 'patch-guide', uri: 'tree-weaver://guide/patch', title: 'Patch guide', description: 'Every patch operation with examples', mimeType: 'text/markdown', read: () => readDoc('patch.md') },
    { name: 'export-guide', uri: 'tree-weaver://guide/export', title: 'Component export guide', description: 'React, Vue, Svelte and HTML exports, class naming and Tailwind display variants', mimeType: 'text/markdown', read: () => readDoc('export.md') },
    { name: 'blueprints', uri: 'tree-weaver://catalog/blueprints', title: 'Blueprints', description: 'Ready-made branches', mimeType: 'application/json', read: () => json(BLUEPRINTS.map(({ id, label, category, description }) => ({ id, label, category, description }))) },
    { name: 'templates', uri: 'tree-weaver://catalog/templates', title: 'Templates', description: 'Tree templates for create_tree', mimeType: 'application/json', read: () => json(TEMPLATES.map(({ id, label, description }) => ({ id, label, description }))) },
  ];
  for (const r of resources) {
    server.registerResource(r.name, r.uri, { title: r.title, description: r.description, mimeType: r.mimeType }, async (uri) => ({
      contents: [{ uri: uri.href, mimeType: r.mimeType, text: await r.read() }],
    }));
  }

  /* -------------------------------------------------------------- prompts */

  server.registerPrompt(
    'build_layout',
    {
      title: 'Build a layout',
      description: 'Plan and build a responsive page as a Tree Weaver tree, checking it on every display.',
      argsSchema: { brief: z.string().describe('What the page is for and what it should contain'), path: z.string().optional().describe('File to write (default page.tree.json)') },
    },
    ({ brief, path }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Build this page with the Tree Weaver tools: ${brief}

1. Read tree-weaver://guide/shorthand, then call create_tree with "path": "${path ?? 'page.tree.json'}" and a shorthand list of sections (use blueprints such as "@navbar", "@hero", {"grid": 3, ...}, "@footer").
2. Call kit_manifest on the file and prefer its classes.
3. Refine with patch_tree (setText, setStyles with tablet / mobile-portrait overrides, insert).
4. Run validate and fix every error.
5. Call screenshot and fix anything that overflows or looks wrong on a display, then summarize.`,
          },
        },
      ],
    }),
  );

  return server;
}
