import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import {
  applyPatch,
  idsOutside,
  insertionProblem,
  instanceRoleIn,
  saveComponent,
  findComponent,
  instantiateComponent,
  insertNode,
  componentProps,
  isDisplayId,
  type Forest,
  type ComponentInstance,
  resetToken,
  setToken,
  themeTokens,
  TOKEN_KINDS,
  type TokenKind,
  canHaveChildren,
  checkRendered,
  checkTree,
  DISPLAY_IDS,
  formatCheckReport,
  createForest,
  formatIssues,
  isBranch,
  now,
  PatchError,
  pathOf,
  replaceTree,
  resolveRef,
  TREE_WEAVER_PATCH_SCHEMA,
  addVersion,
  findVersion,
  formatDiff,
  parseVersionLog,
  removeVersion,
  stringifyVersionLog,
  versionLogPath,
  type ChangeSource,
  type VersionLog,
  TREE_WEAVER_SCHEMA,
  TreeDataError,
  validateDocument,
  type Branch,
  type CheckBrowser,
  type CheckReport,
  type DesignKit,
  type DisplayId,
  type Tree,
  type TreeNode,
  type ValidationResult,
} from '@tree-weaver/core';
import {
  COMPONENT_FRAMEWORKS,
  isNativeFramework,
  exportFlutterTokens,
  exportSwiftUITokens,
  tailwindPreset,
  tailwindThemeCss,
  tokensJson,
  diffDocuments,
  detectFormat,
  exportComponent,
  exportComponentDef,
  exportForest,
  exportTree,
  FORMATS,
  FormatError,
  formatFromFileName,
  getFormat,
  importDocument,
  parseData,
  toEnvelope,
  validateText,
  type ComponentFramework,
  type FormatId,
  type TreeDocument,
} from '@tree-weaver/formats';
import { createStarterKit, kitFromFile, kitManifest } from '@tree-weaver/kits';
import { BLUEPRINTS, expandShorthand, expandShorthandDocument, getBlueprint, getStarter, getTemplate, STARTERS, TEMPLATES } from '@tree-weaver/branches';

/** Where the CLI reads and writes. Swap it out to drive the CLI from code or tests. */
export interface CliIO {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  readStdin(): Promise<string>;
  stdout(text: string): void;
  stderr(text: string): void;
  /** Start a browser for `lint --render`. Default: Chromium through Playwright, when installed. */
  launchBrowser?(): Promise<CheckBrowser & { close(): Promise<void> }>;
}

/** Chromium through Playwright, an optional dependency. TW_CHROMIUM_PATH points at another Chrome. */
async function launchChromium(): Promise<CheckBrowser & { close(): Promise<void> }> {
  type Launcher = { chromium: { launch(o: object): Promise<CheckBrowser & { close(): Promise<void> }> } };
  let pw: Launcher | undefined;
  try {
    pw = (await import('playwright' as string)) as Launcher;
  } catch {
    try {
      pw = createRequire(import.meta.url)('playwright') as Launcher;
    } catch {
      throw new Error('--render needs Playwright: run "npm i -D playwright" and "npx playwright install chromium", or leave out --render');
    }
  }
  const executablePath = process.env.TW_CHROMIUM_PATH || undefined;
  return pw.chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
}

const nodeIO: CliIO = {
  readFile: (path) => readFile(path, 'utf8'),
  async writeFile(path, data) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, 'utf8');
  },
  async readStdin() {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  },
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
};

/** A mistake in how the CLI was called. Exits with code 2. */
class UsageError extends Error {}

const FORMAT_IDS = FORMATS.map((f) => f.id);

/** The hosted editor. */
const EDITOR_URL = 'https://hynding.github.io/tree-weaver/';

const HELP = `tree-weaver: create, check, edit and render Tree Weaver forests and trees

Usage: tree-weaver <command> [options]

Commands:
  new [file]               Start a tree (or --forest) from a template, or a starter forest
  validate <file...>       Strictly check documents; exits 1 when any has errors
  render <file>            Write a standalone HTML page for a tree
  export <file>            Write a tree as a React, Vue or Svelte component, or HTML + CSS files
  lint <file>              Check a tree for layout and accessibility problems (--render: on every display)
  convert <file>           Convert between JSON, YAML, XML, HTML, Markdown and SVG
  add <file> [blueprint]   Insert a blueprint branch or a JSON node into a tree
  patch <file> [ops]       Apply a list of edits (insert, move, setStyles, ...) to a tree
  expand <file>            Turn shorthand ("h2: Title", { "grid": 3 }) into a full document
  outline <file>           List a tree's branches and leaves with their ids and paths
  kit <file...>            List the classes and tokens of CSS files or a document's kits
  tokens <file>            List, edit and export design tokens (colours, spacing, type)
  components <file> [action] List reusable components, save a branch as one, insert an instance
  schema                   Print the JSON Schema for Tree Weaver documents
  link <file|url>          Print a link that opens a document in the live editor
  versions <file> [action] List, save, compare and restore saved versions of a file
  diff <a> <b>             Show what changed between two documents

Common options:
  -o, --output <file>      Write here instead of stdout (format from the extension)
  -t, --tree <name|id|n>   Pick a tree in a forest (default: the first)
      --json               Machine-readable report on stdout
  -h, --help               Help for a command
  -v, --version            Print the version

Use "-" as a file name to read stdin. Formats: ${FORMAT_IDS.join(', ')}.
Run "tree-weaver <command> --help" for a command's options.
Docs: https://github.com/hynding/tree-weaver/blob/main/docs/cli.md
`;

const COMMAND_HELP: Record<string, string> = {
  new: `Usage: tree-weaver new [file] [options]

Start a tree from a template, with the Weaver Basic starter kit, or a forest
from the template gallery with its own design tokens and components.

  -T, --template <id>   Template to start from (default: blank)
  -S, --starter <id>    Starter forest from the gallery: dashboard, landing or form
  -n, --name <name>     Name of the tree (and the forest)
      --forest          Write a forest holding the tree, instead of a tree
      --bare            Leave out the starter kit
      --force           Replace the file if it already exists
  -f, --format <fmt>    Output format when there is no file extension (default: json)
      --list            List the templates and starters
`,
  validate: `Usage: tree-weaver validate <file...> [options]

Check documents against the Tree Weaver contract and print every problem with its
path and a fix hint. JSON and YAML are checked as written; other formats are
imported first. Exits 1 when any document has errors.

      --strict          Treat warnings as errors
  -F, --from <fmt>      Input format, when the extension doesn't say
      --json            Print { valid, files: [{ file, valid, errors, warnings, ... }] }
`,
  render: `Usage: tree-weaver render <file> [options]

Write a standalone HTML page (inlined kits and responsive CSS) for a tree.

  -o, --output <file>   Output file (default: stdout)
  -t, --tree <ref>      Tree in a forest: name, id or 1-based number (default: first)
  -k, --kit <css>       Add a CSS file as a design kit (repeatable)
  -F, --from <fmt>      Input format, when the extension doesn't say
`,
  export: `Usage: tree-weaver export <file> --framework <name> [options]

Write a tree as source code for a codebase: a component with a CSS file (readable,
namespaced class names) or with Tailwind classes, plus kits.css for its design kits.
swiftui and flutter write a SwiftUI view or a Flutter widget with the styles and
design kit rules in it, plus DesignTokens.swift / design_tokens.dart when the kits
define tokens; --styling does not apply to them. Web exports add tokens.json, and
Tailwind ones a theme (tailwind.theme.css for v4, tailwind.tokens.cjs for v3).

  -f, --framework <name>  ${COMPONENT_FRAMEWORKS.map((f) => f.id).join(', ')} (default: react)
  -s, --styling <name>    css or tailwind (default: css; web frameworks only)
  -o, --output <dir>      Folder to write the files to (default: print them to stdout)
  -t, --tree <ref>        Tree in a forest: name, id or 1-based number (default: first)
  -n, --name <name>       Component name (default: from the tree's name)
      --ts                React: write a .tsx file
  -c, --component <name>  Export a reusable component of the forest (by name or id) with its
                          props and a variant prop, instead of a tree
  -k, --kit <css>         Add a CSS file as a design kit (repeatable)
  -F, --from <fmt>        Input format, when the extension doesn't say
      --json              Print { name, entry, files: [{ path, contents }] } (or the paths written)
`,
  lint: `Usage: tree-weaver lint <file> [options]

Check a tree for problems you would only see by looking at it on every display:
missing alt text, heading order, links and buttons without text, form fields
without labels, duplicate ids, empty branches, fixed widths wider than a display
and low contrast. Each issue has a path, the displays it shows on and a fix.
Exits 1 when there are errors (or warnings, with --strict).

      --render            Also render the page in Chromium (needs Playwright) at each
                          display's size: what overflows sideways, contrast with the
                          design kits applied, and images that don't load
  -d, --display <ids>     Displays to render, comma-separated (default: all)
  -t, --tree <ref>        Tree in a forest: name, id or 1-based number (default: all trees)
  -k, --kit <css>         Add a CSS file as a design kit (repeatable)
      --strict            Fail on warnings too
  -F, --from <fmt>        Input format, when the extension doesn't say
      --json              Print { ok, trees: [{ tree, ok, counts, issues, rendered }] }
`,
  convert: `Usage: tree-weaver convert <file> --to <fmt> [options]

  -f, --to <fmt>        Output format: ${FORMAT_IDS.join(', ')} (or from -o's extension)
  -o, --output <file>   Output file (default: stdout)
  -t, --tree <ref>      Convert one tree of a forest. Needed for HTML, Markdown and SVG
                        when the forest has several trees (default: first)
  -F, --from <fmt>      Input format, when the extension doesn't say
`,
  add: `Usage: tree-weaver add <file> <blueprint> [options]
       tree-weaver add <file> --node '<json>' [options]

Insert a ready-made branch from the library, or any branch or leaf given as JSON
(ids optional, shorthand welcome: '"h2: Title"', '{"grid": 3, "children": [...]}'),
and write the document back in its own format.

  -p, --parent <ref>    Parent branch: an id, or a child-index path such as /0/2
                        ("/" is the root; default: the root)
  -i, --index <n>       Position among the parent's children (default: last);
                        negative counts from the end: --index=-2
      --node <json>     A branch or leaf as JSON (or shorthand) instead of a blueprint id
  -t, --tree <ref>      Tree in a forest (default: first)
  -o, --output <file>   Write here instead of back to <file>
      --list            List the blueprints
      --no-version      Don't save the file as a version before changing it
      --json            Print { id, path, parent, tree, output }
`,
  outline: `Usage: tree-weaver outline <file> [options]

Show each tree as an indented list. Every line has the node's path (use it with
"add --parent") and its id.

  -t, --tree <ref>      Only this tree
      --json            Print the outline as nested JSON
`,
  kit: `Usage: tree-weaver kit <file...>

Print a JSON manifest of classes, tokens and media queries. Accepts .css files and
Tree Weaver documents (their design kits are listed).
`,
  patch: `Usage: tree-weaver patch <file> [patch-file] [options]
       tree-weaver patch <file> --ops '<json>' [options]

Apply a patch: a JSON (or YAML) list of operations, applied in order, all or
nothing. Nodes are named by id or by path (see "outline"). New nodes may use the
shorthand. Ops: insert, replace, remove, move, duplicate, wrap, update, setStyles,
setText. Example:

  [{ "op": "insert", "parent": "/1", "node": "h2: Pricing" },
   { "op": "setStyles", "target": "b_hero", "styles": { "padding": "4rem 0", "tablet": { "padding": "2rem 0" } } },
   { "op": "remove", "target": "/3" }]

      --ops <json>      The patch inline, instead of a patch file ("-" reads stdin)
  -t, --tree <ref>      Tree in a forest (default: first)
  -o, --output <file>   Write here instead of back to <file>
      --dry-run         Check the patch and print the result instead of writing it
      --no-version      Don't save the file as a version before changing it
      --json            Print { changes: [{ op, kind, id, path }], warnings, output }
`,
  expand: `Usage: tree-weaver expand <file> [options]

Expand the authoring shorthand in a JSON or YAML file into a full Tree Weaver
document, then check it. The file can be an envelope, a tree, a forest, or just a
list of nodes for the page body. Canonical nodes pass through unchanged.

  "h2: Title"   "a.btn[href=/join]: Join"   "img: url | alt"   "@card" (a blueprint)
  { "ul": ["li: One", "li: Two"] }   { "grid": 3, "children": [...] }
  { "row": [...] }   { "section": [...] }   { "table": [["A", "B"], ["1", "2"]] }
  { "use": "hero", "classes": ["dark"] }   "styles": { "gap": "1rem", "tablet": {...} }

  -o, --output <file>   Write here (format from the extension; default: JSON on stdout)
  -f, --to <fmt>        Output format: ${FORMAT_IDS.join(', ')}
  -n, --name <name>     Name of the tree, when the file doesn't give one
      --json            Print { output, valid, errors, warnings } (with -o)
`,
  link: `Usage: tree-weaver link <file|url> [options]

Print a link that opens a document in the editor. A file is packed into the link
itself (#doc=, nothing is uploaded); an http(s) URL is passed as ?src= (the server
must allow cross-origin requests).

      --editor <url>    Editor to link to (default: ${EDITOR_URL})
  -F, --from <fmt>      Input format, when the extension doesn't say
      --json            Print { url, length }
`,
  components: `Usage: tree-weaver components <forest> [list|save|insert] [options]

Reusable components live in a forest: a template branch with props ({{title}}
placeholders; data-show-if="prop" shows a branch only when the prop is set) and
variants (style overrides per display). Trees use them as linked instances that
follow the component.

  list                      List components with their props, variants and use
  save <branch>             Save a branch (id or path, see "outline") as a component;
                            the branch becomes its first instance
      -n, --name <name>     Component name (default: the branch's name)
  insert <component>        Insert an instance of a component (name or id)
      --parent <ref>        Branch to insert into (default: the tree's root)
      --index <n>           Position among the parent's children (default: last)
      --prop <name=value>   Set a prop (repeatable)
      --variant <d=name>    Use a variant on a display, e.g. lg=row or
                            mobile-portrait=stacked (repeatable); "name" alone = lg
  -t, --tree <ref>          Tree in the forest (default: first)
  -o, --output <file>       Write here instead of back to <forest>
      --no-version          Don't save the file as a version before changing it
      --json                Machine-readable output

Export one with its props: tree-weaver export site.json --component Card -f react
`,
  tokens: `Usage: tree-weaver tokens <file> [options]

List a document's design tokens: the :root custom properties of its kits, with the
edits in its token kit on top. --set and --reset edit the token kit and write the
document back; --format writes the tokens for a platform.

      --set <name=value>  Set (or add) a token, repeatable: --set brand=#2f6f4f sets
                          --brand (write the name without its leading dashes)
      --kind <name=kind>  Set a token's kind (repeatable): ${TOKEN_KINDS.join(', ')}
      --reset <name>      Drop an edit so the kit value shows again (repeatable)
  -f, --format <name>     Print the tokens as css, json (W3C Design Tokens), tailwind
                          (v4 @theme), tailwind-v3 (preset), swift or dart
  -o, --output <file>     Write the document (or the --format output) here instead
      --no-version        Don't save the file as a version before changing it
      --json              Print { tokens: [{ name, value, resolved, kind, source, edited }] }
`,
  versions: `Usage: tree-weaver versions <file> [list|save|diff|restore|remove] [version] [options]

Saved versions of a document, kept next to it in .tree-weaver/<file>.versions.json.
"patch" and "add" save one automatically before they change a file (unless
--no-version), so an agent's edits can be reviewed and rolled back.

  versions <file>                   List versions, oldest first, numbered
  versions <file> save [-n name]    Save the file as it is now
  versions <file> diff <v> [v2]     What changed from version v to the file (or to v2)
  versions <file> restore <v>       Write version v back (the current file is saved first)
  versions <file> remove <v>        Forget a version

A version is an id, a name, "latest", a number from the list, or -1, -2... from the newest.

  -n, --name <name>     Name for "save"
      --json            Machine-readable output
`,
  diff: `Usage: tree-weaver diff <before> <after> [options]

List what changed between two documents: branches and leaves added, removed, moved
or changed (with which part: styles per display, classes, attributes, text), trees
and design kits. Nodes are matched by id.

  -F, --from <fmt>      Input format, when the extension doesn't say
      --json            Print { trees: [{ id, name, status, changes }], kits, empty }
`,
  schema: `Usage: tree-weaver schema [--patch] [-o file]

Print the draft 2020-12 JSON Schema for Tree Weaver documents, or with --patch,
for patches.
`,
};

const COMMON = {
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const satisfies ParseArgsConfig['options'];

function parse<O extends NonNullable<ParseArgsConfig['options']>>(args: string[], options: O) {
  try {
    return parseArgs({ args, options: { ...COMMON, ...options }, allowPositionals: true, strict: true });
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
}

function asFormat(value: string | undefined, flag: string): FormatId | undefined {
  if (value === undefined) return undefined;
  const id = value.toLowerCase() === 'md' ? 'markdown' : value.toLowerCase() === 'yml' ? 'yaml' : value.toLowerCase();
  if (!(FORMAT_IDS as string[]).includes(id)) throw new UsageError(`${flag} must be one of ${FORMAT_IDS.join(', ')}, not "${value}"`);
  return id as FormatId;
}

interface Loaded {
  doc: TreeDocument;
  format: FormatId;
  text: string;
}

class Cli {
  constructor(readonly io: CliIO) {}

  async read(path: string): Promise<string> {
    if (path === '-') return this.io.readStdin();
    try {
      return await this.io.readFile(path);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      throw new Error(code === 'ENOENT' ? `${path}: no such file` : `${path}: ${(err as Error).message}`);
    }
  }

  async load(path: string, from?: FormatId): Promise<Loaded> {
    const text = await this.read(path);
    const format = from ?? detectFormat(text, path === '-' ? undefined : path);
    try {
      return { doc: importDocument(text, format), format, text };
    } catch (err) {
      if (err instanceof FormatError || err instanceof TreeDataError) throw new Error(`${path}: ${err.message}`);
      throw err;
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.io.readFile(path);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  /** Write to a file, or to stdout when there is no file. */
  async emit(output: string | undefined, data: string): Promise<void> {
    if (output && output !== '-') await this.io.writeFile(output, data);
    else this.io.stdout(data.endsWith('\n') ? data : `${data}\n`);
  }

  report(json: boolean, value: unknown, human: string): void {
    if (json) this.io.stdout(`${JSON.stringify(value, null, 2)}\n`);
    else if (human) this.io.stdout(human.endsWith('\n') ? human : `${human}\n`);
  }

  note(text: string): void {
    this.io.stderr(`${text}\n`);
  }

  /** Report after writing a document: to stdout when it went to a file, else to stderr, so stdout holds only the document. */
  reportAfter(target: string | undefined, json: boolean, value: unknown, human: string): void {
    if (target) this.report(json, value, human);
    else this.note(human);
  }
}

/* ------------------------------------------------------------- tree lookups */

function treesOf(doc: TreeDocument): Tree[] {
  return doc.kind === 'forest' ? doc.forest.trees : [doc.tree];
}

function kitsOf(doc: TreeDocument): DesignKit[] {
  return doc.kind === 'forest' ? doc.forest.kits : doc.kits;
}

/** Find a tree by id, name (any case) or 1-based number. */
function pickTree(cli: Cli, doc: TreeDocument, ref: string | undefined, why: string): Tree {
  const trees = treesOf(doc);
  if (trees.length === 0) throw new Error('The forest has no trees');
  if (ref === undefined) {
    if (trees.length > 1) cli.note(`Using the first of ${trees.length} trees, "${trees[0].name}" (${why}); pick another with --tree`);
    return trees[0];
  }
  const lower = ref.toLowerCase();
  const found =
    trees.find((t) => t.id === ref) ??
    trees.find((t) => t.name.toLowerCase() === lower) ??
    (/^\d+$/.test(ref) ? trees[Number(ref) - 1] : undefined);
  if (!found) throw new Error(`No tree "${ref}". Trees: ${trees.map((t, i) => `${i + 1}. ${t.name} (${t.id})`).join(', ')}`);
  return found;
}

/** Resolve a branch by id, or by a child-index path such as `/0/2` (`/` is the root). */
function resolveNode(root: Branch, ref: string | undefined): { node: TreeNode; path: string } {
  if (ref?.startsWith('/') && ref.split('/').filter(Boolean).some((step) => !/^\d+$/.test(step))) {
    throw new UsageError(`Bad path "${ref}": use child indexes such as /0/2`);
  }
  return resolveRef(root, ref);
}

/* ---------------------------------------------------------------- versions */

/** The file's version log. Missing is empty; unreadable or damaged throws, so nothing writes over it. */
async function readVersions(cli: Cli, file: string): Promise<VersionLog> {
  const path = versionLogPath(file);
  let text: string;
  try {
    text = await cli.io.readFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return parseVersionLog(null);
    throw new Error(`${path}: ${(err as Error).message}`);
  }
  try {
    return parseVersionLog(text, true);
  } catch (err) {
    throw new Error(`${path}: ${(err as Error).message}`);
  }
}

/** Save `text` (the file as it is now) as a version of `file`. */
async function keepVersion(cli: Cli, file: string, text: string, format: FormatId, init: { name?: string; source?: ChangeSource; auto?: boolean }) {
  const { log, version } = addVersion(await readVersions(cli, file), { ...init, document: text, format });
  await cli.io.writeFile(versionLogPath(file), stringifyVersionLog(log));
  return version;
}

/** Where an edited document goes: the output file, else back to its file; undefined means stdout (`-`). */
function editTarget(output: string | undefined, file: string): string | undefined {
  const target = output ?? file;
  return target === '-' ? undefined : target;
}

/** Whether two spellings name the same file (`t.json` and `./t.json`). */
const sameFile = (a: string, b: string) => b !== '-' && resolvePath(a) === resolvePath(b);

/** Put an updated tree back into its document and write it, in the document's own format. */
async function writeTree(cli: Cli, loaded: Loaded, file: string, tree: Tree, output: string | undefined, versionAs?: string): Promise<string | undefined> {
  const { doc, format } = loaded;
  let next: TreeDocument;
  if (doc.kind === 'forest') next = { kind: 'forest', forest: { ...replaceTree(doc.forest, tree), updatedAt: now() } };
  else next = { ...doc, tree: { ...tree, updatedAt: now() } };
  if (!getFormat(format).lossless) cli.note(`${file} is ${getFormat(format).label}, which doesn't keep every style or attribute; consider converting it to JSON first`);
  const data = next.kind === 'forest' ? exportForest(next.forest, format) : exportTree(next.tree, format, next.kits);
  const target = editTarget(output, file);
  // Overwriting the file: keep what it was, so "versions restore" can bring it back.
  if (versionAs && target && sameFile(target, file) && loaded.text !== data) await keepVersion(cli, file, loaded.text, format, { name: versionAs, source: 'agent', auto: true });
  await cli.emit(target, data);
  return target;
}

/* ------------------------------------------------------------------ commands */

async function cmdNew(cli: Cli, args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    template: { type: 'string', short: 'T' },
    starter: { type: 'string', short: 'S' },
    name: { type: 'string', short: 'n' },
    forest: { type: 'boolean' },
    bare: { type: 'boolean' },
    format: { type: 'string', short: 'f' },
    output: { type: 'string', short: 'o' },
    list: { type: 'boolean' },
    force: { type: 'boolean' },
  });
  const json = !!values.json;
  if (values.list) {
    const list = [
      ...TEMPLATES.map(({ id, label, description }) => ({ id, label, description, kind: 'tree' as const })),
      ...STARTERS.map(({ id, label, description }) => ({ id, label, description, kind: 'forest' as const })),
    ];
    const lines = (kind: 'tree' | 'forest') => list.filter((t) => t.kind === kind).map((t) => `  ${t.id.padEnd(12)} ${t.description}`);
    cli.report(json, list, [`Templates (--template):`, ...lines('tree'), ``, `Starter forests (--starter):`, ...lines('forest')].join('\n'));
    return 0;
  }
  if (positionals.length > 1) throw new UsageError('new takes at most one file');
  const output = values.output ?? positionals[0];
  // `init` and `create` make it easy to run this over a document by accident, and nothing would be kept.
  if (output && output !== '-' && !values.force && (await cli.exists(output))) {
    throw new Error(`${output} already exists; pass --force to replace it`);
  }
  if (values.starter !== undefined) {
    if (values.template !== undefined) throw new UsageError('Give --template or --starter, not both');
    const starter = getStarter(values.starter);
    if (!starter) throw new UsageError(`No starter "${values.starter}". Starters: ${STARTERS.map((t) => t.id).join(', ')}`);
    const format = asFormat(values.format, '--format') ?? (output ? formatFromFileName(output) : null) ?? 'json';
    if (!getFormat(format).forest) throw new UsageError(`${getFormat(format).label} holds one tree; use json, yaml or xml for a starter forest`);
    const forest = starter.create(values.name);
    await cli.emit(output, exportForest(forest, format));
    if (output && output !== '-') {
      cli.report(
        json,
        { output, format, kind: 'forest', starter: starter.id, trees: forest.trees.map((t) => ({ id: t.id, name: t.name })), components: (forest.components ?? []).map((c) => c.name) },
        `Wrote ${output} (${starter.label}: ${forest.trees.length} trees, ${forest.components?.length ?? 0} components, ${getFormat(format).label})`,
      );
    }
    return 0;
  }
  const templateId = values.template ?? 'blank';
  const template = getTemplate(templateId);
  if (!template) throw new UsageError(`No template "${templateId}". Templates: ${TEMPLATES.map((t) => t.id).join(', ')}`);
  const format = asFormat(values.format, '--format') ?? (output ? formatFromFileName(output) : null) ?? 'json';
  const tree = template.create(values.name);
  const kits = values.bare ? [] : [createStarterKit()];
  let data: string;
  if (values.forest) {
    const forest = createForest(values.name ?? tree.name, [tree]);
    forest.kits = kits;
    data = exportForest(forest, format);
  } else {
    data = exportTree(tree, format, kits);
  }
  await cli.emit(output, data);
  if (output && output !== '-') {
    cli.report(json, { output, format, kind: values.forest ? 'forest' : 'tree', template: template.id, tree: { id: tree.id, name: tree.name } }, `Wrote ${output} (${template.label} ${values.forest ? 'forest' : 'tree'}, ${getFormat(format).label})`);
  }
  return 0;
}

interface FileReport extends ValidationResult {
  file: string;
  format: FormatId | null;
}

async function cmdValidate(cli: Cli, args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { strict: { type: 'boolean' }, from: { type: 'string', short: 'F' } });
  if (positionals.length === 0) throw new UsageError('validate needs at least one file (or "-" for stdin)');
  const from = asFormat(values.from, '--from');
  const files: FileReport[] = [];
  for (const file of positionals) {
    const text = await cli.read(file);
    const format = from ?? detectFormat(text, file === '-' ? undefined : file);
    let result: ValidationResult;
    if (format === 'json' || format === 'yaml') {
      result = validateText(text, format);
    } else {
      try {
        result = validateDocument(toEnvelope(importDocument(text, format)));
      } catch (err) {
        const message = err instanceof FormatError || err instanceof TreeDataError ? err.message : String(err);
        result = { valid: false, kind: null, errors: [{ severity: 'error', path: '$', message }], warnings: [], counts: { trees: 0, branches: 0, leaves: 0 } };
      }
    }
    if (values.strict && result.warnings.length) result = { ...result, valid: false };
    files.push({ file, format, ...result });
  }
  const valid = files.every((f) => f.valid);
  const human = files
    .map((f) => {
      const c = f.counts;
      const what = f.kind ? `${f.kind}, ${c.trees} tree${c.trees === 1 ? '' : 's'}, ${c.branches} branches, ${c.leaves} leaves` : 'unreadable';
      const head = `${f.valid ? 'valid' : 'INVALID'} ${f.file} (${what}): ${f.errors.length} error${f.errors.length === 1 ? '' : 's'}, ${f.warnings.length} warning${f.warnings.length === 1 ? '' : 's'}`;
      const issues = formatIssues(f);
      return issues ? `${head}\n${issues.replace(/^/gm, '  ')}` : head;
    })
    .join('\n');
  cli.report(!!values.json, { valid, files }, human);
  return valid ? 0 : 1;
}

async function cmdRender(cli: Cli, args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    output: { type: 'string', short: 'o' },
    tree: { type: 'string', short: 't' },
    kit: { type: 'string', short: 'k', multiple: true },
    from: { type: 'string', short: 'F' },
  });
  if (positionals.length !== 1) throw new UsageError('render needs one file (or "-" for stdin)');
  const { doc } = await cli.load(positionals[0], asFormat(values.from, '--from'));
  const tree = pickTree(cli, doc, values.tree, 'a page holds one tree');
  const kits = [...kitsOf(doc)];
  for (const file of values.kit ?? []) kits.push(kitFromFile(file, await cli.read(file)));
  const html = exportTree(tree, 'html', kits);
  await cli.emit(values.output, html);
  if (values.output && values.output !== '-') cli.report(!!values.json, { output: values.output, tree: { id: tree.id, name: tree.name }, bytes: Buffer.byteLength(html) }, `Wrote ${values.output} (${tree.name})`);
  return 0;
}

async function cmdExport(cli: Cli, args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    framework: { type: 'string', short: 'f' },
    styling: { type: 'string', short: 's' },
    output: { type: 'string', short: 'o' },
    tree: { type: 'string', short: 't' },
    name: { type: 'string', short: 'n' },
    ts: { type: 'boolean' },
    kit: { type: 'string', short: 'k', multiple: true },
    from: { type: 'string', short: 'F' },
    component: { type: 'string', short: 'c' },
  });
  if (positionals.length !== 1) throw new UsageError('export needs one file (or "-" for stdin)');
  const ids = COMPONENT_FRAMEWORKS.map((f) => f.id) as string[];
  const framework = (values.framework ?? 'react').toLowerCase();
  if (!ids.includes(framework)) throw new UsageError(`--framework must be one of ${ids.join(', ')}, not "${values.framework}"`);
  const styling = (values.styling ?? 'css').toLowerCase();
  if (styling !== 'css' && styling !== 'tailwind') throw new UsageError(`--styling must be css or tailwind, not "${values.styling}"`);
  const { doc } = await cli.load(positionals[0], asFormat(values.from, '--from'));
  const kits = [...kitsOf(doc)];
  for (const file of values.kit ?? []) kits.push(kitFromFile(file, await cli.read(file)));
  const options = { framework: framework as ComponentFramework, styling: styling as 'css' | 'tailwind', kits, name: values.name, typescript: !!values.ts };
  let out;
  if (values.component !== undefined) {
    const def = findComponent(doc.kind === 'forest' ? doc.forest.components : undefined, values.component);
    if (!def) throw new Error(`No component "${values.component}"${doc.kind === 'forest' && doc.forest.components?.length ? `. Components: ${doc.forest.components.map((c) => c.name).join(', ')}` : ' (components live in forests)'}`);
    out = exportComponentDef(def, options);
  } else out = exportComponent(pickTree(cli, doc, values.tree, 'a component holds one tree'), options);
  const json = !!values.json;
  if (values.output && values.output !== '-') {
    const dir = values.output.replace(/\/+$/, '');
    const written: string[] = [];
    for (const f of out.files) {
      const path = `${dir}/${f.path}`;
      await cli.io.writeFile(path, f.contents);
      written.push(path);
    }
    const native = isNativeFramework(out.framework);
    cli.report(
      json,
      { name: out.name, framework, styling: out.styling, entry: `${dir}/${out.entry}`, files: written },
      `Wrote ${out.name} (${native ? framework : `${framework}, ${styling}`}): ${written.join(', ')}`,
    );
  } else if (json) {
    cli.report(true, out, '');
  } else if (out.files.length === 1) {
    await cli.emit(undefined, out.files[0].contents);
  } else {
    await cli.emit(undefined, out.files.map((f) => `===== ${f.path} =====\n${f.contents.replace(/\n$/, '')}\n`).join('\n'));
  }
  return 0;
}

async function cmdLint(cli: Cli, args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    render: { type: 'boolean' },
    display: { type: 'string', short: 'd' },
    tree: { type: 'string', short: 't' },
    kit: { type: 'string', short: 'k', multiple: true },
    strict: { type: 'boolean' },
    from: { type: 'string', short: 'F' },
  });
  if (positionals.length !== 1) throw new UsageError('lint needs one file (or "-" for stdin)');
  let displays: DisplayId[] | undefined;
  if (values.display) {
    displays = values.display.split(',').map((d) => d.trim()) as DisplayId[];
    const bad = displays.filter((d) => !(DISPLAY_IDS as readonly string[]).includes(d));
    if (bad.length) throw new UsageError(`Unknown display "${bad[0]}". Displays: ${DISPLAY_IDS.join(', ')}`);
    if (!values.render) throw new UsageError('--display picks the displays to render; add --render');
  }
  const { doc } = await cli.load(positionals[0], asFormat(values.from, '--from'));
  const trees = values.tree === undefined ? treesOf(doc) : [pickTree(cli, doc, values.tree, '')];
  const kits = [...kitsOf(doc)];
  for (const file of values.kit ?? []) kits.push(kitFromFile(file, await cli.read(file)));
  const reports: CheckReport[] = [];
  if (values.render) {
    const browser = await (cli.io.launchBrowser ?? launchChromium)();
    try {
      for (const tree of trees) reports.push(await checkRendered(tree, { browser, kits, displays }));
    } finally {
      await browser.close();
    }
  } else {
    for (const tree of trees) reports.push(checkTree(tree));
  }
  const failed = (r: CheckReport) => !r.ok || (!!values.strict && r.counts.warnings > 0);
  const ok = !reports.some(failed);
  cli.report(!!values.json, { ok, trees: reports.map((r) => ({ ...r, ok: !failed(r) })) }, reports.map(formatCheckReport).join('\n\n'));
  return ok ? 0 : 1;
}

async function cmdConvert(cli: Cli, args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    to: { type: 'string', short: 'f' },
    output: { type: 'string', short: 'o' },
    tree: { type: 'string', short: 't' },
    from: { type: 'string', short: 'F' },
  });
  if (positionals.length !== 1) throw new UsageError('convert needs one file (or "-" for stdin)');
  const to = asFormat(values.to, '--to') ?? (values.output ? formatFromFileName(values.output) : null);
  if (!to) throw new UsageError(`Say which format to write with --to (${FORMAT_IDS.join(', ')})`);
  const { doc, format } = await cli.load(positionals[0], asFormat(values.from, '--from'));
  let data: string;
  let what: string;
  if (doc.kind === 'forest' && getFormat(to).forest && values.tree === undefined) {
    data = exportForest(doc.forest, to);
    what = `forest "${doc.forest.name}"`;
  } else {
    const tree = pickTree(cli, doc, values.tree, `${getFormat(to).label} holds one tree`);
    data = exportTree(tree, to, kitsOf(doc));
    what = `tree "${tree.name}"`;
  }
  if (!getFormat(to).lossless) cli.note(`${getFormat(to).label} keeps the content but not every style or attribute`);
  await cli.emit(values.output, data);
  if (values.output && values.output !== '-') cli.report(!!values.json, { output: values.output, from: format, to }, `Wrote ${values.output} (${what}, ${getFormat(format).label} to ${getFormat(to).label})`);
  return 0;
}

async function cmdAdd(cli: Cli, args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    parent: { type: 'string', short: 'p' },
    index: { type: 'string', short: 'i' },
    node: { type: 'string' },
    tree: { type: 'string', short: 't' },
    output: { type: 'string', short: 'o' },
    from: { type: 'string', short: 'F' },
    list: { type: 'boolean' },
    'no-version': { type: 'boolean' },
  });
  const json = !!values.json;
  if (values.list) {
    const list = BLUEPRINTS.map(({ id, label, category, description }) => ({ id, label, category, description }));
    cli.report(json, list, list.map((b) => `${b.id.padEnd(14)} ${b.category.padEnd(9)} ${b.description}`).join('\n'));
    return 0;
  }
  const [file, blueprintId, ...rest] = positionals;
  if (!file || rest.length) throw new UsageError('add needs a file and a blueprint id (or --node)');
  if (!blueprintId === (values.node === undefined)) throw new UsageError('Give either a blueprint id or --node, not both');

  let node: TreeNode;
  if (blueprintId) {
    const blueprint = getBlueprint(blueprintId);
    if (!blueprint) throw new UsageError(`No blueprint "${blueprintId}". Run "tree-weaver add --list"`);
    node = blueprint.create();
  } else {
    let data: unknown;
    try {
      data = JSON.parse(values.node!);
    } catch (err) {
      throw new UsageError(`--node is not valid JSON: ${(err as Error).message}`);
    }
    try {
      node = expandShorthand(data, 'node');
    } catch (err) {
      throw new Error(`--node: ${(err as Error).message}`);
    }
  }

  let index: number | undefined;
  if (values.index !== undefined) {
    if (!/^-?\d+$/.test(values.index)) throw new UsageError('--index must be a whole number');
    index = Number(values.index);
  }

  const loaded = await cli.load(file, asFormat(values.from, '--from'));
  const tree = pickTree(cli, loaded.doc, values.tree, 'adding to one tree');
  const { node: parent, path: parentPath } = resolveNode(tree.root, values.parent);
  const target: TreeNode = parent;
  if (!canHaveChildren(parent)) {
    const what = target.kind === 'branch' ? `a <${target.tag}>` : 'a leaf';
    throw new Error(`${parentPath} is ${what}, which can't hold children; pick a parent branch with --parent`);
  }
  if (index !== undefined && index < 0) index = Math.max(0, parent.children.length + 1 + index);
  // The same checks as a patch: valid node, unique ids, SVG placement.
  let updated: Tree;
  try {
    const result = applyPatch(tree.root, [{ op: 'insert', parent: parent.id, index, node }], { expandNode: (n) => n as TreeNode, takenIds: idsOutside(treesOf(loaded.doc), tree.id) });
    if (result.warnings.length) cli.note(formatIssues({ errors: [], warnings: result.warnings }).replace(/ops\[0\]\.node/g, 'node'));
    updated = { ...tree, root: result.root };
    node = resolveRef(result.root, result.changes[0].id).node;
  } catch (err) {
    throw new Error((err as Error).message.replace(/^ops\[0\]: /, '').replace(/ops\[0\]\.node/g, 'node'));
  }
  const output = await writeTree(cli, loaded, file, updated, values.output, values['no-version'] ? undefined : 'Before add');
  if (output) {
    const path = pathOf(updated.root, node.id) ?? '?';
    const label = isBranch(node) ? `<${node.tag}>${node.name ? ` "${node.name}"` : ''}` : `${node.type} leaf`;
    cli.report(json, { id: node.id, path, parent: { id: parent.id, path: parentPath }, tree: { id: tree.id, name: tree.name }, output }, `Added ${label} at ${path} (id ${node.id}) in ${output}`);
  }
  return 0;
}

async function cmdPatch(cli: Cli, args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    ops: { type: 'string' },
    tree: { type: 'string', short: 't' },
    output: { type: 'string', short: 'o' },
    from: { type: 'string', short: 'F' },
    'dry-run': { type: 'boolean' },
    'no-version': { type: 'boolean' },
  });
  const [file, patchFile, ...rest] = positionals;
  if (!file || rest.length) throw new UsageError('patch needs a file, and a patch file or --ops');
  if (!patchFile === (values.ops === undefined)) throw new UsageError('Give the patch as a file or with --ops, not both');
  if (file === '-' && (patchFile === '-' || values.ops === '-')) throw new UsageError('Only one of the document and the patch can come from stdin');
  const patchText = values.ops !== undefined && values.ops !== '-' ? values.ops : await cli.read(patchFile ?? '-');
  let ops: unknown;
  try {
    ops = parseData(patchText, values.ops !== undefined && values.ops !== '-' ? undefined : patchFile && /\.ya?ml$/i.test(patchFile) ? 'yaml' : undefined);
  } catch (err) {
    throw new UsageError(`The patch is not valid JSON or YAML: ${(err as Error).message.replace(/^Invalid (JSON|YAML): /, '')}`);
  }

  const loaded = await cli.load(file, asFormat(values.from, '--from'));
  const tree = pickTree(cli, loaded.doc, values.tree, 'a patch edits one tree');
  let result;
  try {
    result = applyPatch(tree.root, ops, { expandNode: (value, path) => expandShorthand(value, path), takenIds: idsOutside(treesOf(loaded.doc), tree.id) });
  } catch (err) {
    if (err instanceof PatchError) throw new Error(`${err.message}\nNothing was changed.`);
    throw err;
  }
  if (result.warnings.length) cli.note(formatIssues({ errors: [], warnings: result.warnings }));
  const updated: Tree = { ...tree, root: result.root };
  const json = !!values.json;
  if (values['dry-run']) {
    const doc: TreeDocument = loaded.doc.kind === 'forest' ? { kind: 'forest', forest: replaceTree(loaded.doc.forest, updated) } : { ...loaded.doc, tree: updated };
    if (json) cli.report(true, { dryRun: true, changes: result.changes, warnings: result.warnings }, '');
    else cli.io.stdout(doc.kind === 'forest' ? exportForest(doc.forest, loaded.format) : exportTree(doc.tree, loaded.format, doc.kits));
    return 0;
  }
  const output = await writeTree(cli, loaded, file, updated, values.output, values['no-version'] ? undefined : 'Before patch');
  if (output) {
    const lines = result.changes.map((c) => `  ${c.kind.padEnd(10)} ${c.path ?? '(removed)'}  #${c.id}`);
    cli.report(json, { changes: result.changes, warnings: result.warnings, tree: { id: tree.id, name: tree.name }, output }, `Applied ${result.changes.length} op${result.changes.length === 1 ? '' : 's'} to ${output}\n${lines.join('\n')}`);
  }
  return 0;
}

async function cmdExpand(cli: Cli, args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    output: { type: 'string', short: 'o' },
    to: { type: 'string', short: 'f' },
    name: { type: 'string', short: 'n' },
    from: { type: 'string', short: 'F' },
  });
  if (positionals.length !== 1) throw new UsageError('expand needs one file (or "-" for stdin)');
  const file = positionals[0];
  const from = asFormat(values.from, '--from');
  if (from && from !== 'json' && from !== 'yaml') throw new UsageError('The shorthand is written in JSON or YAML');
  const to = asFormat(values.to, '--to') ?? (values.output ? formatFromFileName(values.output) : null) ?? 'json';
  const text = await cli.read(file);
  const format = from ?? (file !== '-' && /\.ya?ml$/i.test(file) ? 'yaml' : undefined);
  let data: Record<string, unknown>;
  try {
    data = expandShorthandDocument(parseData(text, format as 'json' | 'yaml' | undefined));
  } catch (err) {
    throw new Error(`${file}: ${(err as Error).message}`);
  }
  const named = data.tree as Record<string, unknown> | undefined;
  if (values.name && named && (!named.name || named.name === 'Untitled tree')) named.name = values.name;
  const plain = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  const check = validateDocument(plain);
  if (!check.valid) {
    cli.report(!!values.json, { ok: false, valid: false, errors: check.errors, warnings: check.warnings }, '');
    throw new Error(`The expanded document has errors:\n${formatIssues(check)}`);
  }
  if (check.warnings.length) cli.note(formatIssues({ errors: [], warnings: check.warnings }));
  const doc = importDocument(JSON.stringify(plain), 'json');
  const out = doc.kind === 'forest' && getFormat(to).forest ? exportForest(doc.forest, to) : exportTree(pickTree(cli, doc, undefined, `${getFormat(to).label} holds one tree`), to, doc.kind === 'tree' ? doc.kits : doc.forest.kits);
  await cli.emit(values.output, out);
  if (values.output && values.output !== '-') {
    const c = check.counts;
    cli.report(!!values.json, { output: values.output, format: to, valid: true, warnings: check.warnings, counts: c }, `Wrote ${values.output} (${c.branches} branches, ${c.leaves} leaves, ${getFormat(to).label})`);
  }
  return 0;
}

interface OutlineNode {
  path: string;
  id: string;
  kind: 'branch' | 'leaf';
  tag?: string;
  type?: string;
  name?: string;
  classes?: string[];
  value?: string;
  children?: OutlineNode[];
}

function outlineOf(node: TreeNode, path: string): OutlineNode {
  if (!isBranch(node)) return { path, id: node.id, kind: 'leaf', type: node.type, value: node.value };
  const out: OutlineNode = { path, id: node.id, kind: 'branch', tag: node.tag };
  if (node.type) out.type = node.type;
  if (node.name) out.name = node.name;
  if (node.classes.length) out.classes = node.classes;
  out.children = node.children.map((c, i) => outlineOf(c, `${path === '/' ? '' : path}/${i}`));
  return out;
}

function outlineLines(node: OutlineNode, depth: number, lines: string[]): void {
  const pad = '  '.repeat(depth);
  if (node.kind === 'leaf') {
    const value = (node.value ?? '').replace(/\s+/g, ' ');
    const shown = value.length > 48 ? `${value.slice(0, 47)}…` : value;
    lines.push(`${pad}${node.path}  ${node.type === 'text' ? JSON.stringify(shown) : `${node.type} ${shown}`}  #${node.id}`);
    return;
  }
  const classes = node.classes?.map((c) => `.${c}`).join('') ?? '';
  const name = node.name ? ` "${node.name}"` : '';
  lines.push(`${pad}${node.path}  <${node.tag}>${classes}${name}  #${node.id}`);
  for (const child of node.children ?? []) outlineLines(child, depth + 1, lines);
}

async function cmdOutline(cli: Cli, args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { tree: { type: 'string', short: 't' }, from: { type: 'string', short: 'F' } });
  if (positionals.length !== 1) throw new UsageError('outline needs one file (or "-" for stdin)');
  const { doc } = await cli.load(positionals[0], asFormat(values.from, '--from'));
  const trees = values.tree === undefined ? treesOf(doc) : [pickTree(cli, doc, values.tree, '')];
  const result = trees.map((t) => ({ id: t.id, name: t.name, root: outlineOf(t.root, '/') }));
  const lines: string[] = [];
  for (const t of result) {
    lines.push(`tree "${t.name}"  #${t.id}`);
    outlineLines(t.root, 1, lines);
  }
  if (doc.kind === 'tree' || values.tree !== undefined) cli.report(!!values.json, result[0], lines.join('\n'));
  else cli.report(!!values.json, { forest: { id: doc.forest.id, name: doc.forest.name }, trees: result }, `forest "${doc.forest.name}"  #${doc.forest.id}\n${lines.join('\n')}`);
  return 0;
}

async function cmdKit(cli: Cli, args: string[]): Promise<number> {
  const { positionals } = parse(args, { from: { type: 'string', short: 'F' } });
  if (positionals.length === 0) throw new UsageError('kit needs at least one .css file or document');
  const kits: DesignKit[] = [];
  for (const file of positionals) {
    if (/\.css$/i.test(file)) kits.push(kitFromFile(file, await cli.read(file)));
    else kits.push(...kitsOf((await cli.load(file)).doc));
  }
  cli.io.stdout(`${JSON.stringify(kitManifest(kits), null, 2)}\n`);
  return 0;
}

async function cmdComponents(cli: Cli, args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    name: { type: 'string', short: 'n' },
    parent: { type: 'string' },
    index: { type: 'string' },
    prop: { type: 'string', multiple: true },
    variant: { type: 'string', multiple: true },
    tree: { type: 'string', short: 't' },
    output: { type: 'string', short: 'o' },
    'no-version': { type: 'boolean' },
    from: { type: 'string', short: 'F' },
  });
  const [file, action = 'list', ref, ...rest] = positionals;
  if (!file) throw new UsageError('components needs a forest file');
  if (rest.length) throw new UsageError(`Unexpected "${rest[0]}"`);
  const loaded = await cli.load(file, asFormat(values.from, '--from'));
  const { doc } = loaded;
  const json = !!values.json;
  const components = doc.kind === 'forest' ? (doc.forest.components ?? []) : [];
  const write = async (forest: Forest, label: string) => {
    const data = exportForest(forest, loaded.format);
    const target = editTarget(values.output, file);
    if (!values['no-version'] && target && sameFile(target, file) && loaded.text !== data) await keepVersion(cli, file, loaded.text, loaded.format, { name: label, source: 'agent', auto: true });
    await cli.emit(target, data);
    return target;
  };
  switch (action) {
    case 'list': {
      const list = components.map((c) => ({
        id: c.id,
        name: c.name,
        props: componentProps(c).map((p) => ({ name: p.name, type: p.type, default: p.default, ...(p.options ? { options: p.options } : {}) })),
        variants: c.variants.map((v) => v.name),
        instances: doc.kind === 'forest' ? doc.forest.trees.reduce((n, t) => n + countInstances(t.root, c.id), 0) : 0,
      }));
      const lines = list.map(
        (c) =>
          `${c.name}  #${c.id}  (${c.instances} in use)\n  props: ${c.props.map((p) => `${p.name}:${p.type}${p.default ? `=${p.default}` : ''}`).join(', ') || 'none'}\n  variants: ${c.variants.join(', ') || 'none'}`,
      );
      cli.report(json, { components: list }, lines.length ? lines.join('\n') : 'No components. Save one with "components <forest> save <branch>".');
      return 0;
    }
    case 'save': {
      if (doc.kind !== 'forest') throw new UsageError('Components live in forests: convert the tree to a forest first (tree-weaver new --forest), or pass a forest file');
      if (!ref) throw new UsageError('save needs a branch: an id or a path from "outline"');
      const tree = pickTree(cli, doc, values.tree, '');
      const { node } = resolveRef(tree.root, ref);
      if (!isBranch(node)) throw new Error(`"${ref}" is a leaf; save a branch`);
      if (instanceRoleIn(tree.root, node.id) === 'inside') throw new Error(`"${ref}" is inside a component instance; edit the component, or detach the instance first`);
      const saved = saveComponent({ ...doc.forest, updatedAt: now() }, tree.id, node.id, values.name ?? node.name ?? 'Component');
      if (!saved) throw new Error(`Could not save "${ref}"`);
      const { forest, component: def } = saved;
      const target = await write(forest, 'Before saving a component');
      cli.reportAfter(target, json, { component: { id: def.id, name: def.name, props: def.props.map((p) => p.name) }, output: target }, `Saved component "${def.name}" #${def.id}${def.props.length ? ` with props ${def.props.map((p) => p.name).join(', ')}` : ''}${target ? ` to ${target}` : ''}`);
      return 0;
    }
    case 'insert': {
      if (doc.kind !== 'forest') throw new UsageError('Components live in forests');
      if (!ref) throw new UsageError('insert needs a component name or id');
      const def = findComponent(components, ref);
      if (!def) throw new Error(`No component "${ref}"${components.length ? `. Components: ${components.map((c) => c.name).join(', ')}` : ''}`);
      const tree = pickTree(cli, doc, values.tree, '');
      const parent = resolveRef(tree.root, values.parent).node;
      if (!isBranch(parent)) throw new Error(`"${values.parent}" is a leaf; insert into a branch`);
      const props: Record<string, string> = {};
      for (const a of values.prop ?? []) {
        const i = a.indexOf('=');
        if (i < 1) throw new UsageError(`--prop needs name=value, got "${a}"`);
        props[a.slice(0, i)] = a.slice(i + 1);
      }
      const variants: NonNullable<ComponentInstance['variants']> = {};
      for (const a of values.variant ?? []) {
        const i = a.indexOf('=');
        const [display, name] = i < 0 ? ['lg', a] : [a.slice(0, i), a.slice(i + 1)];
        if (!isDisplayId(display)) throw new UsageError(`Unknown display "${display}". Displays: ${DISPLAY_IDS.join(', ')}`);
        if (!def.variants.some((v) => v.name === name)) throw new UsageError(`"${def.name}" has no variant "${name}"${def.variants.length ? `. Variants: ${def.variants.map((v) => v.name).join(', ')}` : ''}`);
        variants[display] = name;
      }
      const unknown = Object.keys(props).filter((p) => !componentProps(def).some((q) => q.name === p));
      if (unknown.length) cli.note(`"${def.name}" has no prop ${unknown.join(', ')}; ignored when rendering`);
      const inst = instantiateComponent(def, props, variants);
      if (values.index !== undefined && !/^-?\d+$/.test(values.index)) throw new UsageError('--index must be a whole number');
      let index = values.index !== undefined ? Number(values.index) : undefined;
      // Negative counts from the end, as for `add`.
      if (index !== undefined && index < 0) index = Math.max(0, parent.children.length + 1 + index);
      const problem = insertionProblem(tree.root, parent.id, inst);
      if (problem) throw new Error(problem);
      const root = insertNode(tree.root, parent.id, inst, index);
      const target = await write(replaceTree(doc.forest, { ...tree, root }), `Before inserting "${def.name}"`);
      cli.reportAfter(target, json, { id: inst.id, component: def.id, output: target }, `Inserted "${def.name}" #${inst.id} into ${parent.name ?? parent.tag}${target ? ` in ${target}` : ''}`);
      return 0;
    }
    default:
      throw new UsageError(`Unknown action "${action}": use list, save or insert`);
  }
}

function countInstances(node: TreeNode, componentId: string): number {
  if (!isBranch(node)) return 0;
  return (node.instance?.component === componentId ? 1 : 0) + node.children.reduce((n, c) => n + countInstances(c, componentId), 0);
}

const TOKEN_FORMATS = ['css', 'json', 'tailwind', 'tailwind-v3', 'swift', 'dart'] as const;

/** `brand=#fff` or `--brand=#fff` → ['--brand', '#fff']. */
function tokenPair(arg: string, flag: string): [string, string] {
  const i = arg.indexOf('=', arg.startsWith('--') ? 2 : 0);
  if (i < 1) throw new UsageError(`${flag} needs name=value, got "${arg}"`);
  const name = arg.slice(0, i).trim();
  return [name.startsWith('--') ? name : `--${name}`, arg.slice(i + 1).trim()];
}

async function cmdTokens(cli: Cli, args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    set: { type: 'string', multiple: true },
    kind: { type: 'string', multiple: true },
    reset: { type: 'string', multiple: true },
    format: { type: 'string', short: 'f' },
    output: { type: 'string', short: 'o' },
    'no-version': { type: 'boolean' },
    from: { type: 'string', short: 'F' },
  });
  if (positionals.length !== 1) throw new UsageError('tokens needs one file (or "-" for stdin)');
  const file = positionals[0];
  const loaded = await cli.load(file, asFormat(values.from, '--from'));
  const { doc } = loaded;
  let kits = doc.kind === 'forest' ? doc.forest.kits : doc.kits;
  const sets = (values.set ?? []).map((a) => tokenPair(a, '--set'));
  const kindsSet = (values.kind ?? []).map((a) => tokenPair(a, '--kind'));
  const edits = sets.length + kindsSet.length + (values.reset?.length ?? 0);
  if (edits && values.format) throw new UsageError('Use --format on its own, after editing');
  if (edits) {
    for (const name of values.reset ?? []) kits = resetToken(kits, name.startsWith('--') ? name : `--${name}`);
    for (const [name, value] of sets) kits = setToken(kits, { name, value });
    for (const [name, kind] of kindsSet) {
      if (!TOKEN_KINDS.includes(kind as TokenKind)) throw new UsageError(`Unknown kind "${kind}". Kinds: ${TOKEN_KINDS.join(', ')}`);
      const current = themeTokens(kits).find((t) => t.name === name);
      if (!current) throw new Error(`No token ${name}`);
      kits = setToken(kits, { name, value: current.value, kind: kind as TokenKind });
    }
    const next: TreeDocument = doc.kind === 'forest' ? { kind: 'forest', forest: { ...doc.forest, kits, updatedAt: now() } } : { ...doc, kits };
    const data = next.kind === 'forest' ? exportForest(next.forest, loaded.format) : exportTree(next.tree, loaded.format, next.kits);
    const target = editTarget(values.output, file);
    if (!values['no-version'] && target && sameFile(target, file) && loaded.text !== data) await keepVersion(cli, file, loaded.text, loaded.format, { name: 'Before tokens', source: 'agent', auto: true });
    await cli.emit(target, data);
    if (target) cli.note(`Wrote ${target}`);
  }
  const tokens = themeTokens(kits);
  if (values.format) {
    const format = values.format as (typeof TOKEN_FORMATS)[number];
    if (!TOKEN_FORMATS.includes(format)) throw new UsageError(`--format must be one of ${TOKEN_FORMATS.join(', ')}`);
    const out =
      format === 'css'
        ? tokens.length ? `:root {\n${tokens.map((t) => `  ${t.name}: ${t.value};`).join('\n')}\n}\n` : ''
        : format === 'json'
          ? tokensJson(kits)
          : format === 'tailwind'
            ? tailwindThemeCss(tokens)
            : format === 'tailwind-v3'
              ? tailwindPreset(tokens)
              : format === 'swift'
                ? exportSwiftUITokens(kits)
                : exportFlutterTokens(kits);
    if (!out) cli.note('No tokens to write for that format');
    await cli.emit(values.output, out);
    return 0;
  }
  // The edited document went to stdout: nothing else may follow it there.
  if (edits && editTarget(values.output, file) === undefined) return 0;
  const width = Math.max(4, ...tokens.map((t) => t.name.length));
  const lines = tokens.map((t) => `${t.name.padEnd(width)}  ${t.kind.padEnd(11)}  ${t.value}${t.resolved !== t.value ? `  (${t.resolved})` : ''}${t.edited ? `  [edited${t.kitValue ? `, kit: ${t.kitValue}` : ''}]` : ''}`);
  cli.report(!!values.json, { tokens }, tokens.length ? lines.join('\n') : 'No tokens: add :root { --name: value } to a kit, or use --set');
  return 0;
}

async function cmdSchema(cli: Cli, args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { output: { type: 'string', short: 'o' }, patch: { type: 'boolean' } });
  if (positionals.length) throw new UsageError('schema takes no files; use -o to write one');
  await cli.emit(values.output, `${JSON.stringify(values.patch ? TREE_WEAVER_PATCH_SCHEMA : TREE_WEAVER_SCHEMA, null, 2)}\n`);
  return 0;
}

async function cmdLink(cli: Cli, args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { editor: { type: 'string' }, from: { type: 'string', short: 'F' } });
  if (positionals.length !== 1) throw new UsageError('link needs one file or http(s) URL');
  const target = positionals[0];
  let editor: URL;
  try {
    editor = new URL(values.editor ?? EDITOR_URL);
  } catch {
    throw new UsageError(`--editor is not a URL: ${values.editor}`);
  }
  let url: string;
  if (/^https?:\/\//i.test(target)) {
    editor.searchParams.set('src', target);
    url = editor.href;
  } else {
    const { doc } = await cli.load(target, asFormat(values.from, '--from'));
    const json = doc.kind === 'forest' ? exportForest(doc.forest, 'json') : exportTree(doc.tree, 'json', doc.kits);
    const packed = Buffer.from(JSON.stringify(JSON.parse(json))).toString('base64url');
    editor.hash = `doc=${packed}`;
    url = editor.href;
    if (url.length > 32000) cli.note(`The link is ${url.length} characters; some apps cut long links. Host the file and link its URL instead.`);
  }
  cli.report(!!values.json, { url, length: url.length }, url);
  return 0;
}

const when = (iso: string) => iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z');

async function cmdVersions(cli: Cli, args: string[]): Promise<number> {
  // `-1`, `-2`… name versions from the newest; keep them from being read as options.
  const NEG = '\u0000';
  const { values, positionals: raw } = parse(
    // Not when it is an option's value (`-n -1` names a version "-1").
    args.map((a, i) => (/^-\d+$/.test(a) && !['-n', '--name', '-F', '--from'].includes(args[i - 1]) ? `${NEG}${a}` : a)),
    {
      name: { type: 'string', short: 'n' },
      from: { type: 'string', short: 'F' },
    },
  );
  const positionals = raw.map((p) => (p.startsWith(NEG) ? p.slice(1) : p));
  const [file, action = 'list', ref, ref2, ...rest] = positionals;
  if (!file || file === '-') throw new UsageError('versions needs a file');
  if (rest.length) throw new UsageError(`Unexpected "${rest[0]}"`);
  const json = !!values.json;
  const log = await readVersions(cli, file);
  const need = (r: string | undefined) => {
    if (!r) throw new UsageError(`versions ${action} needs a version: an id, a name, "latest", or a number from "versions ${file}"`);
    const v = findVersion(log, r);
    if (!v) throw new Error(`No version "${r}" of ${file} (see "tree-weaver versions ${file}")`);
    return v;
  };
  switch (action) {
    case 'list': {
      const list = log.versions.map(({ document: _, ...v }, i) => ({ number: i + 1, ...v }));
      cli.report(
        json,
        { file, log: versionLogPath(file), versions: list },
        list.length
          ? list.map((v) => `${String(v.number).padStart(3)}  ${when(v.createdAt)}  ${v.name}${v.auto ? ' (automatic)' : ''}  ${v.id}`).join('\n')
          : `No versions of ${file} yet. "tree-weaver versions ${file} save -n <name>" saves one; patch and add save one before they change the file.`,
      );
      return 0;
    }
    case 'save': {
      const loaded = await cli.load(file, asFormat(values.from, '--from'));
      const v = await keepVersion(cli, file, loaded.text, loaded.format, { name: values.name ?? ref, source: 'editor' });
      cli.report(json, { id: v.id, name: v.name, createdAt: v.createdAt, log: versionLogPath(file) }, `Saved "${v.name}" (${v.id})`);
      return 0;
    }
    case 'restore': {
      const v = need(ref);
      const current = await cli.read(file).catch(() => null);
      if (current !== null && current !== v.document) await keepVersion(cli, file, current, detectFormat(current, file), { name: `Before restoring "${v.name}"`, source: 'restore', auto: true });
      await cli.io.writeFile(file, v.document);
      cli.report(json, { restored: { id: v.id, name: v.name }, file }, `Restored "${v.name}" to ${file}`);
      return 0;
    }
    case 'diff': {
      const a = need(ref);
      const before = importDocument(a.document, a.format as FormatId);
      const label = ref2 ? need(ref2).name : file;
      const after = ref2 ? (({ document, format }) => importDocument(document, format as FormatId))(need(ref2)) : (await cli.load(file, asFormat(values.from, '--from'))).doc;
      const diff = diffDocuments(before, after);
      cli.report(json, { from: a.name, to: label, ...diff }, `Changes from "${a.name}" to ${ref2 ? `"${label}"` : label}:\n${formatDiff(diff)}`);
      return 0;
    }
    case 'remove': {
      const v = need(ref);
      await cli.io.writeFile(versionLogPath(file), stringifyVersionLog(removeVersion(log, v.id)));
      cli.report(json, { removed: { id: v.id, name: v.name } }, `Removed "${v.name}"`);
      return 0;
    }
    default:
      throw new UsageError(`Unknown action "${action}": use list, save, restore, diff or remove`);
  }
}

async function cmdDiff(cli: Cli, args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { from: { type: 'string', short: 'F' } });
  const [a, b, ...rest] = positionals;
  if (!a || !b || rest.length) throw new UsageError('diff needs two files');
  if (a === '-' && b === '-') throw new UsageError('Only one file can come from stdin');
  const from = asFormat(values.from, '--from');
  const diff = diffDocuments((await cli.load(a, from)).doc, (await cli.load(b, from)).doc);
  cli.report(!!values.json, diff, formatDiff(diff));
  return 0;
}

const COMMANDS: Record<string, (cli: Cli, args: string[]) => Promise<number>> = {
  versions: cmdVersions,
  diff: cmdDiff,
  new: cmdNew,
  validate: cmdValidate,
  render: cmdRender,
  lint: cmdLint,
  convert: cmdConvert,
  add: cmdAdd,
  patch: cmdPatch,
  expand: cmdExpand,
  export: cmdExport,
  outline: cmdOutline,
  kit: cmdKit,
  tokens: cmdTokens,
  components: cmdComponents,
  schema: cmdSchema,
  link: cmdLink,
};

const ALIASES: Record<string, string> = { component: 'export', check: 'validate', ls: 'outline', html: 'render', create: 'new', init: 'new' };

async function version(io: CliIO): Promise<string> {
  try {
    const pkg = JSON.parse(await io.readFile(fileURLToPath(new URL('../package.json', import.meta.url)))) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Run the CLI with `argv` (without `node` and the script) and return the exit code:
 * 0 for success, 1 for invalid documents or failed commands, 2 for usage errors.
 */
export async function run(argv: string[], io: CliIO = nodeIO): Promise<number> {
  const cli = new Cli(io);
  const [first, ...rest] = argv;
  if (!first || first === '-h' || first === '--help' || first === 'help') {
    const topic = first === 'help' ? rest[0] : undefined;
    const name = topic ? (ALIASES[topic] ?? topic) : undefined;
    io.stdout(name && COMMAND_HELP[name] ? COMMAND_HELP[name] : HELP);
    return first ? 0 : 2;
  }
  if (first === '-v' || first === '--version') {
    io.stdout(`${await version(io)}\n`);
    return 0;
  }
  const name = ALIASES[first] ?? first;
  const command = COMMANDS[name];
  if (!command) {
    io.stderr(`tree-weaver: unknown command "${first}"\n\n${HELP}`);
    return 2;
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    io.stdout(COMMAND_HELP[name]);
    return 0;
  }
  const json = rest.includes('--json');
  try {
    return await command(cli, rest);
  } catch (err) {
    const usage = err instanceof UsageError;
    const message = err instanceof Error ? err.message : String(err);
    if (json) io.stdout(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
    io.stderr(`tree-weaver ${name}: ${message}\n${usage ? `Run "tree-weaver ${name} --help" for usage.\n` : ''}`);
    return usage ? 2 : 1;
  }
}
