import {
  createBranch,
  createCustomKit,
  createRule,
  createForest,
  createKit,
  createLeaf,
  createTable,
  createTree,
  findNode,
  isBranch,
  text,
  walk,
  type Branch,
  type Tree,
  type TreeNode,
} from '@tree-weaver/core';
import { describe, expect, it } from 'vitest';
import {
  detectFormat,
  exportForest,
  exportMarkdown,
  exportTree,
  FORMATS,
  FormatError,
  importDocument,
  importHtml,
  importMarkdown,
  suggestFileName,
  type FormatId,
} from './index';

function sampleTree(): Tree {
  const card = (title: string) =>
    createBranch({
      tag: 'article',
      type: 'card',
      name: `Card ${title}`,
      classes: ['card'],
      styles: { lg: { padding: '1rem' }, 'mobile-portrait': { padding: '0.5rem' } },
      children: [
        createBranch({ tag: 'h2', children: [text(title)] }),
        createBranch({
          tag: 'p',
          children: [
            text('Read the '),
            createBranch({ tag: 'strong', children: [text('docs')] }),
            text(' or '),
            createBranch({ tag: 'a', attrs: { href: 'https://example.com/a?b=1&c=2' }, children: [text('visit us')] }),
            text('. Use 1 * 2 & <tags>'),
          ],
        }),
        createLeaf('https://example.com/cat.png', 'image', { alt: 'A cat' }),
      ],
    });
  const grid = createBranch({
    tag: 'section',
    type: 'grid',
    name: 'Features',
    classes: ['features', 'wide'],
    attrs: { 'aria-label': 'Features' },
    styles: {
      lg: { display: 'grid', 'grid-template-columns': 'repeat(3, minmax(0, 1fr))', gap: '1rem' },
      tablet: { 'grid-template-columns': 'repeat(2, minmax(0, 1fr))' },
      'mobile-portrait': { 'grid-template-columns': '1fr' },
      xl: { gap: '2rem' },
    },
    children: [card('One'), card('Two'), card('Three')],
  });
  const list = createBranch({
    tag: 'ul',
    children: [
      createBranch({ tag: 'li', children: [text('First')] }),
      createBranch({ tag: 'li', children: [text('Second'), createBranch({ tag: 'ol', children: [createBranch({ tag: 'li', children: [text('Nested')] })] })] }),
    ],
  });
  const table = createTable(2, 2);
  const flex = createBranch({
    tag: 'div',
    type: 'flex-row',
    styles: { lg: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap' } },
    children: [createBranch({ tag: 'button', classes: ['btn'], attrs: { type: 'button' }, children: [text('Go')] }), text('loose text')],
  });
  const tree = createTree('Home page');
  tree.root.styles = { lg: { 'background-color': '#fafafa' } };
  tree.root.children = [createBranch({ tag: 'h1', children: [text('Welcome')] }), grid, list, table, flex, createBranch({ tag: 'hr' })];
  return tree;
}

/** Comparable shape: tags, kinds, text, classes, attrs, styles (and optionally ids). */
function shape(node: TreeNode, ids: boolean): unknown {
  // Text leaves are plain text in HTML, so only branch ids are compared.
  if (!isBranch(node)) return { leaf: node.type, value: node.value, attrs: node.attrs ?? {} };
  return {
    tag: node.tag,
    type: node.type,
    name: node.name,
    classes: node.classes,
    attrs: node.attrs,
    styles: node.styles,
    ...(ids ? { id: node.id } : {}),
    children: node.children.map((c) => shape(c, ids)),
  };
}

const kit = createKit('Kit', '.card > h2 { color: rebeccapurple; } /* a & b */', 'kit.css');

describe.each(['json', 'yaml', 'xml'] as FormatId[])('%s', (format) => {
  it('round-trips a forest losslessly', () => {
    const forest = createForest('My forest', [sampleTree(), createTree('Empty')]);
    forest.kits = [kit];
    const doc = importDocument(exportForest(forest, format), format);
    expect(doc.kind).toBe('forest');
    if (doc.kind !== 'forest') return;
    expect(doc.forest).toEqual(forest);
  });

  it('round-trips a single tree with kits', () => {
    const tree = sampleTree();
    const doc = importDocument(exportTree(tree, format, [kit]), format);
    expect(doc).toEqual({ kind: 'tree', tree, kits: [kit] });
  });
});

describe('html', () => {
  it('round-trips a tree with responsive styles, kits and ids', () => {
    const tree = sampleTree();
    const html = exportTree(tree, 'html', [kit]);
    expect(html).toContain('@media (max-width: 600px) and (orientation: portrait)');
    const doc = importDocument(html, 'html');
    if (doc.kind !== 'tree') throw new Error('expected a tree');
    expect(doc.tree.id).toBe(tree.id);
    expect(doc.tree.name).toBe(tree.name);
    expect(shape(doc.tree.root, true)).toEqual(shape(tree.root, true));
    expect(doc.kits).toEqual([{ id: kit.id, name: kit.name, css: kit.css, enabled: true }]);
  });

  it('links linked kits in kit order and imports them back as linked kits', () => {
    const tree = sampleTree();
    const env = { id: 'env-1', name: 'reset', css: '', enabled: true, source: 'env', href: 'https://cdn.example.com/reset.css' };
    const linked = { id: 'k-linked', name: 'Theme', css: '.snapshot {}', enabled: true, source: 'https://cdn.example.com/theme.css', href: 'https://cdn.example.com/theme.css' };
    const html = exportTree(tree, 'html', [env, kit, linked]);
    const order = ['reset.css', `data-tw-kit="${kit.id}"`, 'theme.css'].map((needle) => html.indexOf(needle));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('<link rel="stylesheet" href="https://cdn.example.com/reset.css" data-tw-kit="env-1" data-tw-kit-name="reset" data-tw-env>');
    expect(html).not.toContain('.snapshot');
    const doc = importDocument(html, 'html');
    if (doc.kind !== 'tree') throw new Error('expected a tree');
    expect(doc.kits[0].id).not.toBe('env-1');
    expect(doc.kits.slice(1).map((k) => [k.id, k.name, k.href ?? null])).toEqual([
      [kit.id, kit.name, null],
      ['k-linked', 'Theme', 'https://cdn.example.com/theme.css'],
    ]);
    expect(doc.kits[0]).toMatchObject({ name: 'reset', href: 'https://cdn.example.com/reset.css' });
  });

  it('imports arbitrary HTML: inline styles, stylesheets, images and unsafe content', () => {
    const doc = importHtml(`<!doctype html><html><head><title>Hi</title>
      <link rel="stylesheet" href="https://cdn.example.com/kit.min.css">
      <style>.x { color: red }</style><script>alert(1)</script></head>
      <body class="page"><div style="display: grid; gap: 4px" onclick="evil()">
        <p>Hello <em>there</em> <b>friend</b></p><img src="a.png" alt="A">
      </div></body></html>`);
    if (doc.kind !== 'tree') throw new Error('expected a tree');
    expect(doc.tree.name).toBe('Hi');
    expect(doc.tree.root.classes).toEqual(['page']);
    const div = doc.tree.root.children[0] as Branch;
    expect(div.styles.lg).toEqual({ display: 'grid', gap: '4px' });
    expect(div.attrs).toEqual({});
    const p = div.children[0] as Branch;
    expect(p.children.map((c) => (isBranch(c) ? c.tag : c.value))).toEqual(['Hello ', 'em', ' ', 'b']);
    expect(div.children[1]).toMatchObject({ kind: 'leaf', type: 'image', value: 'a.png', attrs: { alt: 'A' } });
    expect(doc.kits.map((k) => k.name)).toEqual(['kit.min.css', 'Hi styles']);
    expect(doc.kits[0].href).toBe('https://cdn.example.com/kit.min.css');
    let scripts = 0;
    walk(doc.tree.root, (n) => {
      if (isBranch(n) && n.tag === 'script') scripts++;
    });
    expect(scripts).toBe(0);
  });

  it('imports a fragment without html/body', () => {
    const doc = importHtml('<section><h1>Title</h1></section>');
    if (doc.kind !== 'tree') throw new Error('expected a tree');
    expect((doc.tree.root.children[0] as Branch).tag).toBe('section');
  });
});

describe('markdown', () => {
  it('writes readable markdown', () => {
    const md = exportMarkdown(sampleTree());
    expect(md).toMatch(/^---\ntree-weaver: 1\n/);
    expect(md).toContain('# Welcome');
    expect(md).toContain('## One');
    expect(md).toContain('Read the **docs** or [visit us](https://example.com/a?b=1&c=2)');
    expect(md).toContain('1 \\* 2 &amp; \\<tags\\>');
    expect(md).toContain('![A cat](https://example.com/cat.png)');
    expect(md).toContain('- First\n- Second\n   1. Nested');
    expect(md).toContain('| Heading 1 | Heading 2 |\n| --- | --- |');
    expect(md).toContain('<!-- tw:branch {"tag":"section"');
  });

  it('round-trips layout, styles and content', () => {
    const tree = sampleTree();
    const doc = importMarkdown(exportMarkdown(tree, { kits: [kit] }));
    if (doc.kind !== 'tree') throw new Error('expected a tree');
    expect(doc.tree.id).toBe(tree.id);
    expect(doc.kits).toEqual([kit]);
    expect(doc.tree.root.styles).toEqual(tree.root.styles);
    // Layout branches keep their ids and every detail.
    for (const id of [tree.root.children[1].id, tree.root.children[4].id]) {
      expect(shape(findNode(doc.tree.root, id)!, false)).toEqual(shape(findNode(tree.root, id)!, false));
    }
    // Content comes back with the same structure (ids of plain content are regenerated).
    expect(shape(doc.tree.root, false)).toEqual(shape(tree.root, false));
  });

  it('imports plain markdown from elsewhere', () => {
    const doc = importMarkdown('# Notes\n\nSome *text*.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
    if (doc.kind !== 'tree') throw new Error('expected a tree');
    expect(doc.tree.name).toBe('Notes');
    expect((doc.tree.root.children as Branch[]).map((b) => b.tag)).toEqual(['h1', 'p', 'table']);
  });
});

describe('detection and helpers', () => {
  it('detects formats from names and content', () => {
    expect(detectFormat('', 'a.YML')).toBe('yaml');
    expect(detectFormat('<?xml version="1.0"?><tree-weaver/>')).toBe('xml');
    expect(detectFormat('<!doctype html><p>')).toBe('html');
    expect(detectFormat('{"format":"tree-weaver"}')).toBe('json');
    expect(detectFormat('format: tree-weaver\nversion: 1\n')).toBe('yaml');
    expect(detectFormat('# Hello')).toBe('markdown');
  });

  it('rejects forests in single-tree formats and bad input', () => {
    expect(() => exportForest(createForest(), 'html')).toThrow(FormatError);
    expect(() => importDocument('{nope', 'json')).toThrow(/Invalid JSON/);
    expect(() => importDocument('{"format":"other"}', 'json')).toThrow(/Unsupported document format/);
    expect(() => importDocument('<other/>', 'xml')).toThrow(FormatError);
  });

  it('suggests file names', () => {
    expect(suggestFileName('Home Page!', 'tree', 'json')).toBe('home-page.tree.json');
    expect(suggestFileName('Site', 'forest', 'yaml')).toBe('site.forest.yaml');
    expect(suggestFileName('Site', 'tree', 'markdown')).toBe('site.md');
    expect(FORMATS.map((f) => f.id)).toEqual(['json', 'yaml', 'xml', 'html', 'markdown']);
  });
});

describe('custom classes and selectors', () => {
  const custom = createCustomKit('Custom styles', [
    createRule('.card', { lg: { padding: '2rem' }, tablet: { padding: '1rem' } }),
    createRule('nav a:hover', { lg: { color: 'red' } }),
  ]);
  const tree = createTree('Home');

  it.each(['json', 'yaml', 'xml', 'html', 'markdown'] as FormatId[])('round-trips an editable kit through %s', (format) => {
    const doc = importDocument(exportTree(tree, format, [custom]), format);
    if (doc.kind !== 'tree') throw new Error('expected a tree');
    const kit = doc.kits.find((k) => k.id === custom.id);
    expect(kit?.rules?.map((r) => [r.selector, r.styles])).toEqual(custom.rules!.map((r) => [r.selector, r.styles]));
    expect(kit?.css).toBe(custom.css);
  });

  it('keeps editable kits in forest exports', () => {
    const forest = { ...createForest('Site', [tree]), kits: [custom] };
    for (const format of ['json', 'yaml', 'xml'] as FormatId[]) {
      const doc = importDocument(exportForest(forest, format), format);
      if (doc.kind !== 'forest') throw new Error('expected a forest');
      expect(doc.forest.kits[0].rules?.map((r) => r.selector)).toEqual(['.card', 'nav a:hover']);
    }
  });
});
