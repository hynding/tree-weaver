import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import {
  canHaveChildren,
  createForest,
  findNode,
  formatIssues,
  insertNode,
  isBranch,
  normalizeNode,
  now,
  replaceTree,
  TREE_WEAVER_SCHEMA,
  TreeDataError,
  validateDocument,
  type Branch,
  type DesignKit,
  type Forest,
  type Tree,
  type TreeNode,
  type ValidationResult,
} from '@tree-weaver/core';
import {
  detectFormat,
  exportForest,
  exportTree,
  FORMATS,
  FormatError,
  formatFromFileName,
  getFormat,
  importDocument,
  toEnvelope,
  validateText,
  type FormatId,
  type TreeDocument,
} from '@tree-weaver/formats';
import { createStarterKit, kitFromFile, kitManifest } from '@tree-weaver/kits';
import { BLUEPRINTS, getBlueprint, getTemplate, TEMPLATES } from '@tree-weaver/branches';

/** Where the CLI reads and writes. Swap it out to drive the CLI from code or tests. */
export interface CliIO {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  readStdin(): Promise<string>;
  stdout(text: string): void;
  stderr(text: string): void;
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

const HELP = `tree-weaver: create, check, edit and render Tree Weaver forests and trees

Usage: tree-weaver <command> [options]

Commands:
  new [file]               Start a tree (or --forest) from a template
  validate <file...>       Strictly check documents; exits 1 when any has errors
  render <file>            Write a standalone HTML page for a tree
  convert <file>           Convert between JSON, YAML, XML, HTML, Markdown and SVG
  add <file> [blueprint]   Insert a blueprint branch or a JSON node into a tree
  outline <file>           List a tree's branches and leaves with their ids and paths
  kit <file...>            List the classes and tokens of CSS files or a document's kits
  schema                   Print the JSON Schema for Tree Weaver documents

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

Start a tree from a template, with the Weaver Basic starter kit.

  -T, --template <id>   Template to start from (default: blank)
  -n, --name <name>     Name of the tree (and the forest)
      --forest          Write a forest holding the tree, instead of a tree
      --bare            Leave out the starter kit
  -f, --format <fmt>    Output format when there is no file extension (default: json)
      --list            List the templates
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
(ids optional), and write the document back in its own format.

  -p, --parent <ref>    Parent branch: an id, or a child-index path such as /0/2
                        ("/" is the root; default: the root)
  -i, --index <n>       Position among the parent's children (default: last);
                        negative counts from the end: --index=-2
      --node <json>     A branch or leaf as JSON instead of a blueprint id
  -t, --tree <ref>      Tree in a forest (default: first)
  -o, --output <file>   Write here instead of back to <file>
      --list            List the blueprints
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
  schema: `Usage: tree-weaver schema [-o file]

Print the draft 2020-12 JSON Schema for Tree Weaver documents.
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
  if (ref === undefined || ref === '/' || ref === '') return { node: root, path: '/' };
  if (ref.startsWith('/')) {
    let node: TreeNode = root;
    const steps = ref.split('/').filter(Boolean);
    for (const [depth, step] of steps.entries()) {
      const at = `/${steps.slice(0, depth + 1).join('/')}`;
      if (!/^\d+$/.test(step)) throw new UsageError(`Bad path "${ref}": "${step}" is not a child index`);
      if (!isBranch(node)) throw new Error(`Path "${at}" goes inside a leaf`);
      const child: TreeNode | undefined = node.children[Number(step)];
      if (!child) throw new Error(`Path "${at}" does not exist; ${node.children.length} children there`);
      node = child;
    }
    return { node, path: `/${steps.join('/')}` };
  }
  const node = findNode(root, ref);
  if (!node) throw new Error(`No branch or leaf with id "${ref}". Run "tree-weaver outline" to list ids`);
  return { node, path: pathOf(root, ref) ?? '?' };
}

function pathOf(root: Branch, id: string, prefix = ''): string | null {
  if (root.id === id) return prefix || '/';
  for (const [i, child] of root.children.entries()) {
    const here = `${prefix}/${i}`;
    if (child.id === id) return here;
    if (isBranch(child)) {
      const found = pathOf(child, id, here);
      if (found) return found;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ commands */

async function cmdNew(cli: Cli, args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    template: { type: 'string', short: 'T' },
    name: { type: 'string', short: 'n' },
    forest: { type: 'boolean' },
    bare: { type: 'boolean' },
    format: { type: 'string', short: 'f' },
    output: { type: 'string', short: 'o' },
    list: { type: 'boolean' },
  });
  const json = !!values.json;
  if (values.list) {
    const list = TEMPLATES.map(({ id, label, description }) => ({ id, label, description }));
    cli.report(json, list, list.map((t) => `${t.id.padEnd(12)} ${t.description}`).join('\n'));
    return 0;
  }
  if (positionals.length > 1) throw new UsageError('new takes at most one file');
  const output = values.output ?? positionals[0];
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
  if (output) {
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
  if (values.output) cli.report(!!values.json, { output: values.output, tree: { id: tree.id, name: tree.name }, bytes: Buffer.byteLength(html) }, `Wrote ${values.output} (${tree.name})`);
  return 0;
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
  if (values.output) cli.report(!!values.json, { output: values.output, from: format, to }, `Wrote ${values.output} (${what}, ${getFormat(format).label} to ${getFormat(to).label})`);
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
    const NODE_PATH = /(?:\$|branch)\.children\[0\]/g;
    // Check the node the same way as a whole document, as the only child of a <div>.
    const check = validateDocument({ kind: 'branch', tag: 'div', children: [data] });
    if (!check.valid) throw new Error(`--node has errors:\n${formatIssues({ errors: check.errors, warnings: [] }).replace(NODE_PATH, 'node')}`);
    if (check.warnings.length) cli.note(formatIssues({ errors: [], warnings: check.warnings }).replace(NODE_PATH, 'node'));
    node = normalizeNode(data, 'node');
  }

  let index: number | undefined;
  if (values.index !== undefined) {
    if (!/^-?\d+$/.test(values.index)) throw new UsageError('--index must be a whole number');
    index = Number(values.index);
  }

  const { doc, format } = await cli.load(file, asFormat(values.from, '--from'));
  const tree = pickTree(cli, doc, values.tree, 'adding to one tree');
  const { node: parent, path: parentPath } = resolveNode(tree.root, values.parent);
  const target: TreeNode = parent;
  if (!canHaveChildren(parent)) {
    const what = target.kind === 'branch' ? `a <${target.tag}>` : 'a leaf';
    throw new Error(`${parentPath} is ${what}, which can't hold children; pick a parent branch with --parent`);
  }
  if (index !== undefined && index < 0) index = Math.max(0, parent.children.length + 1 + index);
  const updated: Tree = { ...tree, root: insertNode(tree.root, parent.id, node, index), updatedAt: now() };

  let next: TreeDocument;
  if (doc.kind === 'forest') {
    const forest: Forest = { ...replaceTree(doc.forest, updated), updatedAt: now() };
    next = { kind: 'forest', forest };
  } else next = { ...doc, tree: updated };

  if (!getFormat(format).lossless) cli.note(`${file} is ${getFormat(format).label}, which doesn't keep every style or attribute; consider converting it to JSON first`);
  const data = next.kind === 'forest' ? exportForest(next.forest, format) : exportTree(next.tree, format, next.kits);
  const output = values.output ?? (file === '-' ? undefined : file);
  await cli.emit(output, data);
  if (output) {
    const path = pathOf(updated.root, node.id) ?? '?';
    const label = isBranch(node) ? `<${node.tag}>${node.name ? ` "${node.name}"` : ''}` : `${node.type} leaf`;
    cli.report(json, { id: node.id, path, parent: { id: parent.id, path: parentPath }, tree: { id: tree.id, name: tree.name }, output }, `Added ${label} at ${path} (id ${node.id}) in ${output}`);
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

async function cmdSchema(cli: Cli, args: string[]): Promise<number> {
  const { values, positionals } = parse(args, { output: { type: 'string', short: 'o' } });
  if (positionals.length) throw new UsageError('schema takes no files; use -o to write one');
  await cli.emit(values.output, `${JSON.stringify(TREE_WEAVER_SCHEMA, null, 2)}\n`);
  return 0;
}

const COMMANDS: Record<string, (cli: Cli, args: string[]) => Promise<number>> = {
  new: cmdNew,
  validate: cmdValidate,
  render: cmdRender,
  convert: cmdConvert,
  add: cmdAdd,
  outline: cmdOutline,
  kit: cmdKit,
  schema: cmdSchema,
};

const ALIASES: Record<string, string> = { check: 'validate', ls: 'outline', html: 'render', create: 'new', init: 'new' };

async function version(io: CliIO): Promise<string> {
  try {
    const pkg = JSON.parse(await io.readFile(new URL('../package.json', import.meta.url).pathname)) as { version?: string };
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
