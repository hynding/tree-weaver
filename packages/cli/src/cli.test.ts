import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run, type CliIO } from './run';

const example = (name: string) => readFileSync(fileURLToPath(new URL(`../../../examples/${name}`, import.meta.url)), 'utf8');

/** An in-memory file system and captured output. */
function memoryIO(files: Record<string, string> = {}, stdin = '') {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = {
    async readFile(path) {
      if (path.endsWith('package.json')) return readFileSync(path, 'utf8');
      if (!(path in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files[path];
    },
    async writeFile(path, data) {
      files[path] = data;
    },
    readStdin: async () => stdin,
    stdout: (t) => void out.push(t),
    stderr: (t) => void err.push(t),
  };
  return { io, files, out: () => out.join(''), err: () => err.join('') };
}

async function cli(argv: string[], files: Record<string, string> = {}, stdin = '') {
  const m = memoryIO(files, stdin);
  const code = await run(argv, m.io);
  return { code, files: m.files, out: m.out(), err: m.err() };
}

describe('tree-weaver CLI', () => {
  it('prints help and the version', async () => {
    expect((await cli(['--help'])).out).toContain('Usage: tree-weaver <command>');
    expect((await cli([])).code).toBe(2);
    expect((await cli(['add', '--help'])).out).toContain('--parent');
    expect((await cli(['--version'])).out).toMatch(/^\d+\.\d+\.\d+/);
    const bad = await cli(['grow']);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('unknown command "grow"');
  });

  it('creates a tree from a template, with the starter kit, that validates', async () => {
    const r = await cli(['new', 'home.tree.json', '--template', 'landing', '--name', 'Home']);
    expect(r.code).toBe(0);
    const doc = JSON.parse(r.files['home.tree.json']);
    expect(doc.format).toBe('tree-weaver');
    expect(doc.tree.name).toBe('Home');
    expect(doc.kits[0].name).toBe('Weaver Basic');
    expect((await cli(['validate', 'home.tree.json'], r.files)).code).toBe(0);
  });

  it('creates forests in forest formats and lists templates', async () => {
    const r = await cli(['new', 'site.forest.yaml', '--forest', '--bare', '-n', 'Site']);
    expect(r.files['site.forest.yaml']).toMatch(/^forest:/m);
    expect(r.files['site.forest.yaml']).toContain('kits: []');
    const list = await cli(['new', '--list', '--json']);
    expect(JSON.parse(list.out).map((t: { id: string }) => t.id)).toContain('blank');
    const stdout = await cli(['new', '-T', 'drawing', '-f', 'svg']);
    expect(stdout.out).toContain('<svg');
  });

  it('validates every example and reports issues with paths and hints', async () => {
    const files = { 'a.json': example('landing-page.tree.json'), 'b.json': example('site.forest.json') };
    const ok = await cli(['validate', 'a.json', 'b.json', '--json'], files);
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.out).valid).toBe(true);

    const bad = await cli(['validate', '-', '--json'], {}, '{ "format": "tree-weaver", "version": 1, "tree": { "root": { "tag": "body", "children": [{ "tag": "script" }] } } }');
    expect(bad.code).toBe(1);
    const report = JSON.parse(bad.out);
    expect(report.valid).toBe(false);
    expect(report.files[0].errors[0]).toMatchObject({ path: 'tree.root.children[0].tag' });
    expect(report.files[0].errors[0].hint).toBeTruthy();

    const human = await cli(['validate', 'x.json'], { 'x.json': '{ "tree": ' });
    expect(human.code).toBe(1);
    expect(human.out).toContain('INVALID x.json');
  });

  it('treats warnings as errors with --strict', async () => {
    const files = { 't.json': '{ "tree": { "root": { "tag": "body", "children": ["Hi"] } } }' };
    expect((await cli(['validate', 't.json'], files)).code).toBe(0);
    expect((await cli(['validate', 't.json', '--strict'], files)).code).toBe(1);
  });

  it('renders a standalone HTML page, adding CSS files as kits', async () => {
    const files = { 'p.json': example('pricing-table.tree.json'), 'brand.css': '.brand-x { color: red }' };
    const r = await cli(['render', 'p.json', '-o', 'out/p.html', '--kit', 'brand.css'], files);
    expect(r.code).toBe(0);
    expect(r.files['out/p.html']).toMatch(/^<!doctype html>/i);
    expect(r.files['out/p.html']).toContain('.brand-x');
    expect(r.files['out/p.html']).toContain('<table');
  });

  it('picks a tree of a forest by name or number, and says when it picked the first', async () => {
    const files = { 's.json': example('site.forest.json') };
    const first = await cli(['render', 's.json'], files);
    expect(first.err).toContain('Using the first of 2 trees');
    const second = await cli(['render', 's.json', '--tree', '2'], files);
    expect(second.err).toBe('');
    expect(second.out).not.toBe(first.out);
    const missing = await cli(['render', 's.json', '--tree', 'Nope'], files);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('Trees: 1.');
  });

  it('converts between formats and round-trips through JSON', async () => {
    const files: Record<string, string> = { 'l.json': example('landing-page.tree.json') };
    await cli(['convert', 'l.json', '-o', 'l.tree.yaml'], files);
    expect(files['l.tree.yaml']).toMatch(/^format: tree-weaver/m);
    await cli(['convert', 'l.tree.yaml', '--to', 'xml', '-o', 'l.xml'], files);
    await cli(['convert', 'l.xml', '--to', 'json', '-o', 'back.json'], files);
    const before = JSON.parse((await cli(['convert', 'l.tree.yaml', '--to', 'json'], files)).out);
    const after = JSON.parse(files['back.json']);
    expect(after.tree.root).toEqual(before.tree.root);

    const forest = await cli(['convert', '-', '--to', 'yaml'], {}, example('site.forest.json'));
    expect(forest.out).toMatch(/^forest:/m);
    const noTarget = await cli(['convert', 'l.json'], files);
    expect(noTarget.code).toBe(2);
  });

  it('adds a blueprint under a parent given by path, in place', async () => {
    const files: Record<string, string> = { 'm.json': example('minimal.tree.json') };
    await cli(['convert', 'm.json', '-o', 'm.json', '--to', 'json'], files); // give it ids
    const r = await cli(['add', 'm.json', 'card', '--parent', '/0', '--index', '0', '--json'], files);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.out);
    expect(report.path).toBe('/0/0');
    const doc = JSON.parse(files['m.json']);
    expect(doc.tree.root.children[0].children[0].id).toBe(report.id);
    expect(doc.tree.root.children[0].children[0].classes).toContain('card');

    const byId = await cli(['add', 'm.json', 'h2', '--parent', report.id], files);
    expect(byId.code).toBe(0);
    expect(JSON.parse(files['m.json']).tree.root.children[0].children[0].children.at(-1).tag).toBe('h2');
  });

  it('adds a JSON node, rejecting invalid ones with fix hints', async () => {
    const files: Record<string, string> = { 'm.json': example('minimal.tree.json') };
    const r = await cli(['add', 'm.json', '--node', '{ "tag": "p", "classes": ["lead"], "children": ["Hello"] }', '--index=-1'], files);
    expect(r.code).toBe(0);
    const root = JSON.parse(files['m.json']).tree.root;
    expect(root.children.at(-1)).toMatchObject({ tag: 'p', classes: ['lead'] });

    const bad = await cli(['add', 'm.json', '--node', '{ "tag": "iframe" }'], files);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('node.tag');
    expect((await cli(['add', 'm.json', 'card', '--node', '{}'], files)).code).toBe(2);
    expect((await cli(['add', 'm.json', 'nope'], files)).code).toBe(2);
  });

  it('refuses to add inside a leaf or a void branch', async () => {
    const files: Record<string, string> = {};
    await cli(['new', 'n.json', '-T', 'article'], files);
    const leafPath = (JSON.stringify(JSON.parse((await cli(['outline', 'n.json', '--json'], files)).out)).match(/"path":"([^"]+)","id":"[^"]+","kind":"leaf"/) ?? [])[1];
    const r = await cli(['add', 'n.json', 'card', '-p', leafPath], files);
    expect(r.code).toBe(1);
    expect(r.err).toContain("can't hold children");
  });

  it('adds to a chosen tree of a forest and keeps the other trees', async () => {
    const files: Record<string, string> = { 's.json': example('site.forest.json') };
    await cli(['add', 's.json', 'divider', '--tree', '2'], files);
    const forest = JSON.parse(files['s.json']).forest;
    expect(forest.trees).toHaveLength(2);
    expect(forest.trees[1].root.children.at(-1).tag).toBe('hr');
    expect(forest.trees[0].root.children.at(-1).tag).not.toBe('hr');
  });

  it('outlines trees with paths and ids', async () => {
    const files = { 's.json': example('site.forest.json') };
    const text = await cli(['outline', 's.json'], files);
    expect(text.out).toMatch(/^forest "/);
    expect(text.out).toMatch(/\/0 {2}<\w+>/);
    const json = JSON.parse((await cli(['outline', 's.json', '--json'], files)).out);
    expect(json.trees).toHaveLength(2);
    expect(json.trees[0].root.path).toBe('/');
  });

  it('lists kit classes from CSS files and documents, and prints the schema', async () => {
    const files = { 'k.css': ':root { --brand: #0a7 } .hero { color: var(--brand) }', 's.json': example('site.forest.json') };
    const kit = JSON.parse((await cli(['kit', 'k.css'], files)).out);
    expect(kit.classes).toContain('hero');
    expect(kit.tokens).toEqual([{ name: '--brand', value: '#0a7' }]);
    expect(JSON.parse((await cli(['kit', 's.json'], files)).out).kits.length).toBeGreaterThan(0);
    const schema = JSON.parse((await cli(['schema'])).out);
    expect(schema.$schema).toContain('2020-12');
  });

  it('reports errors as JSON with --json and bad flags as usage errors', async () => {
    const missing = await cli(['render', 'nope.json', '--json']);
    expect(missing.code).toBe(1);
    expect(JSON.parse(missing.out)).toEqual({ ok: false, error: 'nope.json: no such file' });
    const flag = await cli(['render', 'x.json', '--colour']);
    expect(flag.code).toBe(2);
    expect(flag.err).toContain('--colour');
  });
});
