import { createBranch, createComponent, createForest, createLeaf, createTree, instantiateComponent, text, type Branch } from '@tree-weaver/core';
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
