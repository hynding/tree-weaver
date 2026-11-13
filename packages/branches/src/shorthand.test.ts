import { isBranch, normalizeTree, validateDocument, type Branch, type Leaf } from '@tree-weaver/core';
import { describe, expect, it } from 'vitest';
import { expandShorthand, expandShorthandDocument, parseSelector } from './index';

const b = (v: unknown) => expandShorthand(v) as Branch;

describe('shorthand strings', () => {
  it('reads "tag.class#id[attr]: text"', () => {
    expect(b('h2: Pricing')).toMatchObject({ tag: 'h2', classes: [], children: [{ kind: 'leaf', type: 'text', value: 'Pricing' }] });
    expect(b('a.btn.btn-primary[href=/join][target="_blank"]: Join')).toMatchObject({ tag: 'a', classes: ['btn', 'btn-primary'], attrs: { href: '/join', target: '_blank' } });
    expect(b('section#pricing:')).toMatchObject({ tag: 'section', attrs: { id: 'pricing' }, children: [] });
  });

  it('leaves ordinary text alone', () => {
    for (const s of ['Price: $5', 'Note: read this', 'hello', 'nope: x', '12:30']) expect(expandShorthand(s)).toMatchObject({ kind: 'leaf', type: 'text', value: s });
    expect(expandShorthand('\\h2: literally')).toMatchObject({ kind: 'leaf', value: 'h2: literally' });
  });

  it('reads images and blueprints', () => {
    expect(expandShorthand('img: https://example.com/a.png | A dog')).toMatchObject({ type: 'image', value: 'https://example.com/a.png', attrs: { alt: 'A dog' } });
    expect(b('@card')).toMatchObject({ tag: 'article', type: 'card' });
    expect(() => expandShorthand('@nope')).toThrow(/No blueprint "nope"/);
  });
});

describe('shorthand objects', () => {
  it('names an element with one key', () => {
    const list = b({ 'ul.plain': ['li: One', 'li: Two'], styles: { gap: '1rem', tablet: { gap: '0' } } });
    expect(list).toMatchObject({ tag: 'ul', classes: ['plain'], styles: { lg: { gap: '1rem' }, tablet: { gap: '0' } } });
    expect(list.children.map((c) => (c as Branch).tag)).toEqual(['li', 'li']);
    // A string value is text, as written.
    expect(b({ p: 'h2: not parsed' }).children[0]).toMatchObject({ value: 'h2: not parsed' });
    expect(b({ a: 'Docs', href: '/docs', id: 'docs-link' })).toMatchObject({ id: 'docs-link', attrs: { href: '/docs' } });
  });

  it('builds layouts through the blueprints', () => {
    const grid = b({ grid: 3, children: ['@card', '@card', '@card'] });
    expect(grid).toMatchObject({ type: 'grid', styles: { lg: { display: 'grid' }, tablet: {}, 'mobile-portrait': { 'grid-template-columns': '1fr' } } });
    expect(grid.children).toHaveLength(3);
    expect(b({ grid: '2fr 1fr', children: ['main:', 'aside:'] }).styles.lg).toMatchObject({ 'grid-template-columns': '2fr 1fr' });
    expect(b({ row: ['@button', 'a: More'] })).toMatchObject({ type: 'flex-row' });
    expect(b({ column: ['p: a'] })).toMatchObject({ type: 'flex-column' });
    const section = b({ section: ['h2: Features'], name: 'Features', classes: 'dark' });
    expect(section).toMatchObject({ tag: 'section', name: 'Features', classes: ['section', 'dark'] });
    expect((section.children[0] as Branch).children[0]).toMatchObject({ tag: 'h2' });
  });

  it('builds tables', () => {
    const table = b({ table: [['Plan', 'Price'], ['Basic', '$5'], ['Pro', { strong: '$9' }]] });
    expect(table.children.map((c) => (c as Branch).tag)).toEqual(['thead', 'tbody']);
    const body = table.children[1] as Branch;
    expect(body.children).toHaveLength(2);
    expect(b({ table: [['a', 'b']], header: false }).children.map((c) => (c as Branch).tag)).toEqual(['tbody']);
  });

  it('applies changes on top of a blueprint', () => {
    const hero = b({ use: 'hero', id: 'hero', classes: ['dark'], styles: { padding: '6rem 0' } });
    expect(hero).toMatchObject({ id: 'hero', type: 'hero', classes: ['hero', 'dark'], styles: { lg: { padding: '6rem 0' } } });
    expect(b({ use: 'card', children: ['h3: Custom'] }).children).toHaveLength(1);
  });

  it('passes canonical nodes through, expanding their children and flat styles', () => {
    const node = b({ tag: 'div', styles: { display: 'flex' }, children: ['h2: Title', { kind: 'leaf', type: 'text', value: 'h2: kept' }] });
    expect(node.styles).toEqual({ lg: { display: 'flex' } });
    expect(node.children[0]).toMatchObject({ tag: 'h2' });
    expect(node.children[1]).toMatchObject({ value: 'h2: kept' });
  });

  it('explains mistakes with a path', () => {
    expect(() => expandShorthand({ h2: 'a', p: 'b' })).toThrow(/Found "h2", "p"; a shorthand object names one element/);
    expect(() => expandShorthand({ widget: [] })).toThrow(/"widget" is not an element/);
    expect(() => expandShorthand({ tablet: {} })).toThrow(/"tablet" is a display/);
    expect(() => expandShorthand({ div: [{ grid: 0, children: [] }] })).toThrow(/at node\.children\[0\]\.grid/);
    expect(() => expandShorthand(['a'])).toThrow(/A list is not a node/);
  });

  it('parses selectors only for known elements', () => {
    expect(parseSelector('nav.main')).toEqual({ tag: 'nav', classes: ['main'], attrs: {} });
    expect(parseSelector('linearGradient#g')).toMatchObject({ tag: 'linearGradient', attrs: { id: 'g' } });
    expect(parseSelector('Note')).toBeNull();
  });
});

describe('shorthand documents', () => {
  const landing = [
    { 'nav.nav': ['strong: Brand', { row: ['a[href=#features]: Features', 'a[href=#pricing]: Pricing'] }] },
    { use: 'hero' },
    { section: ['h2: Features', { grid: 3, children: ['@card', '@card', '@card'] }], name: 'Features', attrs: { id: 'features' } },
    { section: ['h2: Pricing', { table: [['Plan', 'Price'], ['Basic', '$5']] }], name: 'Pricing', attrs: { id: 'pricing' } },
    { footer: 'p.muted: Made with Tree Weaver' },
  ];

  it('expands a bare list into a valid tree', () => {
    const doc = expandShorthandDocument(landing);
    const result = validateDocument(JSON.parse(JSON.stringify(doc)));
    expect(result.errors).toEqual([]);
    const tree = normalizeTree((doc as { tree: unknown }).tree);
    expect(tree.root.tag).toBe('body');
    expect(tree.root.children.map((c) => (isBranch(c) ? c.tag : (c as Leaf).value))).toEqual(['nav', 'section', 'section', 'section', 'footer']);
    // Ids are unique across the whole tree.
    const ids = JSON.stringify(doc).match(/"id":"[^"]+"/g)!;
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is much shorter than the canonical tree it makes', () => {
    const short = JSON.stringify(landing).length;
    const full = JSON.stringify(expandShorthandDocument(landing)).length;
    expect(full).toBeGreaterThan(short * 5);
  });

  it('expands envelopes, trees and forests', () => {
    const tree = expandShorthandDocument({ format: 'tree-weaver', version: 1, tree: { name: 'T', root: { body: ['h1: Hi'] } } }) as { tree: { root: Branch } };
    expect(tree.tree.root.children[0]).toMatchObject({ tag: 'h1' });
    const forest = expandShorthandDocument({ forest: { name: 'F', trees: [{ name: 'A', root: ['p: a'] }, { name: 'B', root: ['p: b'] }] } }) as { forest: { trees: { root: Branch }[] } };
    expect(forest.forest.trees.map((t) => (t.root.children[0] as Branch).tag)).toEqual(['p', 'p']);
    expect(() => expandShorthandDocument({ tree: { name: 'x' } })).toThrow(/no "root"/);
  });
});
