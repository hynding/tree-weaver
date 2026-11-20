import { createBranch, createComponent, createCustomKit, createForest, createKit, createLeaf, createRule, createTree, instantiateComponent, text, withTokens, type Branch, type TreeNode } from '@tree-weaver/core';
import { describe, expect, it } from 'vitest';
import { exportComponent, exportComponentDef, exportForest, exportStorybook, exportTree, importDocument } from './index';

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

describe('pass 11 fixes', () => {
  it('checks URL attributes under the names JSX gives them', () => {
    const doc = importDocument('<a h-ref="javascript:alert(1)">click</a><button form-action="javascript:alert(2)">go</button><svg><a xlink-href="javascript:alert(3)"><circle r="1"/></a></svg>', 'html');
    if (doc.kind !== 'tree') throw new Error('expected a tree');
    const out = exportComponent(doc.tree, { framework: 'react' }).files.map((f) => f.contents).join('\n');
    // Names React doesn't know stay as written (`h-ref`), which no browser reads as a link.
    expect(out).not.toMatch(/\s(href|hRef|formAction|xlinkHref|src|sRc)=\{?"javascript/i);
  });

  it('keeps link-like link text and titles from breaking out of Markdown', () => {
    const a = createBranch({ tag: 'a', attrs: { href: 'https://example.com/', title: '[click](javascript:alert(1))' }, children: [text('[x](j)')] });
    const tree = page([createBranch({ tag: 'p', children: [a, text('<img src=x onerror=alert(1)//>')] })]);
    const back = importDocument(exportTree(tree, 'markdown'), 'markdown');
    if (back.kind !== 'tree') throw new Error('expected a tree');
    const p = back.tree.root.children[0] as Branch;
    expect(p.children[0]).toMatchObject({ tag: 'a', attrs: { href: 'https://example.com/', title: '[click](javascript:alert(1))' } });
    expect(JSON.stringify(p)).not.toContain('"type":"image"');
  });

  it('escapes link syntax in front matter, which reads back unchanged', () => {
    const tree = createTree('[click me](javascript:alert(1))', createBranch({ tag: 'body', type: 'root', children: [createBranch({ tag: 'p', children: [text('hi')] })] }));
    const md = exportTree(tree, 'markdown');
    expect(md.split('---')[1]).not.toMatch(/\[click/);
    const back = importDocument(md, 'markdown');
    expect(back.kind === 'tree' && back.tree.name).toBe('[click me](javascript:alert(1))');
  });

  it('writes well-formed XML and SVG when text holds control characters', () => {
    const tree = createTree('T', createBranch({ tag: 'svg', type: 'root', children: [createBranch({ tag: 'text', children: [text('line one\u000bline two')] })] }));
    expect(exportTree(tree, 'svg')).not.toMatch(/\u000b/);
    expect(exportTree(tree, 'xml')).not.toMatch(/\u000b/);
  });
});

describe('pass 12 fixes', () => {
  it('ignores XML style displays that are not displays (no prototype pollution)', () => {
    importDocument('<tree-weaver version="1"><tree id="t1" name="T"><branch id="b_body" tag="body" type="root"><style display="__proto__"><declaration property="polluted" value="yes"/></style><style display="constructor"><declaration property="assign" value="x"/></style></branch></tree></tree-weaver>', 'xml');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(typeof Object.assign).toBe('function');
  });

  it('drops attribute names Vue would set as HTML-setting properties', () => {
    const doc = importDocument(JSON.stringify({ tree: { name: 'T', root: { tag: 'body', children: [{ tag: 'div', attrs: { innerHTML: '<img src=x onerror=alert(1)>' } }, { tag: 'svg', attrs: { viewBox: '0 0 1 1' } }] } } }), 'json');
    if (doc.kind !== 'tree') throw new Error('expected a tree');
    const vue = exportComponent(doc.tree, { framework: 'vue' }).files.map((f) => f.contents).join('\n');
    expect(vue).not.toMatch(/innerHTML/i);
    expect(vue).toContain('viewBox="0 0 1 1"');
  });

  it('puts rows straight under an imported table in a tbody', () => {
    const doc = importDocument('<table><tr><th>Plan</th></tr><tr><td>Basic</td></tr></table>', 'html');
    if (doc.kind !== 'tree') throw new Error('expected a tree');
    const table = doc.tree.root.children.find((c) => c.kind === 'branch') as Branch;
    expect(table.children.map((c) => (c as Branch).tag)).toEqual(['tbody']);
    expect((table.children[0] as Branch).children).toHaveLength(2);
  });
});

describe('pass 13 fixes', () => {
  const react = (html: string) => {
    const doc = importDocument(html, 'html');
    if (doc.kind !== 'tree') throw new Error('expected a tree');
    return exportComponent(doc.tree, { framework: 'react' }).files[0].contents;
  };

  it('writes JSX attribute names React knows, and leaves the rest as written', () => {
    const out = react('<div itemscope itemtype="https://schema.org/Product"></div><form><button formnovalidate>Save</button></form><button hx-post="/x">x</button><svg><rect stroke-width="2"/></svg>');
    expect(out).toContain('itemScope');
    expect(out).toContain('formNoValidate');
    expect(out).toContain('hx-post="/x"');
    expect(out).toContain('strokeWidth');
  });

  it('drops attributes the frameworks reserve, and refuses key/ref props', () => {
    const out = react('<div ref="r" key="k" slot="s">x</div>');
    expect(out).not.toMatch(/\bref=|\bkey=|\bslot=/);
  });

  it('mends nesting Svelte refuses to compile', () => {
    const doc = importDocument(JSON.stringify({ tree: { name: 'T', root: { tag: 'body', children: [{ tag: 'p', children: [{ tag: 'div', children: ['x'] }] }, { tag: 'a', attrs: { href: '/a' }, children: [{ tag: 'div', children: [{ tag: 'a', attrs: { href: '/b' }, children: ['b'] }] }] }, { tag: 'table', children: [{ tag: 'tr', children: [{ tag: 'td', children: ['c'] }] }] }] } } }), 'json');
    if (doc.kind !== 'tree') throw new Error('expected a tree');
    const svelte = exportComponent(doc.tree, { framework: 'svelte' }).files[0].contents;
    expect(svelte).not.toMatch(/<p[ >]/);
    expect(svelte).toMatch(/<table[^>]*>\s*<tbody/);
    expect((svelte.match(/<a[ >]/g) ?? []).length).toBe(1);
  });

  it('gives Storybook stories unique titles', async () => {
    const { exportStorybook } = await import('./index');
    const forest = createForest('Site', [page([text('a')]), createTree('Home!', createBranch({ tag: 'body', type: 'root' }))]);
    const titles = exportStorybook(forest).files.filter((f) => f.path.endsWith('.stories.js')).map((f) => /title: "([^"]+)"/.exec(f.content)![1]);
    expect(titles).toEqual(['Site/Home', 'Site/Home! 2']);
  });

  it('suffixes native type names the generated code uses', async () => {
    const { nativeTypeName } = await import('./index');
    expect(nativeTypeName('Environment', 'swiftui')).toBe('EnvironmentView');
    expect(nativeTypeName('MainAxisSize', 'flutter')).toBe('MainAxisSizeWidget');
  });
});

describe('pass 14 fixes', () => {
  const jsx = (html: string, opts: Record<string, unknown> = {}) => {
    const doc = importDocument(`<body>${html}</body>`, 'html');
    const tree = doc.kind === 'tree' ? doc.tree : doc.forest.trees[0];
    return exportComponent(tree, { framework: 'react', ...opts }).files[0].contents;
  };

  it('writes numbers and booleans the way React types them', () => {
    const out = jsx('<table><tbody><tr><td colspan="2">x</td></tr></tbody></table><textarea rows="5"></textarea><input type="checkbox" checked="checked" maxlength="5" disabled="disabled">');
    expect(out).toContain('colSpan={2}');
    expect(out).toContain('rows={5}');
    expect(out).toContain('maxLength={5}');
    expect(out).toMatch(/defaultChecked[ />]/);
    expect(out).not.toContain('defaultChecked=');
    expect(out).not.toContain('disabled=');
  });

  it('turns a numeric prop into a number', () => {
    const def = createComponent('Box', createBranch({ tag: 'div', attrs: { tabindex: '{{tab}}' } }));
    const out = exportComponentDef(def, { framework: 'react' }).files[0].contents;
    expect(out).toContain("tabIndex={tab == null || tab === '' ? undefined : globalThis.Number(tab)}");
  });

  it('writes xmlns:xlink as xmlnsXlink and drops other xmlns: names', () => {
    const out = jsx('<svg xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:foo="urn:x" viewBox="0 0 2 2"></svg>');
    expect(out).toContain('xmlnsXlink=');
    expect(out).not.toMatch(/xmlns:/);
  });

  it('turns a <p> with a block anywhere below it into a div', () => {
    for (const html of ['<p>See <a href="/x"><div>card</div></a></p>', '<p><span>a<div>b</div></span></p>', '<p><em>x<ul><li>y</li></ul></em></p>']) {
      expect(jsx(html, { framework: 'svelte' })).not.toMatch(/<p[ >]/);
    }
    expect(jsx('<p>Hi <a href="/x">there</a></p>', { framework: 'svelte' })).toMatch(/<p[ >]/);
  });

  it('keeps kit order and a later kit\'s @import working', () => {
    const tree = page([createBranch({ tag: 'p' })]);
    const kits = [
      { id: 'a', name: 'Base', css: '.card{padding:1rem}', enabled: true },
      { id: 'b', name: 'Fonts', css: '@import url("https://fonts.example/x.css"); body{font-family:Inter}', enabled: true },
      { id: 'c', name: 'Linked', css: '', href: 'https://cdn.example/l.css', enabled: true },
    ];
    const files = exportComponent(tree, { framework: 'react', kits }).files;
    const main = files.find((f) => f.path === 'kits.css')!.contents;
    const lines = main.split('\n').filter((l) => l.startsWith('@import'));
    expect(lines).toEqual(['@import url("./kits/base.css");', '@import url("./kits/fonts.css");', '@import url("https://cdn.example/l.css");']);
    expect(files.find((f) => f.path === 'kits/fonts.css')!.contents).toMatch(/^\/\*[^]*?\*\/\n@import/);
    // Without a clash, one file as before.
    const one = exportComponent(tree, { framework: 'react', kits: kits.slice(0, 1) }).files.filter((f) => f.path.startsWith('kits'));
    expect(one.map((f) => f.path)).toEqual(['kits.css']);
  });

  it('keeps adjacent inline elements together in HTML and Svelte', () => {
    const out = jsx('<div><span>a</span><span>b</span><p>c</p></div>', { framework: 'svelte' });
    expect(out).toContain('<span>a</span><span>b</span>');
  });
});

describe('pass 15 fixes', () => {
  const imported = (html: string) => {
    const doc = importDocument(`<body>${html}</body>`, 'html');
    return doc.kind === 'tree' ? doc.tree : doc.forest.trees[0];
  };
  const texts = (node: TreeNode): string[] => ('children' in node ? node.children.flatMap(texts) : node.type === 'text' ? [node.value] : []);

  it('keeps spaces at the edges of inline elements on HTML import', () => {
    const tree = imported('<p><strong>Note: </strong>read this<em> carefully</em></p>');
    expect(texts(tree.root)).toEqual(['Note: ', 'read this', ' carefully']);
    const back = importDocument(exportTree(tree, 'html'), 'html');
    expect(texts(back.kind === 'tree' ? back.tree.root : back.forest.trees[0].root)).toEqual(['Note: ', 'read this', ' carefully']);
    expect(texts(imported('<p>  Hello  </p>').root)).toEqual(['Hello']);
  });

  it('keeps edge spaces in Svelte exports', () => {
    const out = exportComponent(imported('<p><strong>Note: </strong>read this<em> carefully</em></p>'), { framework: 'svelte' }).files[0].contents;
    expect(out).toContain("Note:{' '}</strong>");
    expect(out).toContain("{' '}carefully</em>");
  });

  it('keeps <del> and <ins> together', () => {
    const out = exportComponent(imported('<div><del>$10</del><ins>$8</ins><p>x</p></div>'), { framework: 'html' }).files[0].contents;
    expect(out).toMatch(/<\/del><ins/);
  });

  it('calls the global Number even in a component named Number', () => {
    const def = createComponent('Number', createBranch({ tag: 'td', attrs: { colspan: '{{span}}' }, children: [text('{{value}}')] }));
    const out = exportComponentDef(def, { framework: 'react' }).files[0].contents;
    expect(out).toContain('globalThis.Number(span)');
    expect(out).not.toMatch(/[^.]Number\(span\)/);
  });

  it('drops a children attribute from React exports', () => {
    const out = exportComponent(imported('<div children="Injected text"></div>'), { framework: 'react' }).files[0].contents;
    expect(out).not.toContain('Injected text');
  });

  it('types prop bindings the way React expects', () => {
    const btn = createComponent('Btn', createBranch({ tag: 'button', attrs: { disabled: '{{disabled}}', title: '{{pressed}}', tabindex: '{{pressed}}' } }), {
      props: [{ name: 'disabled', type: 'text', default: '' }, { name: 'pressed', type: 'boolean', default: '' }],
    } as never);
    const out = exportComponentDef(btn, { framework: 'react', typescript: true }).files[0].contents;
    expect(out).toContain("disabled={globalThis.String(disabled) !== 'false'}");
    expect(out).toContain('title={globalThis.String(pressed)}');
    expect(out).toContain('tabIndex={globalThis.Number(pressed)}');
  });

  it('gives Storybook stories distinct ids', async () => {
    const tree = createTree('Home', createBranch({ tag: 'body', type: 'root', children: [{ ...createBranch({ tag: 'p' }), name: 'Step 1a' }, { ...createBranch({ tag: 'p' }), name: 'Step 1A' }] }));
    const all = exportStorybook(createForest('Site', [tree])).files.map((f) => f.content).join('\n');
    expect(all).toContain('export const Step1a ');
    expect(all).toContain('export const Step1A2 ');
  });
});

describe('pass 16 fixes', () => {
  const imported = (html: string) => {
    const doc = importDocument(`<body>${html}</body>`, 'html');
    return doc.kind === 'tree' ? doc.tree : doc.forest.trees[0];
  };
  const texts = (node: TreeNode): string[] => ('children' in node ? node.children.flatMap(texts) : node.type === 'text' ? [node.value] : []);

  it('keeps a whitespace-only text at the edge of an inline element', () => {
    expect(texts(imported('<p><strong><em>Note:</em> </strong>text</p>').root).join('')).toBe('Note: text');
    expect(texts(imported('<p>Go<span> <b>now</b></span></p>').root).join('')).toBe('Go now');
  });

  it('keeps a whitespace-only edge text in Vue', () => {
    const out = exportComponent(imported('<p><strong><em>Note:</em> </strong>text</p>'), { framework: 'vue' }).files[0].contents;
    expect(out).toContain("</em>{{ ' ' }}</strong>");
  });

  it('binds boolean attributes the same way in every export', () => {
    const def = createComponent('Btn', createBranch({ tag: 'button', attrs: { disabled: '{{off}}', hidden: '{{gone}}' } }), {
      props: [{ name: 'off', type: 'text', default: 'false' }, { name: 'gone', type: 'boolean', default: '' }],
    } as never);
    const react = exportComponentDef(def, { framework: 'react', typescript: true }).files[0].contents;
    expect(react).toContain("disabled={globalThis.String(off) !== 'false'}");
    expect(react).toContain('hidden={gone}');
    const vue = exportComponentDef(def, { framework: 'vue' }).files[0].contents;
    expect(vue).toContain(`:disabled="off !== 'false'"`);
    expect(vue).toContain(':hidden="gone"');
    const svelte = exportComponentDef(def, { framework: 'svelte' }).files[0].contents;
    expect(svelte).toContain("disabled={off !== 'false'}");
    expect(svelte).toContain('hidden={gone}');
    // The editor's expansion leaves both off.
    const inst = instantiateComponent(def);
    expect(inst.attrs.disabled).toBeUndefined();
    expect(inst.attrs.hidden).toBeUndefined();
    const on = instantiateComponent(def, { off: '', gone: 'true' });
    expect(on.attrs.disabled).toBe('');
    expect(on.attrs.hidden).toBe('true');
  });
});

describe('pass 17 fixes', () => {
  const imported = (html: string) => {
    const doc = importDocument(`<body>${html}</body>`, 'html');
    return doc.kind === 'tree' ? doc.tree : doc.forest.trees[0];
  };
  const texts = (node: TreeNode): string[] => ('children' in node ? node.children.flatMap(texts) : node.type === 'text' ? [node.value] : []);

  it('leaves whitespace inside <pre> alone in Svelte and Vue', () => {
    const tree = imported('<pre><code>    indented();\n  more();\n\n</code></pre>');
    for (const framework of ['svelte', 'vue'] as const) {
      const out = exportComponent(tree, { framework }).files[0].contents;
      expect(out).toContain('"    indented();\\n  more();\\n\\n"');
      expect(out).not.toContain("' '");
    }
  });

  it('keeps the space beside a comment and between other inline elements', () => {
    expect(texts(imported('<p>Hello<!-- name --> <b>World</b></p>').root).join('')).toBe('Hello World');
    expect(texts(imported('<p><my-badge>New</my-badge> <b>Item</b></p>').root).join('')).toBe('New Item');
  });

  it('drops the line break after <pre> as a browser does', () => {
    expect(texts(imported('<pre>\n  def f():</pre>').root)).toEqual(['  def f():']);
  });

  it('tests data-show-if on a text prop the way the editor does', () => {
    const def = createComponent('Inbox', createBranch({ tag: 'div', children: [text('Inbox'), createBranch({ tag: 'span', attrs: { 'data-show-if': 'count' }, children: [text('{{count}}')] })] }), {
      props: [{ name: 'count', type: 'text', default: '0' }],
    } as never);
    expect(exportComponentDef(def, { framework: 'react' }).files[0].contents).toContain("(count && globalThis.String(count) !== 'false' && globalThis.String(count) !== '0') && (");
    expect(exportComponentDef(def, { framework: 'svelte' }).files[0].contents).toContain("{#if (count && globalThis.String(count) !== 'false' && globalThis.String(count) !== '0')}");
    expect(exportComponentDef(def, { framework: 'vue' }).files[0].contents).toContain('v-if="(count &amp;&amp; String(count) !== \'false\'');
  });

  it('keeps an ordered list with an unusual start as HTML in Markdown', () => {
    const tree = imported('<ol start="-1"><li>a</li><li>b</li></ol>');
    const md = exportTree(tree, 'markdown');
    expect(md).not.toMatch(/^-1\. a/m);
    const back = importDocument(md, 'markdown');
    const root = back.kind === 'tree' ? back.tree.root : back.forest.trees[0].root;
    expect(JSON.stringify(root)).toContain('"tag":"ol"');
  });
});

describe('pass 18 fixes', () => {
  const poem = () =>
    createTree('Home', createBranch({ tag: 'body', type: 'root', children: [createBranch({ tag: 'div', styles: { lg: { 'white-space': 'pre-wrap' } }, children: [text('Roses are red,\n    violets  are blue.')] })] }));

  it('keeps whitespace under white-space: pre-wrap in Vue and Svelte', () => {
    expect(exportComponent(poem(), { framework: 'vue' }).files[0].contents).toContain('{{ "Roses are red,\\n    violets  are blue." }}');
    expect(exportComponent(poem(), { framework: 'svelte' }).files[0].contents).toContain('{"Roses are red,\\n    violets  are blue."}');
  });

  it('keeps whitespace under white-space: pre-wrap on HTML import and round trip', () => {
    const doc = importDocument('<body><div style="white-space: pre-wrap">Roses are red,\n    violets are blue.</div></body>', 'html');
    const tree = doc.kind === 'tree' ? doc.tree : doc.forest.trees[0];
    expect(JSON.stringify(tree.root)).toContain('Roses are red,\\n    violets are blue.');
    const back = importDocument(exportTree(poem(), 'html'), 'html');
    const root = back.kind === 'tree' ? back.tree.root : back.forest.trees[0].root;
    expect(JSON.stringify(root)).toContain('Roses are red,\\n    violets  are blue.');
  });

  it('calls the global String in a component named String', () => {
    const def = createComponent('String', createBranch({ tag: 'button', attrs: { disabled: '{{busy}}', 'data-show-if': 'label' }, children: [text('{{label}}')] }));
    const out = exportComponentDef(def, { framework: 'react' }).files[0].contents;
    expect(out.replace('function String(', '')).not.toMatch(/[^.]String\(/);
  });

  it('suffixes native type names that clash with names the code uses', () => {
    const tree = createTree('Font Style', createBranch({ tag: 'body', type: 'root', children: [createBranch({ tag: 'p', styles: { lg: { 'font-style': 'italic' } }, children: [text('Hi')] })] }));
    expect(exportComponent(tree, { framework: 'flutter' }).name).not.toBe('FontStyle');
    expect(exportComponent({ ...tree, name: 'self' }, { framework: 'swiftui' }).name).not.toBe('Self');
  });
});

describe('pass 19 fixes', () => {
  const imported = (html: string) => {
    const doc = importDocument(`<body>${html}</body>`, 'html');
    return doc.kind === 'tree' ? doc.tree : doc.forest.trees[0];
  };
  const texts = (node: TreeNode): string[] => ('children' in node ? node.children.flatMap(texts) : node.type === 'text' ? [node.value] : []);

  it('keeps non-breaking spaces on HTML and Markdown import', () => {
    expect(texts(imported('<p>a&nbsp;&nbsp;b</p>').root)).toEqual(['a  b']);
    expect(texts(imported('<p>a&nbsp;</p>').root)).toEqual(['a ']);
    const md = importDocument('Price:&nbsp;&nbsp;$5', 'markdown');
    expect(texts(md.kind === 'tree' ? md.tree.root : md.forest.trees[0].root).join('')).toContain('Price:  $5');
  });

  it('keeps an edge non-breaking space as written in Vue and Svelte', () => {
    const tree = createTree('Home', createBranch({ tag: 'body', type: 'root', children: [createBranch({ tag: 'p', children: [text(' '), createBranch({ tag: 'b', children: [text('x')] }), text('  ')] })] }));
    expect(exportComponent(tree, { framework: 'vue' }).files[0].contents).not.toContain("{{ ' ' }}");
    expect(exportComponent(tree, { framework: 'svelte' }).files[0].contents).not.toContain("{' '}");
  });

  it('keeps whitespace in prop text under white-space: pre in Vue', () => {
    const def = createComponent('Poem', createBranch({ tag: 'div', styles: { lg: { 'white-space': 'pre' } }, children: [text('Dear {{name}},\n    thanks!')] }), {
      props: [{ name: 'name', type: 'text', default: 'Ann' }],
    } as never);
    expect(exportComponentDef(def, { framework: 'vue' }).files[0].contents).toContain('{{ name }}{{ ",\\n    thanks!" }}');
  });
});

describe('pass 20 fixes', () => {
  const imported = (html: string) => {
    const doc = importDocument(`<body>${html}</body>`, 'html');
    return doc.kind === 'tree' ? doc.tree : doc.forest.trees[0];
  };
  const roundTrip = (html: string) => {
    const back = importDocument(exportTree(imported(html), 'markdown'), 'markdown');
    return back.kind === 'tree' ? back.tree.root : back.forest.trees[0].root;
  };
  const shape = (n: TreeNode): unknown => ('children' in n ? { [n.tag]: n.children.map(shape) } : n.type === 'text' ? n.value : n.type);

  it('keeps headings and paragraphs holding custom or media elements', () => {
    const out = exportComponent(imported('<h2>Pricing <x-badge>new</x-badge></h2><p><picture><img src="a.png" alt="Logo"></picture></p>'), { framework: 'react' }).files[0].contents;
    expect(out).toMatch(/<h2[ >]/);
    expect(out).toMatch(/<p[ >]/);
  });

  it('writes emphasis and code Markdown can read back', () => {
    for (const html of ['<p><strong>a</strong><strong>b</strong></p>', '<p><em>a</em><em>b</em></p>', '<p>foo<strong>(bar)</strong></p>', '<p><s>x</s><del>y</del></p>', '<p><code>a</code><code>b</code></p>', '<p>x<code> a </code></p>']) {
      expect(JSON.stringify(shape(roundTrip(html)))).toBe(JSON.stringify(shape(imported(html).root)));
    }
    expect(exportTree(imported('<p>a <strong>b</strong> c</p>'), 'markdown')).toContain('a **b** c');
  });

  it('keeps non-breaking-space paragraphs and edges in Markdown', () => {
    expect(JSON.stringify(shape(roundTrip('<p>&nbsp;</p><p>x</p>')))).toBe(JSON.stringify(shape(imported('<p>&nbsp;</p><p>x</p>').root)));
    expect(JSON.stringify(shape(roundTrip('<p>&nbsp;Hello&nbsp;</p>')))).toContain(' Hello ');
    expect(JSON.stringify(shape(roundTrip('<h2>&nbsp;Hi</h2>')))).toContain(' Hi');
  });

  it('percent-encodes spaces inside url() in Tailwind classes', () => {
    const tree = createTree('Home', createBranch({ tag: 'body', type: 'root', children: [createBranch({ tag: 'div', styles: { lg: { 'background-image': 'url("a b.png")' } } })] }));
    const out = exportComponent(tree, { framework: 'react', styling: 'tailwind' }).files[0].contents;
    expect(out).toContain('a%20b.png');
  });
});

describe('pass 21 fixes', () => {
  it('uses only globals Vue templates allow in v-if', () => {
    const def = createComponent('Inbox', createBranch({ tag: 'div', children: [createBranch({ tag: 'span', attrs: { 'data-show-if': 'count' }, children: [text('{{count}}')] })] }), {
      props: [{ name: 'count', type: 'text', default: '0' }],
    } as never);
    const vue = exportComponentDef(def, { framework: 'vue' }).files[0].contents;
    expect(vue).not.toContain('globalThis');
    expect(vue).toContain("String(count) !== '0'");
  });

  it('drops padding inside url() in Tailwind classes', () => {
    const tree = createTree('Home', createBranch({ tag: 'body', type: 'root', children: [createBranch({ tag: 'div', styles: { lg: { 'background-image': 'url( "hero.png" )' } } })] }));
    const out = exportComponent(tree, { framework: 'react', styling: 'tailwind' }).files[0].contents;
    expect(out).toContain("[background-image:url('hero.png')]");
    expect(out).not.toContain('%20');
  });

  it('keeps linked, custom-class and token kits through an SVG file', () => {
    const tree = createTree('Logo', createBranch({ tag: 'svg', type: 'root' }));
    const linked = { ...createKit('Remote', ''), href: 'https://cdn.example.com/kit.css' };
    const custom = createCustomKit('Mine', [createRule('.card', { lg: { color: 'red' } })]);
    const tokens = withTokens(createKit('Tokens', ''), [{ name: '--brand', value: '#f00' }]);
    const back = importDocument(exportTree(tree, 'svg', [linked, custom, tokens]), 'svg');
    const kits = back.kits ?? [];
    expect(kits.find((k) => k.name === 'Remote')?.href).toBe('https://cdn.example.com/kit.css');
    expect(kits.find((k) => k.name === 'Mine')?.rules?.[0].selector).toBe('.card');
    expect(kits.find((k) => k.name === 'Tokens')?.tokens?.[0].name).toBe('--brand');
  });

  it('exports a link holding a lone surrogate to SwiftUI', () => {
    const tree = page([createBranch({ tag: 'a', attrs: { href: 'https://example.com/\uD800x' }, children: [text('Go')] })]);
    const swift = exportComponent(tree, { framework: 'swiftui' }).files[0].contents;
    expect(swift).toContain('%EF%BF%BDx');
  });
});

describe('pass 22 fixes', () => {
  const imported = (html: string) => {
    const doc = importDocument(`<body>${html}</body>`, 'html');
    return doc.kind === 'tree' ? doc.tree : doc.forest.trees[0];
  };
  const shape = (n: TreeNode): unknown => ('children' in n ? { [n.tag]: n.children.map(shape) } : n.type === 'text' ? n.value : n.type);
  const mdRoundTrip = (html: string) => {
    const back = importDocument(exportTree(imported(html), 'markdown'), 'markdown');
    return JSON.stringify(shape(back.kind === 'tree' ? back.tree.root : back.forest.trees[0].root));
  };

  it('writes multi-value Tailwind classes as utilities, so later longhands still win in v3', () => {
    const tree = page([createBranch({ tag: 'div', styles: { lg: { margin: '0 auto', 'margin-top': '2rem' } } })]);
    const out = exportComponent(tree, { framework: 'html', styling: 'tailwind' }).files[0].contents;
    expect(out).toContain('m-[0_auto] mt-[2rem]');
  });

  it('writes React textarea text as one defaultValue', () => {
    const def = createComponent('Note', createBranch({ tag: 'div', children: [createBranch({ tag: 'textarea', children: [text('Dear {{name}},')] })] }), {
      props: [{ name: 'name', type: 'text', default: 'you' }],
    } as never);
    expect(exportComponentDef(def, { framework: 'react' }).files[0].contents).toContain('<textarea defaultValue={`Dear ${name},`} />');
  });

  it('repairs nesting the HTML parser would undo', () => {
    const svelte = (html: string) => exportComponent(imported(html), { framework: 'svelte' }).files[0].contents;
    expect(svelte('<table><col width="50"><tr><td>a</td></tr></table>')).toMatch(/<colgroup>\s*<col[^>]*\/?>\s*<\/colgroup>/);
    const nested = page([createBranch({ tag: 'ul', children: [createBranch({ tag: 'li', children: [createBranch({ tag: 'li', children: [text('x')] })] })] })]);
    expect(exportComponent(nested, { framework: 'svelte' }).files[0].contents).toMatch(/<li[^>]*>\s*<div[^>]*>x<\/div>/);
  });

  it('keeps strikethrough mixed with emphasis, trailing list spaces and headerless tables in Markdown', () => {
    for (const html of ['<p><strong><del>a <em>b</em></del></strong></p>', '<p><del>was <s>old</s></del></p>', '<ul><li>a\u00a0</li></ul>', '<table><tbody><tr><td>a</td></tr></tbody></table>']) {
      expect(mdRoundTrip(html)).toBe(JSON.stringify(shape(imported(html).root)));
    }
  });

  it('keeps a leading newline in <pre> through HTML', () => {
    const tree = page([createBranch({ tag: 'pre', children: [text('\nline2')] })]);
    const back = importDocument(exportTree(tree, 'html'), 'html');
    const root = back.kind === 'tree' ? back.tree.root : back.forest.trees[0].root;
    expect(JSON.stringify(shape(root))).toContain('"\\nline2"');
  });

  it('writes React attributes its types and renderer accept', () => {
    const def = createComponent('Card', createBranch({ tag: 'div', children: [createBranch({ tag: 'a', attrs: { hidden: 'until-found', tabindex: '{{tab}}' }, children: [text('x')] })] }), {
      props: [{ name: 'tab', type: 'text' }],
    } as never);
    const out = exportComponentDef(def, { framework: 'react' }).files[0].contents;
    expect(out).toContain(' hidden');
    expect(out).not.toContain('until-found');
    expect(out).toContain("tab == null || tab === ''");
  });
});

describe('pass 23 fixes', () => {
  const imported = (html: string) => {
    const doc = importDocument(`<body>${html}</body>`, 'html');
    return doc.kind === 'tree' ? doc.tree : doc.forest.trees[0];
  };
  const shape = (n: TreeNode): unknown => ('children' in n ? { [n.tag]: n.children.map(shape) } : n.type === 'text' ? n.value : n.type);
  const mdBack = (tree: ReturnType<typeof imported>) => {
    const back = importDocument(exportTree(tree, 'markdown'), 'markdown');
    return JSON.stringify(shape(back.kind === 'tree' ? back.tree.root : back.forest.trees[0].root));
  };

  it('keeps a longhand after its shorthand in Tailwind, and includes the breakpoint width', () => {
    const tree = page([createBranch({ tag: 'div', styles: { lg: { border: '1px solid blue', 'border-top': '2px solid red' }, tablet: { padding: '2px' } } })]);
    const out = exportComponent(tree, { framework: 'html', styling: 'tailwind' }).files[0].contents;
    expect(out).toContain('[border:1px_solid_blue] [&&]:[border-top:2px_solid_red]');
    expect(out).toContain('max-[1024.02px]:p-[2px]');
  });

  it('writes same-kind emphasis nested at the edge as HTML in Markdown', () => {
    for (const html of ['<p><em><em>Dune</em></em></p>', '<p><strong><strong>a</strong>c</strong></p>']) {
      expect(mdBack(imported(html))).toBe(JSON.stringify(shape(imported(html).root)));
    }
  });

  it('keeps headings holding a line separator in Markdown', () => {
    const tree = page([createBranch({ tag: 'h2', children: [text('Price\u2028list')] })]);
    expect(mdBack(tree)).toContain('"h2"');
  });

  it('puts non-table children of a table in a cell', () => {
    const out = exportComponent(imported('<table><tbody><tr><td>a</td></tr></tbody></table>'), { framework: 'svelte' }).files[0].contents;
    expect(out).toContain('<td');
    const tree = page([createBranch({ tag: 'table', children: [createBranch({ tag: 'p', children: [text('x')] })] })]);
    expect(exportComponent(tree, { framework: 'svelte' }).files[0].contents).toMatch(/<tbody[^>]*>\s*<tr[^>]*>\s*<td[^>]*>\s*<p/);
  });
});

describe('pass 24 fixes', () => {
  it('puts kits in the components layer for Tailwind', () => {
    const tree = page([createBranch({ tag: 'article', classes: ['card'], styles: { lg: { padding: '2px' } } })]);
    const out = exportComponent(tree, { framework: 'react', styling: 'tailwind', kits: [createKit('Basic', '.card { padding: 24px }'), { ...createKit('Remote', ''), href: 'https://cdn.example.com/k.css' }] });
    const kits = out.files.find((f) => f.path === 'kits.css')!.contents;
    expect(kits).toContain('@layer theme, base, components, utilities;');
    expect(kits).toContain('@import url("https://cdn.example.com/k.css") layer(components);');
    expect(kits).toMatch(/@import url\("\.\/kits\/basic\.css"\) layer\(components\);/);
    const css = exportComponent(tree, { framework: 'react', kits: [createKit('Basic', '.card { padding: 24px }')] }).files.find((f) => f.path === 'kits.css')!.contents;
    expect(css).not.toContain('@layer');
  });

  it('namespaces the wrapper class', () => {
    const tree = createTree('Hidden', createBranch({ tag: 'body', type: 'root', children: [createBranch({ tag: 'p', children: [text('x')] })] }));
    expect(exportComponent(tree, { framework: 'react', styling: 'tailwind' }).files[0].contents).toContain('className="hidden__root"');
  });

  it('keeps code indentation and list numbering in native exports', () => {
    const tree = page([
      createBranch({ tag: 'pre', children: [createBranch({ tag: 'code', children: [text('if (x) {\n    return 1;\n}\n')] })] }),
      createBranch({ tag: 'ol', attrs: { start: '5' }, children: [createBranch({ tag: 'li', children: [text('Five')] }), createBranch({ tag: 'li', children: [text('Six')] })] }),
    ]);
    const swift = exportComponent(tree, { framework: 'swiftui' }).files[0].contents;
    expect(swift).toContain('if (x) {\\n    return 1;\\n}"');
    expect(swift).toContain('Text(verbatim: "6.")');
    const dart = exportComponent(tree, { framework: 'flutter' }).files[0].contents;
    expect(dart).toContain("Text('5. ')");
  });
});

describe('pass 25 fixes', () => {
  it('writes quoted CSS values in Tailwind classes so Tailwind can read them', async () => {
    const tree = page([createBranch({ tag: 'div', styles: { lg: { 'grid-template-areas': '"sidebar main"', 'font-family': '"Open Sans", serif', width: 'var(--side_width)' } } })]);
    const react = exportComponent(tree, { framework: 'react', styling: 'tailwind' }).files[0].contents;
    expect(react).toContain("[grid-template-areas:'sidebar_main']");
    expect(react).toContain("[font-family:'Open_Sans',serif]");
    expect(react).toContain('w-[var(--side\\_width)]');
    expect(react).not.toContain('className={');
    const vue = exportComponent(tree, { framework: 'vue', styling: 'tailwind' }).files[0].contents;
    expect(vue).not.toContain('&quot;');
  });

  it('absolutizes quoted url() paths holding parentheses', async () => {
    const { absolutizeCssUrls } = await import('./storybook-import');
    expect(absolutizeCssUrls('.a{background:url("img/a(1).png")} .b{background:url(img/b.png)} .c{background:url("")}', 'https://sb.example/assets/main.css')).toBe(
      '.a{background:url("https://sb.example/assets/img/a(1).png")} .b{background:url("https://sb.example/assets/img/b.png")} .c{background:url("")}',
    );
  });
});

describe('pass 26 fixes', () => {
  it('leaves plain ampersands raw and percent-encodes angle brackets in Tailwind url() classes', () => {
    const tree = page([
      createBranch({ tag: 'div', styles: { lg: { 'background-image': 'url("https://img.example/p?auto=format&fit=crop")' } } }),
      createBranch({ tag: 'i', styles: { lg: { 'background-image': 'url("data:image/svg+xml,<svg></svg>")' } } }),
    ]);
    for (const framework of ['html', 'react', 'vue', 'svelte'] as const) {
      const out = exportComponent(tree, { framework, styling: 'tailwind' }).files[0].contents;
      expect(out).toContain("[background-image:url('https://img.example/p?auto=format&fit=crop')]");
      expect(out).toContain("url('data:image/svg+xml,%3Csvg%3E%3C/svg%3E')");
    }
  });

  it('keeps line breaks and spaces of pre and white-space: pre branches in Markdown', () => {
    const tree = page([
      createBranch({ tag: 'pre', children: [text('line 1\n  indented\nline 3')] }),
      createBranch({ tag: 'p', styles: { lg: { 'white-space': 'pre-line' } }, children: [text('Roses\nViolets')] }),
    ]);
    const back = importDocument(exportTree(tree, 'markdown'), 'markdown');
    const root = back.kind === 'tree' ? back.tree.root : back.forest.trees[0].root;
    const texts = JSON.stringify(root);
    expect(texts).toContain('"line 1\\n  indented\\nline 3"');
    expect(texts).toContain('"Roses\\nViolets"');
  });
});

describe('pass 27 fixes', () => {
  const shape = (n: TreeNode): unknown => ('children' in n ? { [n.tag]: n.children.map(shape) } : n.type === 'text' ? n.value : n.type);
  const li = (t: string) => createBranch({ tag: 'li', children: [text(t)] });

  it('keeps two adjacent lists apart in Markdown', () => {
    const tree = page([createBranch({ tag: 'ul', children: [li('a')] }), createBranch({ tag: 'ul', children: [li('b')] }), createBranch({ tag: 'ol', children: [li('c')] }), createBranch({ tag: 'ol', children: [li('d')] })]);
    const back = importDocument(exportTree(tree, 'markdown'), 'markdown');
    const root = back.kind === 'tree' ? back.tree.root : back.forest.trees[0].root;
    expect(JSON.stringify(shape(root))).toBe(JSON.stringify(shape(tree.root)));
  });

  it('writes inline-block siblings without line breaks between them', () => {
    const item = (t: string) => createBranch({ tag: 'li', styles: { lg: { display: 'inline-block' } }, children: [text(t)] });
    const tree = page([createBranch({ tag: 'ul', children: [item('One'), item('Two')] })]);
    expect(exportTree(tree, 'html')).toMatch(/One<\/li><li[^>]*>Two/);
    expect(exportComponent(tree, { framework: 'svelte' }).files[0].contents).toMatch(/One<\/li><li[^>]*>Two/);
  });

  it('absolutizes @import strings from Storybook', async () => {
    const { absolutizeCssUrls } = await import('./storybook-import');
    expect(absolutizeCssUrls('@import "./tokens.css";', 'https://sb.example.com/assets/main.css')).toBe('@import url("https://sb.example.com/assets/tokens.css");');
  });

  it('writes a boolean prop in text as the editor shows it', () => {
    const def = createComponent('Flag', createBranch({ tag: 'p', children: [text('{{x}}')] }), { props: [{ name: 'x', type: 'boolean', default: 'false' }] } as never);
    expect(exportComponentDef(def, { framework: 'react' }).files[0].contents).toContain("{x ? 'true' : ''}");
    expect(exportComponentDef(def, { framework: 'vue' }).files[0].contents).toContain("{{ x ? 'true' : '' }}");
    expect(exportComponentDef(def, { framework: 'svelte' }).files[0].contents).toContain("{x ? 'true' : ''}");
  });
});

describe('pass 28 fixes', () => {
  it('drops attribute names with a dot, which Vue reads as binding modifiers', () => {
    const def = createComponent('Bio', createBranch({ tag: 'div', attrs: { 'inner-h-t-m-l.camel': '{{bio}}', 'href.prop': '{{bio}}' } }), { props: [{ name: 'bio', type: 'text', default: '<img src=x onerror=alert(1)>' }] } as never);
    for (const framework of ['vue', 'svelte', 'react'] as const) expect(exportComponentDef(def, { framework }).files[0].contents).not.toMatch(/camel|href\.prop/);
  });

  it('keeps inline content under the root on one line in HTML', () => {
    const html = exportTree(page([text('Price: '), createBranch({ tag: 'strong', children: [text('$5')] }), text('.')]), 'html');
    expect(html).toMatch(/Price: <strong[^>]*>\$5<\/strong>\./);
    const back = importDocument(html, 'html');
    const root = back.kind === 'tree' ? back.tree.root : back.forest.trees[0].root;
    expect(root.children.map((c) => ('value' in c ? c.value : c.tag))).toEqual(['Price: ', 'strong', '.']);
  });

  it('keeps a pre’s leading newline through Vue’s static stringifying', () => {
    const tree = page([createBranch({ tag: 'pre', children: [text('\nfirst line')] })]);
    expect(exportComponent(tree, { framework: 'vue' }).files[0].contents).toContain('{{ String("\\nfirst line") }}');
  });

  it('writes !important with Tailwind’s modifier', () => {
    const tree = page([createBranch({ tag: 'p', styles: { lg: { color: 'red !important' }, tablet: { color: 'blue' } }, children: [text('x')] })]);
    const out = exportComponent(tree, { framework: 'react', styling: 'tailwind' }).files.map((f) => f.contents).join('\n');
    expect(out).toContain('![color:red]');
    expect(out).not.toContain('important]');
  });
});

describe('pass 29 fixes', () => {
  const shape = (n: TreeNode): unknown => ('children' in n ? { [n.tag]: n.children.map(shape) } : n.type === 'text' ? n.value : n.type);
  const roundTrip = (tree: ReturnType<typeof page>) => {
    const back = importDocument(exportTree(tree, 'markdown'), 'markdown');
    return JSON.stringify(shape(back.kind === 'tree' ? back.tree.root : back.forest.trees[0].root));
  };

  it('keeps paragraphs and items that Markdown would read as an HTML block', () => {
    const area = () => createBranch({ tag: 'textarea', children: [text('notes')] });
    const em = () => createBranch({ tag: 'em', children: [text('this')] });
    for (const tree of [
      page([createBranch({ tag: 'p', children: [area(), text(' see '), em()] }), createBranch({ tag: 'p', children: [text('After')] })]),
      page([createBranch({ tag: 'ul', children: [createBranch({ tag: 'li', children: [area(), text(' see '), em()] })] })]),
      page([createBranch({ tag: 'p', children: [createBranch({ tag: 'br' })] }), createBranch({ tag: 'p', children: [text('After')] })]),
      page([createBranch({ tag: 'p', children: [createLeaf('photo.jpg', 'image', { alt: 'Team', width: '320' })] }), createBranch({ tag: 'p', children: [text('Caption')] })]),
    ])
      expect(roundTrip(tree)).toBe(JSON.stringify(shape(tree.root)));
  });

  it('keeps bold next to strikethrough', () => {
    const tree = page([createBranch({ tag: 'p', children: [createBranch({ tag: 'strong', children: [text('Price:')] }), createBranch({ tag: 'del', children: [text('$10')] }), text(' $8')] })]);
    expect(roundTrip(tree)).toBe(JSON.stringify(shape(tree.root)));
  });

  it('makes no Storybook control for text inside a textarea', () => {
    const tree = page([createBranch({ tag: 'textarea', name: 'Notes', children: [text('Hello')] })]);
    expect(exportStorybook(createForest('Site', [tree])).files.map((f) => f.content).join('\n')).not.toContain('notesText');
  });
});

describe('pass 30 fixes', () => {
  it('keeps a <p> holding a select or picture, and a heading holding a div', () => {
    const select = createBranch({ tag: 'select', children: [createBranch({ tag: 'option', children: [text('S')] })] });
    const tree = page([createBranch({ tag: 'p', children: [text('Size: '), select] }), createBranch({ tag: 'h1', children: [createBranch({ tag: 'div', children: [text('Title')] })] })]);
    const out = exportComponent(tree, { framework: 'svelte' }).files[0].contents;
    expect(out).toMatch(/<p[^>]*>Size: <select/);
    expect(out).toMatch(/<h1[^>]*>\s*<div/);
    expect(exportComponent(page([createBranch({ tag: 'p', children: [createBranch({ tag: 'div' })] })]), { framework: 'svelte' }).files[0].contents).not.toMatch(/<p[ >]/);
  });

  it('writes a loose run starting with a textarea as HTML in Markdown', () => {
    const tree = page([createBranch({ tag: 'p', children: [text('Intro')] }), createBranch({ tag: 'textarea', children: [text('notes')] }), text(' see '), createBranch({ tag: 'em', children: [text('this')] })]);
    const back = importDocument(exportTree(tree, 'markdown'), 'markdown');
    const root = back.kind === 'tree' ? back.tree.root : back.forest.trees[0].root;
    expect(root.children.map((c) => ('tag' in c ? c.tag : c.value))).toEqual(['p', 'textarea', ' see ', 'em']);
  });

  it('keeps a table part’s table around its Storybook story', () => {
    const row = createBranch({ tag: 'tr', name: 'Total row', children: [createBranch({ tag: 'td', children: [text('Total')] })] });
    const tree = page([createBranch({ tag: 'table', children: [createBranch({ tag: 'tbody', children: [row] })] })]);
    expect(exportStorybook(createForest('Site', [tree])).files.map((f) => f.content).join('\n')).toMatch(/<table><tbody><tr data-tw=\\"[^"\\]+\\" data-tw-name=\\"Total row\\"/);
  });
});

describe('pass 31 fixes', () => {
  it('never gives two branches the same class name', () => {
    const card = (name: string, color: string) => createBranch({ tag: 'div', name, styles: { lg: { color } }, children: [text(color)] });
    const html = exportComponent(page([card('Card', 'red'), card('Card', 'green'), card('Card 2', 'blue')]), { framework: 'html' }).files.find((f) => f.path.endsWith('.html'))!.contents;
    const classes = [...html.matchAll(/class="([^"]+)"/g)].map((m) => m[1]).filter((c) => c.includes('card'));
    expect(new Set(classes).size).toBe(3);
  });

  it('lets a shorthand set after its longhand win in Tailwind', () => {
    const tree = page([createBranch({ tag: 'div', styles: { lg: { 'padding-top': '20px', padding: '3px' } }, children: [text('x')] })]);
    const out = exportComponent(tree, { framework: 'html', styling: 'tailwind' }).files.map((f) => f.contents).join('\n');
    expect(out).toContain('pt-[20px] [&&]:p-[3px]');
  });

  it('exports inputs by type to SwiftUI and Flutter', () => {
    const tree = page([
      createBranch({ tag: 'input', attrs: { type: 'checkbox', name: 'terms' } }),
      createBranch({ tag: 'input', attrs: { type: 'password' } }),
      createBranch({ tag: 'input', attrs: { type: 'hidden', name: 'token' } }),
      createBranch({ tag: 'input', attrs: { type: 'submit', value: 'Send' } }),
    ]);
    const swift = exportComponent(tree, { framework: 'swiftui' }).files[0].contents;
    expect(swift).toContain('Toggle("", isOn: .constant(false))');
    expect(swift).toContain('SecureField(');
    expect(swift).not.toContain('"token"');
    expect(swift).not.toContain('TextField("terms"');
    expect(swift).toContain('Send');
    const dart = exportComponent(tree, { framework: 'flutter' }).files[0].contents;
    expect(dart).toContain('Checkbox(value: false');
    expect(dart).toContain('obscureText: true');
  });
});

describe('pass 32 fixes', () => {
  it('ships the Tailwind theme files with a component that uses token utilities', async () => {
    const { createTokenKit } = await import('@tree-weaver/core');
    const kits = [createTokenKit([{ name: '--brand', value: '#4f46e5' }])];
    const def = createComponent('Button', createBranch({ tag: 'button', styles: { lg: { background: 'var(--brand)' } }, children: [text('Go')] }));
    const paths = exportComponentDef(def, { framework: 'react', styling: 'tailwind', kits }).files.map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['tokens.json', 'tailwind.theme.css', 'tailwind.tokens.cjs']));
  });

  it('puts HTML inside a foreignObject in the XHTML namespace in .svg files', () => {
    const fo = createBranch({ tag: 'foreignObject', attrs: { width: '200', height: '100' }, children: [createBranch({ tag: 'p', children: [text('Hello')] }), text('loose')] });
    const tree = createTree('Drawing', createBranch({ tag: 'svg', type: 'root', attrs: { viewBox: '0 0 200 100' }, children: [fo] }));
    const svg = exportTree(tree, 'svg');
    expect(svg).toMatch(/<p xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/);
    expect(svg).not.toMatch(/<svg[^>]*xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/);
  });
});

describe('pass 33 fixes', () => {
  it('closes an image leaf in .svg files', () => {
    const div = createBranch({ tag: 'div', children: [createLeaf('logo.png', 'image', { alt: 'Logo' }), text('Caption')] });
    const tree = createTree('Drawing', createBranch({ tag: 'svg', type: 'root', attrs: { viewBox: '0 0 200 100' }, children: [createBranch({ tag: 'foreignObject', attrs: { width: '200', height: '100' }, children: [div] })] }));
    const svg = exportTree(tree, 'svg');
    expect(svg).toMatch(/<img [^>]*\/>/);
    const back = importDocument(svg, 'svg');
    expect(JSON.stringify(back)).toContain('Caption');
  });

  it('keeps a background token’s reset of the background image in Tailwind', async () => {
    const { createTokenKit } = await import('@tree-weaver/core');
    const kits = [createTokenKit([{ name: '--surface', value: '#fff' }])];
    const tree = page([createBranch({ tag: 'section', styles: { lg: { background: 'var(--surface)' }, tablet: { background: 'var(--surface)' } }, children: [text('x')] })]);
    const out = exportComponent(tree, { framework: 'html', styling: 'tailwind', kits }).files.map((f) => f.contents).join('\n');
    expect(out).toContain('bg-none bg-surface');
    expect(out).toContain('max-[1024.02px]:bg-none max-[1024.02px]:bg-surface');
  });

  it('bumps the later of two partly overlapping declarations in Tailwind', () => {
    const cls = (styles: Record<string, string>) =>
      /class="([^"]*)"/.exec(exportComponent(page([createBranch({ tag: 'div', styles: { lg: styles }, children: [text('x')] })]), { framework: 'html', styling: 'tailwind' }).files[0].contents.split('<body')[1])![1];
    expect(cls({ 'border-top-left-radius': '10px', 'border-radius': '4px' })).toContain('[&&]:rounded-[4px]');
    expect(cls({ 'padding-inline': '2rem', 'padding-left': '1rem' })).toContain('[&&]:pl-[1rem]');
    expect(cls({ 'border-bottom': '2px solid black', 'border-color': 'red' })).toMatch(/\[&&\]:\S*border-color|\[&&\]:border-\[red\]/);
    expect(cls({ padding: '1rem', 'padding-top': '2rem' })).not.toContain('[&&]');
  });
});

describe('pass 34 fixes', () => {
  it('keeps inline svg, custom elements and tspans on one line when pretty printing', () => {
    const icon = () => createBranch({ tag: 'svg', attrs: { width: '16', height: '16' } });
    const tree = page([createBranch({ tag: 'div', children: [icon(), icon()] }), createBranch({ tag: 'div', children: [createBranch({ tag: 'my-a', children: [text('A')] }), createBranch({ tag: 'my-a', children: [text('B')] })] })]);
    const html = exportTree(tree, 'html');
    expect(html).toMatch(/<\/svg><svg/);
    expect(html).toMatch(/A<\/my-a><my-a/);
  });

  it('keeps the spaces around an inline svg in a Markdown paragraph', () => {
    const tree = page([createBranch({ tag: 'p', children: [createBranch({ tag: 'my-stars', children: [text('5')] }), text(' stars')] })]);
    const back = importDocument(exportTree(tree, 'markdown'), 'markdown');
    const root = back.kind === 'tree' ? back.tree.root : back.forest.trees[0].root;
    expect(JSON.stringify(root)).toContain('" stars"');
  });

  it('lists only :root tokens outside media queries in the kit manifest', async () => {
    const { kitManifest } = await import('@tree-weaver/kits');
    const { createKit: kit } = await import('@tree-weaver/core');
    const m = kitManifest([kit('K', ':root{--text:#111} @media (prefers-color-scheme: dark){:root{--text:#eee}} .card{--pad:8px}')]);
    expect(m.tokens).toEqual([{ name: '--text', value: '#111' }]);
  });
});

describe('pass 35 fixes', () => {
  it('imports stylesheets in order, with their media, and skips ones that never apply', () => {
    const doc = importDocument(
      '<html><head><style>p{color:red}</style><link rel="stylesheet" href="https://x.example/theme.css"><link rel="stylesheet" media="print" href="https://x.example/print.css"><style media="print">h1{display:none}</style><link rel="alternate stylesheet" href="https://x.example/dark.css"><noscript><style>p{display:none}</style></noscript></head><body><p>Hi</p></body></html>',
      'html',
    );
    const kits = doc.kits.map((k) => k.href ?? k.css);
    expect(kits).toEqual(['p{color:red}', 'https://x.example/theme.css', '@import url("https://x.example/print.css") print;', '@media print {\nh1{display:none}\n}']);
  });

  it('keeps an inline parent’s children on one line in HTML component exports', () => {
    const a = createBranch({ tag: 'a', attrs: { href: '#' }, children: [createBranch({ tag: 'div', children: [text('Title')] }), createLeaf('i.png', 'image', { alt: '' })] });
    const html = exportComponent(page([createBranch({ tag: 'div', children: [a, createBranch({ tag: 'span', children: [text('after')] })] })]), { framework: 'html' }).files[0].contents;
    expect(html).toMatch(/<a [^>]*><div[^>]*>Title<\/div><img[^>]*><\/a><span/);
  });
});

describe('pass 36 fixes', () => {
  const rootOf = (doc: ReturnType<typeof importDocument>) => (doc.kind === 'tree' ? doc.tree.root : doc.forest.trees[0].root);

  it('keeps class and for as written on custom elements in JSX', () => {
    const tree = page([createBranch({ tag: 'my-badge', classes: ['k'], attrs: { for: 'x' }, children: [text('hi')] })]);
    const jsx = exportComponent(tree, { framework: 'react' }).files[0].contents;
    expect(jsx).toMatch(/<my-badge class="k[^"]*" for="x">/);
  });

  it('does not take Toggle, SecureField or Checkbox as a native component name', () => {
    const root = createBranch({ tag: 'label', children: [createBranch({ tag: 'input', attrs: { type: 'checkbox', 'aria-label': 'A' } })] });
    const def = createComponent('Toggle', root);
    expect(exportComponentDef(def, { framework: 'swiftui' }).entry).not.toBe('Toggle.swift');
    expect(exportComponentDef({ ...def, name: 'SecureField' }, { framework: 'swiftui' }).entry).not.toBe('SecureField.swift');
    expect(exportComponentDef({ ...def, name: 'Checkbox' }, { framework: 'flutter' }).files[0].contents).not.toMatch(/class Checkbox /);
  });

  it('keeps whitespace in SVG text with xml:space="preserve"', () => {
    const doc = importDocument('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text xml:space="preserve" x="0" y="5">a    b</text></svg>', 'svg');
    expect(JSON.stringify(rootOf(doc))).toContain('a    b');
  });

  it('keeps the space between inline-block elements on import', () => {
    const doc = importDocument('<body><div><div style="display:inline-block">A</div> <div style="display:inline-block">B</div></div></body>', 'html');
    const outer = rootOf(doc).children.find((c) => c.kind === 'branch') as Branch;
    expect(outer.children.map((c) => (c.kind === 'leaf' ? JSON.stringify(c.value) : c.tag))).toEqual(['div', '" "', 'div']);
  });

  it('finds classes in nested CSS rules', async () => {
    const { analyzeKit } = await import('@tree-weaver/kits');
    expect(analyzeKit('.card { padding: 1rem; & .card-title { font-weight: bold } .nested-child { color: red } }').classes).toEqual(['card', 'card-title', 'nested-child']);
  });

  it('maps only flex-start/flex-end justify and align keywords to Tailwind utilities', () => {
    const tree = page([createBranch({ tag: 'div', styles: { lg: { display: 'flex', 'flex-direction': 'row-reverse', 'justify-content': 'start' } }, children: [text('A')] })]);
    const out = exportComponent(tree, { framework: 'html', styling: 'tailwind' }).files.map((f) => f.contents).join('\n');
    expect(out).not.toMatch(/\bjustify-start\b/);
  });
});
