import { describe, expect, it } from 'vitest';
import { applyPatch, findNode, isBranch, normalizeTree, PatchError, pathOf, resolveRef, TREE_WEAVER_PATCH_SCHEMA, type Branch } from './index';

const page = () =>
  normalizeTree({
    name: 'Page',
    root: {
      id: 'body',
      tag: 'body',
      children: [
        { id: 'nav', tag: 'nav', children: [{ id: 'brand', tag: 'strong', children: ['Brand'] }] },
        { id: 'main', tag: 'main', classes: ['container'], children: [{ id: 'title', tag: 'h1', children: [{ id: 'title-text', value: 'Hello' }] }] },
        { id: 'logo', tag: 'svg', attrs: { viewBox: '0 0 10 10' }, children: [] },
      ],
    },
  }).root;

const child = (b: Branch, i: number) => b.children[i] as Branch;

describe('resolveRef', () => {
  it('finds nodes by id and by path', () => {
    const root = page();
    expect(resolveRef(root, '/1/0').node.id).toBe('title');
    expect(resolveRef(root, 'title')).toMatchObject({ path: '/1/0' });
    expect(resolveRef(root, '/').node).toBe(root);
    expect(() => resolveRef(root, '/9')).toThrow(/does not exist; there are 3 children/);
    expect(() => resolveRef(root, 'nope')).toThrow(/No branch or leaf with id "nope"/);
  });
});

describe('applyPatch', () => {
  it('inserts, moves, styles and removes in one go, without touching the input', () => {
    const root = page();
    const result = applyPatch(root, [
      { op: 'insert', parent: 'main', node: { id: 'intro', tag: 'p', classes: ['muted'], children: ['Welcome'] } },
      { op: 'insert', parent: 'main', index: 0, node: 'Kicker' },
      { op: 'move', target: 'brand', parent: 'main', index: 0 },
      { op: 'setStyles', target: 'main', styles: { padding: '2rem', tablet: { padding: '1rem' } } },
      { op: 'remove', target: '/0' },
    ]);
    const main = findNode(result.root, 'main') as Branch;
    expect(main.children.map((c) => (isBranch(c) ? c.id : c.value))).toEqual(['brand', 'Kicker', 'title', 'intro']);
    expect(main.styles).toEqual({ lg: { padding: '2rem' }, tablet: { padding: '1rem' } });
    expect(findNode(result.root, 'nav')).toBeNull();
    expect(result.changes.map((c) => [c.kind, c.path])).toEqual([
      ['insert', '/0/3'],
      ['insert', '/0/1'],
      ['move', '/0/0'],
      ['setStyles', '/0'],
      ['remove', null],
    ]);
    // The input is unchanged.
    expect(findNode(root, 'nav')).not.toBeNull();
    expect(child(root, 1).children).toHaveLength(1);
  });

  it('applies all or nothing, naming the failing op', () => {
    const root = page();
    let error: unknown;
    try {
      applyPatch(root, [
        { op: 'insert', parent: 'main', node: 'ok' },
        { op: 'insert', parent: 'title-text', node: 'no' },
      ]);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(PatchError);
    expect((error as PatchError).op).toBe(1);
    expect((error as Error).message).toMatch(/^ops\[1\]: "parent" \/1\/0\/0 is a leaf/);
    expect(child(root, 1).children).toHaveLength(1);
  });

  it('rejects nodes the validator rejects, and unsafe attributes', () => {
    const root = page();
    expect(() => applyPatch(root, [{ op: 'insert', node: { tag: 'a', attrs: { onclick: 'x()' } } }])).toThrow(/Event handler "onclick"/);
    expect(() => applyPatch(root, [{ op: 'update', target: 'main', attrs: { href: 'javascript:alert(1)' } }])).toThrow(/not rendered/);
    expect(() => applyPatch(root, [{ op: 'setStyles', target: 'main', styles: { phone: { gap: '1px' } } }])).toThrow(/Unknown display "phone"/);
    expect(() => applyPatch(root, [{ op: 'explode', target: 'main' }])).toThrow(/Unknown op "explode"/);
  });

  it('keeps ids unique and SVG rules in force', () => {
    const root = page();
    const result = applyPatch(root, [{ op: 'insert', parent: 'main', node: { id: 'title', tag: 'h2', children: ['Again'] } }]);
    expect(result.changes[0].id).not.toBe('title');
    expect(() => applyPatch(root, [{ op: 'insert', parent: 'logo', node: { tag: 'p', children: ['x'] } }])).toThrow(/can't be drawn inside an SVG/);
    const drawn = applyPatch(root, [{ op: 'insert', parent: 'logo', node: { type: 'shape', value: 'circle', attrs: { cx: '5', cy: '5', r: '4' } } }]);
    expect(drawn.warnings).toEqual([]);
  });

  it('updates fields, classes, attributes and text', () => {
    const root = page();
    const { root: next } = applyPatch(root, [
      { op: 'update', target: 'main', tag: 'section', name: 'Content', addClasses: 'stack wide', removeClasses: ['container'], attrs: { 'aria-label': 'Content' } },
      { op: 'setText', target: 'title', value: 'Hi there' },
      { op: 'setText', target: 'brand', value: 'Tree Weaver' },
      { op: 'duplicate', target: 'title' },
      { op: 'wrap', target: 'nav', node: { tag: 'header', name: 'Header' } },
    ]);
    const main = findNode(next, 'main') as Branch;
    expect(main).toMatchObject({ tag: 'section', name: 'Content', classes: ['stack', 'wide'], attrs: { 'aria-label': 'Content' } });
    expect(findNode(next, 'title-text')).toMatchObject({ value: 'Hi there' });
    expect(main.children).toHaveLength(2);
    expect(pathOf(next, 'nav')).toBe('/0/0');
    expect(child(next, 0).tag).toBe('header');
  });

  it('uses a custom node expander', () => {
    const root = page();
    const { root: next } = applyPatch(root, [{ op: 'insert', parent: 'main', node: 'h2: Pricing' }], {
      expandNode: (value) => ({ kind: 'branch', id: 'x', tag: 'h2', classes: [], attrs: {}, styles: {}, children: [{ kind: 'leaf', id: 'y', type: 'text', value: String(value).slice(4) }] }),
    });
    expect(findNode(next, 'y')).toMatchObject({ value: 'Pricing' });
  });

  it('accepts { ops: [...] } and a single op', () => {
    const root = page();
    expect(applyPatch(root, { ops: [{ op: 'remove', target: 'nav' }] }).changes).toHaveLength(1);
    expect(applyPatch(root, { op: 'remove', target: 'nav' }).changes).toHaveLength(1);
    expect(() => applyPatch(root, 'nope')).toThrow(/A patch is a list of operations/);
    expect(() => applyPatch(root, [{ op: 'remove', target: '/' }])).toThrow(/root branch can't be removed/);
  });

  it('has a schema naming every op', () => {
    const ops = TREE_WEAVER_PATCH_SCHEMA.$defs.op.oneOf.map((o) => o.properties.op.const);
    expect(ops).toEqual(['insert', 'replace', 'remove', 'move', 'duplicate', 'wrap', 'update', 'setStyles', 'setText']);
  });
});
