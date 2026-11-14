import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { createServer } from './server';

const example = (name: string) => readFileSync(new URL(`../../../examples/${name}`, import.meta.url), 'utf8');

let root: string;

async function connect(readOnly = false) {
  const server = createServer({ root, readOnly });
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as {
      content: { type: string; text?: string; data?: string }[];
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
    };
    const text = res.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    return { ...res, text };
  };
  return { client, call };
}

const file = (name: string) => JSON.parse(readFileSync(join(root, name), 'utf8'));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tw-mcp-'));
});

describe('Tree Weaver MCP server', () => {
  it('lists its tools, resources and prompt, with instructions', async () => {
    const { client } = await connect();
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['create_tree', 'outline', 'patch_tree', 'validate', 'render_html', 'convert', 'screenshot', 'catalog', 'kit_manifest']));
    expect(client.getInstructions()).toContain('patch_tree');
    const resources = (await client.listResources()).resources.map((r) => r.uri);
    expect(resources).toContain('tree-weaver://schema/document');
    const schema = await client.readResource({ uri: 'tree-weaver://schema/patch' });
    expect(JSON.parse((schema.contents[0] as { text: string }).text).$schema).toContain('2020-12');
    const guide = await client.readResource({ uri: 'tree-weaver://guide/shorthand' });
    expect((guide.contents[0] as { text: string }).text).toContain('# Authoring shorthand');
    const prompt = await client.getPrompt({ name: 'build_layout', arguments: { brief: 'A bakery home page' } });
    expect(JSON.stringify(prompt.messages)).toContain('A bakery home page');
  });

  it('creates a tree from a template and refuses to overwrite it', async () => {
    const { call } = await connect();
    const r = await call('create_tree', { path: 'home.tree.json', template: 'landing', name: 'Home' });
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain('Created tree "Home" in home.tree.json');
    expect(r.text).toMatch(/\/0 {2}<header>/);
    expect(file('home.tree.json').kits[0].name).toBe('Weaver Basic');
    const again = await call('create_tree', { path: 'home.tree.json' });
    expect(again.isError).toBe(true);
    expect(again.text).toContain('already exists');
  });

  it('creates a tree from shorthand, as a list or as text', async () => {
    const { call } = await connect();
    const r = await call('create_tree', { path: 'p.tree.json', name: 'Promo', shorthand: ['h1: Hello', { grid: 3, children: ['@card', '@card', '@card'] }] });
    expect(r.isError).toBeFalsy();
    const doc = file('p.tree.json');
    expect(doc.tree.name).toBe('Promo');
    expect(doc.tree.root.children[0].tag).toBe('h1');
    expect(doc.tree.root.children[1].children).toHaveLength(3);
    const yaml = await call('create_tree', { shorthand: '- "h2: From YAML"\n- p: Some text\n' });
    expect(yaml.text).toContain('"tag": "h2"');
    const bad = await call('create_tree', { shorthand: [{ tag: 'iframe' }] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('errors');
  });

  it('outlines and patches a file in place, all or nothing', async () => {
    const { call } = await connect();
    writeFileSync(join(root, 'site.forest.json'), example('site.forest.json'));
    const outline = await call('outline', { path: 'site.forest.json' });
    expect(outline.text).toMatch(/^forest "/);
    expect((outline.structuredContent!.trees as unknown[]).length).toBe(2);

    const r = await call('patch_tree', {
      path: 'site.forest.json',
      tree: '2',
      ops: [
        { op: 'insert', parent: '/', node: 'h2: Added by an agent' },
        { op: 'setStyles', target: '/', styles: { padding: '2rem', tablet: { padding: '1rem' } } },
      ],
    });
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain('Applied 2 operations');
    const forest = file('site.forest.json').forest;
    expect(forest.trees).toHaveLength(2);
    expect(forest.trees[1].root.children.at(-1).tag).toBe('h2');
    expect(forest.trees[1].root.styles.tablet.padding).toBe('1rem');

    const before = readFileSync(join(root, 'site.forest.json'), 'utf8');
    const bad = await call('patch_tree', { path: 'site.forest.json', ops: [{ op: 'insert', node: 'p: ok' }, { op: 'remove', target: '/99' }] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('Nothing was changed');
    expect(readFileSync(join(root, 'site.forest.json'), 'utf8')).toBe(before);
  });

  it('patches an inline document and supports dry runs', async () => {
    const { call } = await connect();
    const doc = example('minimal.tree.json');
    const r = await call('patch_tree', { document: doc, ops: '[{"op":"insert","node":"@divider"}]' });
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain('"tag": "hr"');
    writeFileSync(join(root, 'm.json'), doc);
    const dry = await call('patch_tree', { path: 'm.json', ops: [{ op: 'insert', node: 'p: hi' }], dryRun: true });
    expect(dry.text).toContain('Nothing was written');
    expect(readFileSync(join(root, 'm.json'), 'utf8')).toBe(doc);
  });

  it('validates with paths and hints', async () => {
    const { call } = await connect();
    const ok = await call('validate', { document: example('landing-page.tree.json') });
    expect(ok.structuredContent!.valid).toBe(true);
    const bad = await call('validate', { document: '{"tree":{"root":{"tag":"body","children":[{"tag":"script"}]}}}' });
    expect(bad.structuredContent!.valid).toBe(false);
    expect(bad.text).toContain('tree.root.children[0].tag');
    expect(bad.text).toContain('Fix:');
  });

  it('renders HTML and converts formats', async () => {
    const { call } = await connect();
    writeFileSync(join(root, 'p.json'), example('pricing-table.tree.json'));
    const html = await call('render_html', { path: 'p.json', output: 'out/p.html' });
    expect(html.text).toContain('Wrote out/p.html');
    expect(readFileSync(join(root, 'out/p.html'), 'utf8')).toMatch(/^<!doctype html>/i);
    const yaml = await call('convert', { path: 'p.json', to: 'yaml' });
    expect(yaml.text).toMatch(/format: tree-weaver/);
    const md = await call('convert', { path: 'p.json', to: 'markdown' });
    expect(md.text).toContain('keeps the content but not every style');
  });

  it('lists the catalog and kit classes', async () => {
    const { call } = await connect();
    expect((await call('catalog', { kind: 'blueprints' })).text).toContain('- card');
    expect((await call('catalog', { kind: 'displays' })).text).toContain('mobile-portrait');
    writeFileSync(join(root, 'brand.css'), ':root { --brand: #0a7 } .hero-x { color: var(--brand) }');
    const kit = await call('kit_manifest', { paths: ['brand.css'] });
    expect(kit.structuredContent!.classes).toContain('hero-x');
  });

  it('keeps every path inside the workspace', async () => {
    const { call } = await connect();
    const outside = await call('outline', { path: '../etc/passwd' });
    expect(outside.isError).toBe(true);
    expect(outside.text).toContain('outside the workspace');
    expect((await call('outline', { path: '/etc/hostname' })).text).toContain('outside the workspace');
    symlinkSync(tmpdir(), join(root, 'escape'));
    expect((await call('create_tree', { path: 'escape/x.tree.json' })).text).toContain('outside the workspace');
  });

  it('writes nothing in read-only mode', async () => {
    const { call } = await connect(true);
    const r = await call('create_tree', { path: 'x.tree.json' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('read-only');
    expect((await call('create_tree', { template: 'blank' })).text).toContain('"format": "tree-weaver"');
  });

  // Screenshots need Playwright and a Chromium build; skip where the machine has neither.
  const canScreenshot = (() => {
    try {
      createRequire(import.meta.url)('playwright');
    } catch {
      return false;
    }
    if (!process.env.TW_CHROMIUM_PATH && existsSync('/opt/pw-browsers/chromium')) process.env.TW_CHROMIUM_PATH = '/opt/pw-browsers/chromium';
    return !!process.env.TW_CHROMIUM_PATH || !!process.env.PLAYWRIGHT_BROWSERS_PATH;
  })();

  it.runIf(canScreenshot)('screenshots each display as a PNG', { timeout: 60000 }, async () => {
    const { call } = await connect();
    const r = await call('screenshot', { document: example('landing-page.tree.json'), displays: ['lg', 'mobile-portrait'] });
    expect(r.isError, r.text).toBeFalsy();
    const images = r.content.filter((c) => c.type === 'image');
    expect(images).toHaveLength(2);
    expect(Buffer.from(images[0].data!, 'base64').subarray(1, 4).toString()).toBe('PNG');
    expect(r.text).toContain('mobile-portrait: 390px wide');
  });
});
