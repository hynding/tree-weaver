import { createBranch, createComponent, createForest, createLeaf, createTree, instantiateComponent, text, type Branch, type TreeNode } from '@tree-weaver/core';
import { describe, expect, it } from 'vitest';
import { exportComponent, exportComponentDef, exportForest, exportTree, importDocument } from './index';

const page = (children: Branch['children']) => createTree('Home', createBranch({ tag: 'body', type: 'root', children }));

describe('XML keeps everything', () => {
  it('round-trips components, instance links and text-leaf attrs', () => {
    const card = createComponent('Card', createBranch({ tag: 'div', children: [text('{{title}}')] }));
    const inst = instantiateComponent(card, { title: 'Hi' });
    const leaf = { ...text('Bonjour'), attrs: { lang: 'fr' } };
    const tree = page([inst, createBranch({ tag: 'p', children: [leaf] })]);
    const forest = { ...createForest('Site', [tree]), components: [card] };
    const back = importDocument(exportForest(forest, 'xml'), 'xml');
    expect(back.kind).toBe('forest');
    if (back.kind !== 'forest') return;
    expect(back.forest.components?.[0].id).toBe(card.id);
    const root = back.forest.trees[0].root;
    expect((root.children[0] as Branch).instance).toEqual(inst.instance);
    expect(((root.children[1] as Branch).children[0] as { attrs?: Record<string, string> }).attrs).toEqual({ lang: 'fr' });
  });
});

describe('component exports', () => {
  it('escapes every brace in Vue text so no interpolation can form', () => {
    const tree = page([createBranch({ tag: 'p', children: [text('{{{constructor.constructor("alert(1)")()}}')] }), createBranch({ tag: 'p', children: [text('a{'), text('{x}}')] })]);
    const vue = exportComponent(tree, { framework: 'vue' }).files[0].contents;
    expect(vue).not.toContain('{{');
    expect(vue).toContain('&#123;&#123;&#123;constructor');
  });

  it('ignores data-show-if on a component root, like the editor', () => {
    const def = createComponent('Tag', createBranch({ tag: 'span', attrs: { 'data-show-if': 'visible' }, children: [text('x')] }));
    const jsx = exportComponentDef(def, { framework: 'react' }).files[0].contents;
    expect(jsx).not.toContain('visible &&');
    expect(jsx).toMatch(/return \(\n\s+<span/);
  });

  it('declares the variant prop once', () => {
    const root = createBranch({ tag: 'div', children: [text('{{variant}}')] });
    const def = createComponent('Box', root, { variants: [{ name: 'Big', styles: { [root.id]: { lg: { padding: '2rem' } } } }] });
    const jsx = exportComponentDef(def, { framework: 'react' }).files[0].contents;
    expect(jsx.match(/variant = /g)).toHaveLength(1);
  });

  it('refuses props named after reserved words', () => {
    const def = createComponent('Bad', createBranch({ tag: 'div', children: [text('{{class}}')] }));
    expect(() => exportComponentDef(def, { framework: 'svelte' })).toThrow(/reserved in JavaScript/);
  });
});

describe('comments and markdown', () => {
  it('keeps SVG and kit comments well formed', () => {
    const svg = exportTree(createTree('Logo --- v2', createBranch({ tag: 'svg', type: 'root' })), 'svg');
    const comment = svg.slice(svg.indexOf('<!--') + 4, svg.indexOf('-->'));
    expect(comment).not.toContain('--');
    const tree = page([createBranch({ tag: 'p', styles: { lg: { color: 'red' } }, children: [text('x')] })]);
    const css = exportComponent(tree, { framework: 'react', kits: [{ id: 'k', name: 'a**//b', css: 'p{}', enabled: true }] }).files.find((f) => f.path === 'kits.css')!.contents;
    expect(css).toContain('/* ab */');
  });

  it('round-trips code with backticks, odd list starts, closing hashes and URLs', () => {
    const tree = page([
      createBranch({ tag: 'p', children: [createBranch({ tag: 'code', children: [text('a``b')] })] }),
      createBranch({ tag: 'ol', attrs: { start: 'x' }, children: [createBranch({ tag: 'li', children: [text('one')] })] }),
      createBranch({ tag: 'h2', children: [text('C #')] }),
      createBranch({ tag: 'p', children: [text('see https://example.com or www.example.com')] }),
    ]);
    const md = exportTree(tree, 'markdown');
    const back = importDocument(md, 'markdown');
    if (back.kind !== 'tree') throw new Error('expected a tree');
    const kids = back.tree.root.children as Branch[];
    expect((kids[0].children[0] as Branch).tag).toBe('code');
    expect(((kids[0].children[0] as Branch).children[0] as { value: string }).value).toBe('a``b');
    expect(kids[1].tag).toBe('ol');
    expect((kids[2].children[0] as { value: string }).value).toBe('C #');
    expect(kids[3].children).toHaveLength(1);
    expect((kids[3].children[0] as { value: string }).value).toBe('see https://example.com or www.example.com');
  });
});

describe('pass 3 fixes', () => {
  it('keeps Vue from rendering elements named by `is` or <component>', () => {
    const tree = importDocument('<body><component is="script" src="https://evil.example/x.js"></component><div is="vue:script">window.x=1</div></body>', 'html');
    if (tree.kind !== 'tree') throw new Error('expected a tree');
    const vue = exportComponent(tree.tree, { framework: 'vue' }).files[0].contents;
    expect(vue).not.toMatch(/<component|\bis=/);
  });

  it('keeps carriage returns and tabs through XML', () => {
    const tree = page([createBranch({ tag: 'p', name: 'a\r\nb\tc', attrs: { title: 'x\ry' }, children: [text('l1\r\nl2')] })]);
    const back = importDocument(exportTree(tree, 'xml'), 'xml');
    if (back.kind !== 'tree') throw new Error('expected a tree');
    const p = back.tree.root.children[0] as Branch;
    expect(p.name).toBe('a\r\nb\tc');
    expect(p.attrs.title).toBe('x\ry');
    expect((p.children[0] as { value: string }).value).toBe('l1\r\nl2');
  });

  it('keeps email addresses as text through Markdown', () => {
    const md = exportTree(page([createBranch({ tag: 'p', children: [text('mail me at foo@bar.com today')] })]), 'markdown');
    const back = importDocument(md, 'markdown');
    if (back.kind !== 'tree') throw new Error('expected a tree');
    const p = back.tree.root.children[0] as Branch;
    expect(p.children).toHaveLength(1);
    expect((p.children[0] as { value: string }).value).toBe('mail me at foo@bar.com today');
  });
});

describe('pass 4 fixes', () => {
  const jsxOf = (children: Branch['children']) => exportComponent(page(children), { framework: 'react' }).files[0].contents;

  it('writes empty non-boolean attributes as "" in JSX', () => {
    const jsx = jsxOf([createBranch({ tag: 'div', attrs: { 'data-state': '', 'aria-label': '' }, children: [createBranch({ tag: 'input', attrs: { disabled: '' } })] })]);
    expect(jsx).toContain('data-state=""');
    expect(jsx).toContain('aria-label=""');
    expect(jsx).toMatch(/<input disabled \/>/);
  });

  it('keeps line breaks in JSX text', () => {
    const jsx = jsxOf([createBranch({ tag: 'pre', children: [text('a\n  b')] })]);
    expect(jsx).toContain('{"a\\n  b"}');
  });

  it('drops attribute names JSX cannot hold and keeps form fields editable', () => {
    const jsx = jsxOf([createBranch({ tag: 'input', attrs: { 'data-foo.bar': '1', value: 'x', type: 'checkbox', checked: '' } })]);
    expect(jsx).not.toContain('data-foo.bar');
    expect(jsx).toContain('defaultValue="x"');
    expect(jsx).toContain('defaultChecked');
  });

  it('keeps SVG tree names through a round trip', () => {
    const back = importDocument(exportTree(createTree('Header /* draft */', createBranch({ tag: 'svg', type: 'root' })), 'svg'), 'svg');
    if (back.kind !== 'tree') throw new Error('expected a tree');
    expect(back.tree.name).toBe('Header /* draft */');
  });
});

describe('pass 5 fixes', () => {
  it('checks URL attributes with placeholders filled, in component exports', () => {
    const link = createBranch({ tag: 'a', attrs: { href: 'java{{x}}script:alert(1)' }, children: [text('a')] });
    const link2 = createBranch({ tag: 'a', attrs: { href: '{{url}}' }, children: [text('b')] });
    const ok = createBranch({ tag: 'a', attrs: { href: '/p/{{slug}}' }, children: [text('c')] });
    const def = createComponent('L', createBranch({ tag: 'div', children: [link, link2, ok] }), { props: [{ name: 'url', type: 'text', default: 'javascript:alert(2)' }] });
    for (const framework of ['react', 'vue', 'svelte'] as const) {
      const out = exportComponentDef(def, { framework }).files[0].contents;
      expect(out).not.toMatch(/java\$?\{?x\}?script/);
      expect(out).not.toMatch(/href=\{?url\}?|:href="url"/);
      expect(out).toContain('slug');
    }
  });

  it('keeps token kinds, descriptions and rule ids through XML', () => {
    const f = createForest('F', [createTree('T')]);
    f.kits = [
      { id: 'kt', name: 'Tokens', css: ':root { --brand: #f00; }', enabled: true, source: 'tokens', tokens: [{ name: '--brand', value: '#f00', kind: 'color', description: 'Brand colour' }] },
      { id: 'kr', name: 'Rules', css: '.a { color: red; }', enabled: true, rules: [{ id: 'r_keep', selector: '.a', styles: { lg: { color: 'red' } } }] },
    ];
    const back = importDocument(exportForest(f, 'xml'), 'xml');
    if (back.kind !== 'forest') throw new Error('expected a forest');
    expect(back.forest.kits[0].tokens?.[0]).toMatchObject({ kind: 'color', description: 'Brand colour' });
    expect(back.forest.kits[1].rules?.[0].id).toBe('r_keep');
    expect(back.forest.kits[1].css).toContain('.a');
  });

  it('keeps native type names apart from DesignTokens', () => {
    const f = createForest('F', [createTree('Design Tokens')]);
    f.kits = [{ id: 'kt', name: 'Tokens', css: '', enabled: true, source: 'tokens', tokens: [{ name: '--brand', value: '#f00', kind: 'color' }] }];
    for (const framework of ['swiftui', 'flutter'] as const) {
      const paths = exportComponent(f.trees[0], { framework, kits: f.kits }).files.map((x) => x.path);
      expect(new Set(paths).size).toBe(paths.length);
    }
  });

  it('round-trips Markdown links with parentheses and reads JSON with a BOM', () => {
    const tree = page([createBranch({ tag: 'p', children: [createBranch({ tag: 'a', attrs: { href: '/a(b' }, children: [text('L')] })] })]);
    const back = importDocument(exportTree(tree, 'markdown'), 'markdown');
    if (back.kind !== 'tree') throw new Error('expected a tree');
    const a = (back.tree.root.children[0] as Branch).children[0] as Branch;
    expect(a.attrs.href).toBe('/a(b');
    expect(importDocument(`﻿${exportTree(tree, 'json')}`, 'json').kind).toBe('tree');
  });
});

describe('pass 6 fixes', () => {
  it('writes SwiftUI text verbatim so Markdown in content stays text', () => {
    const swift = exportComponent(page([createBranch({ tag: 'p', children: [text('[Reset](https://evil.example) *now*')] })]), { framework: 'swiftui' }).files[0].contents;
    expect(swift).toContain('Text(verbatim: "[Reset](https://evil.example) *now*")');
  });
});

describe('pass 7 fixes', () => {
  it('keeps backslashes before parentheses in Markdown link targets', () => {
    const tree = page([createBranch({ tag: 'p', children: [createBranch({ tag: 'a', attrs: { href: 'C:\\dir\\(x)' }, children: [text('go')] })] })]);
    const back = importDocument(exportTree(tree, 'markdown'), 'markdown');
    if (back.kind !== 'tree') throw new Error('expected a tree');
    expect(((back.tree.root.children[0] as Branch).children[0] as Branch).attrs.href).toBe('C:%5Cdir%5C(x)'); // the Markdown parser percent-encodes backslashes
  });

  it('round-trips an SVG tree name, the root without xmlns, and an unnamed root', () => {
    const tree = createTree('My -- drawing', createBranch({ tag: 'svg', type: 'root', attrs: { viewBox: '0 0 10 10' } }));
    const back = importDocument(exportTree(tree, 'svg'), 'svg');
    if (back.kind !== 'tree') throw new Error('expected a tree');
    expect(back.tree.name).toBe('My -- drawing');
    expect(back.tree.root.attrs.xmlns).toBeUndefined();
    expect(back.tree.root.name).toBeUndefined();
    const withNs = createTree('N', createBranch({ tag: 'svg', type: 'root', attrs: { xmlns: 'http://www.w3.org/2000/svg' } }));
    const back2 = importDocument(exportTree(withNs, 'svg'), 'svg');
    if (back2.kind !== 'tree') throw new Error('expected a tree');
    expect(back2.tree.root.attrs.xmlns).toBe('http://www.w3.org/2000/svg');
  });
});

describe('pass 8 fixes', () => {
  const md = (tree: ReturnType<typeof page>) => exportTree(tree, 'markdown');
  const reimport = (tree: ReturnType<typeof page>) => {
    const back = importDocument(md(tree), 'markdown');
    if (back.kind !== 'tree') throw new Error('expected a tree');
    return back.tree;
  };

  it('keeps image alt text inside the image syntax', () => {
    const img = createLeaf('cat.png', 'image', { alt: 'a\\](javascript:alert(1)) <img src=x onerror=alert(2)>' });
    const tree = page([createBranch({ tag: 'p', children: [img] })]);
    const p = reimport(tree).root.children[0] as Branch;
    expect(p.children).toHaveLength(1);
    expect(p.children[0]).toMatchObject({ type: 'image', value: 'cat.png', attrs: { alt: 'a\\](javascript:alert(1)) <img src=x onerror=alert(2)>' } });
  });

  it('keeps line breaks in code spans, titles, links and inline HTML from ending the paragraph', () => {
    const code = createBranch({ tag: 'code', children: [text('x\n\n<img src=x onerror=alert(1)>\n\ny')] });
    const link = createBranch({ tag: 'a', attrs: { href: '/a\n\n# b', title: 't\n\n<img src=y>\\' }, children: [text('L')] });
    const span = createBranch({ tag: 'span', classes: ['k'], children: [text('x\n\n# Injected heading\n\ny')] });
    const tree = page([createBranch({ tag: 'p', children: [code, text(' '), link, text(' '), span] })]);
    const back = reimport(tree);
    expect(back.root.children).toHaveLength(1);
    expect(JSON.stringify(back.root)).not.toContain('"type":"image"');
  });

  it('fences code with more backticks than it holds', () => {
    const body = 'a ``` b\n~~~~\n<img src=x onerror=alert(2)>\n~~~~';
    const tree = page([createBranch({ tag: 'pre', children: [createBranch({ tag: 'code', children: [text(body)] })] })]);
    const back = reimport(tree).root.children;
    expect(back).toHaveLength(1);
    expect((((back[0] as Branch).children[0] as Branch).children[0] as { value: string }).value.trimEnd()).toBe(body);
  });

  it('keeps a | in a code span or link inside one table cell', () => {
    const row = (tag: 'th' | 'td', a: TreeNode, b: TreeNode) => createBranch({ tag: 'tr', children: [createBranch({ tag, children: [a] }), createBranch({ tag, children: [b] })] });
    const table = createBranch({
      tag: 'table',
      children: [
        createBranch({ tag: 'thead', children: [row('th', text('A'), text('B'))] }),
        createBranch({ tag: 'tbody', children: [row('td', createBranch({ tag: 'code', children: [text('a|b')] }), createBranch({ tag: 'a', attrs: { href: '/x|y' }, children: [text('L')] }))] }),
      ],
    });
    const out = JSON.stringify(reimport(page([table])).root);
    expect(out).toContain('"a|b"');
    expect(out).toMatch(/x(\||%7C)y/);
  });

  it('keeps ; inside url() and strings in CSS values', async () => {
    const { sanitizeCssValue } = await import('@tree-weaver/core');
    expect(sanitizeCssValue('url(data:image/png;base64,iVBOR)')).toBe('url(data:image/png;base64,iVBOR)');
    expect(sanitizeCssValue('url("data:image/svg+xml;utf8,<x>")')).toBe('url("data:image/svg+xml;utf8,<x>")');
    expect(sanitizeCssValue('red; color: blue')).toBe('red, color: blue');
  });

  it('round-trips empty attribute names in XML, and splits whitespace in class names everywhere', () => {
    const b = createBranch({ tag: 'div', attrs: { '': 'v' } });
    const tree = page([{ ...b, classes: ['a b'] }]);
    const back = importDocument(exportTree(tree, 'xml'), 'xml');
    if (back.kind !== 'tree') throw new Error('expected a tree');
    const div = back.tree.root.children[0] as Branch;
    expect(div.attrs).toEqual({ '': 'v' });
    expect(div.classes).toEqual(['a', 'b']);
  });
});

describe('pass 9 fixes', () => {
  const back = (tree: ReturnType<typeof page>) => {
    const doc = importDocument(exportTree(tree, 'markdown'), 'markdown');
    if (doc.kind !== 'tree') throw new Error('expected a tree');
    return doc.tree;
  };
  const tags = (n: TreeNode): string[] => (n.kind === 'branch' ? [n.tag, ...n.children.flatMap(tags)] : []);

  it('keeps Markdown syntax in inline HTML text as text', () => {
    const span = createBranch({ tag: 'span', classes: ['note'], children: [text('[click](javascript:alert(1)) and *em* and `c`')] });
    const tree = back(page([createBranch({ tag: 'p', children: [span] })]));
    expect(tags(tree.root)).not.toContain('a');
    expect(tags(tree.root)).not.toContain('em');
    expect(JSON.stringify(tree.root)).toContain('[click](javascript:alert(1)) and *em* and `c`');
  });

  it('drops script URLs from Markdown links and images', () => {
    const a = createBranch({ tag: 'a', attrs: { href: 'javascript:alert(1)' }, children: [text('click')] });
    const img = createLeaf('javascript:alert(2)', 'image', { alt: 'x' });
    const md = exportTree(page([createBranch({ tag: 'p', children: [a, text(' '), img] })]), 'markdown');
    expect(md).not.toMatch(/javascript/);
  });

  it('keeps carriage returns and a ! before a link from making new markup', () => {
    const tree = back(page([createBranch({ tag: 'p', children: [text('line1\r# injected\r\r- list')] }), createBranch({ tag: 'p', children: [text('Look!'), createBranch({ tag: 'a', attrs: { href: 'https://e.com/x.png' }, children: [text('the file')] })] })]));
    expect(tree.root.children.map((c) => (c as Branch).tag)).toEqual(['p', 'p']);
    expect(JSON.stringify(tree.root)).not.toContain('"type":"image"');
  });

  it('round-trips an SVG tree through Markdown with its shapes', async () => {
    const { createShape } = await import('@tree-weaver/core');
    const circle = { ...createShape('circle'), attrs: { r: '4' } };
    const tree = createTree('D', createBranch({ tag: 'svg', type: 'root', attrs: { viewBox: '0 0 10 10' }, children: [circle] }));
    const out = back(tree as ReturnType<typeof page>);
    expect(out.root.tag).toBe('svg');
    expect(out.root.id).toBe(tree.root.id);
    expect(out.root.children[0]).toMatchObject({ type: 'shape', value: 'circle', id: circle.id });
  });

  it('writes a well-formed SVG when the tree name has >', () => {
    const tree = createTree('Before > After', createBranch({ tag: 'svg', type: 'root', children: [createBranch({ tag: 'g', styles: { lg: { fill: 'red' } } })] }));
    const svg = exportTree(tree, 'svg');
    expect(svg).toContain('data-tw-tree-name="Before &gt; After"');
    const doc = importDocument(svg, 'svg');
    if (doc.kind !== 'tree') throw new Error('expected a tree');
    expect(doc.tree.name).toBe('Before > After');
    expect((doc.tree.root.children[0] as Branch).styles.lg).toEqual({ fill: 'red' });
  });

  it('keeps styles of branches whose ids need escaping in CSS', () => {
    for (const id of ['a\\b', 'a"b', "a'b", 'a]b', 'a<b', 'a\nb', 'a,b']) {
      const tree = page([{ ...createBranch({ tag: 'div', styles: { lg: { color: 'red' }, tablet: { color: 'blue' } } }), id }]);
      const doc = importDocument(exportTree(tree, 'html'), 'html');
      if (doc.kind !== 'tree') throw new Error('expected a tree');
      const div = doc.tree.root.children.find((c) => c.kind === 'branch') as Branch;
      expect([div.id, div.styles]).toEqual([id, { lg: { color: 'red' }, tablet: { color: 'blue' } }]);
    }
  });
});

describe('pass 10 fixes', () => {
  const back = (tree: ReturnType<typeof page>) => {
    const doc = importDocument(exportTree(tree, 'markdown'), 'markdown');
    if (doc.kind !== 'tree') throw new Error('expected a tree');
    return doc.tree;
  };

  it('drops script URLs written with character references from Markdown', () => {
    const a = createBranch({ tag: 'a', attrs: { href: '&#106;avascript:alert(1)' }, children: [text('click')] });
    const img = createLeaf('java&#115;cript:alert(2)', 'image', { alt: 'x' });
    const md = exportTree(page([createBranch({ tag: 'p', children: [a, text(' '), img] })]), 'markdown');
    expect(md).not.toMatch(/avascript|cript:/);
  });

  it('escapes < in front matter, which reads back unchanged', () => {
    const tree = createTree('<img src=x onerror=alert(1)>', createBranch({ tag: 'body', type: 'root', children: [createBranch({ tag: 'p', children: [text('hi')] })] }));
    const md = exportTree(tree, 'markdown');
    expect(md.split('---')[1]).not.toContain('<');
    expect(back(tree).name).toBe('<img src=x onerror=alert(1)>');
  });

  it('keeps a | in an inline HTML attribute inside its table cell', () => {
    const cell = (tag: 'th' | 'td', c: TreeNode) => createBranch({ tag, children: [c] });
    const abbr = createBranch({ tag: 'abbr', attrs: { title: 'Pro | Team' }, children: [text('Pro')] });
    const table = createBranch({ tag: 'table', children: [createBranch({ tag: 'thead', children: [createBranch({ tag: 'tr', children: [cell('th', text('Plan')), cell('th', text('Price'))] })] }), createBranch({ tag: 'tbody', children: [createBranch({ tag: 'tr', children: [cell('td', abbr), cell('td', text('$5'))] })] })] });
    expect(JSON.stringify(back(page([table])).root)).toContain('"title":"Pro | Team"');
  });

  it('escapes block syntax that trimming brings to the start of a line', () => {
    const tree = back(page([createBranch({ tag: 'p', children: [text(' '), text('# looks like text')] }), createBranch({ tag: 'p', children: [createBranch({ tag: 'em' }), text('- also text')] })]));
    expect(tree.root.children.map((c) => (c as Branch).tag)).toEqual(['p', 'p']);
  });

  it('keeps lists nested under items numbered 10 and up', () => {
    const items = Array.from({ length: 10 }, (_, i) => createBranch({ tag: 'li', children: [text(`item ${i + 1}`)] }));
    items[9] = createBranch({ tag: 'li', children: [text('item 10'), createBranch({ tag: 'ul', children: [createBranch({ tag: 'li', children: [text('nested')] })] })] });
    const tree = back(page([createBranch({ tag: 'ol', children: items })]));
    expect(tree.root.children).toHaveLength(1);
    expect(((tree.root.children[0] as Branch).children[9] as Branch).children.some((c) => c.kind === 'branch' && c.tag === 'ul')).toBe(true);
  });

  it('drops prefixed SVG attributes whose namespace is not kept', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:i="urn:x" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1 1"><g i:extraneous="self"><a xlink:href="https://e.com" xlink:title="t"><circle r="1"/></a></g></svg>';
    const out = exportTree((importDocument(svg, 'svg') as { tree: ReturnType<typeof page> }).tree, 'svg');
    expect(out).not.toMatch(/\bi:|xlink:/);
    expect(out).toContain('href="https://e.com"');
  });
});
