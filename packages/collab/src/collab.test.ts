import { describe, expect, it } from 'vitest';
import { createBranch, createForest, createKit, createTree, insertNode, moveNode, removeNode, setStyle, text, type Branch, type Forest, type Tree } from '@tree-weaver/core';
import { keyBetween, pruneStrays, LOCAL_ORIGIN, newRoom, orderKeys, parseRoomHash, readForest, roomHash, sharedTypes, writeForest, Y } from './index';

const b = (id: string, init: Parameters<typeof createBranch>[0]): Branch => ({ ...createBranch(init), id });

function sample(): Forest {
  const root = b('root', { tag: 'body' });
  root.children = [b('h', { tag: 'header', name: 'Header' }), b('m', { tag: 'main', name: 'Main', children: [{ ...text('Hello'), id: 'txt' }] }), b('f', { tag: 'footer', name: 'Footer' })];
  const tree: Tree = { ...createTree('Home', root), id: 't1' };
  const forest = { ...createForest('Site', [tree]), id: 'forest1' };
  forest.kits = [{ ...createKit('Base', 'body{}'), id: 'k1' }];
  return forest;
}

const withRoot = (f: Forest, fn: (root: Branch) => Branch): Forest => ({ ...f, trees: f.trees.map((t, i) => (i === 0 ? { ...t, root: fn(t.root) } : t)) });

/** Two peers that exchange every update. */
function pair() {
  const a = new Y.Doc();
  const c = new Y.Doc();
  a.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(c, u, 'remote'));
  c.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(a, u, 'remote'));
  return { a, c };
}

/** Two peers that are offline from each other until `sync()`. */
function offline() {
  const a = new Y.Doc();
  const c = new Y.Doc();
  const sync = () => {
    Y.applyUpdate(c, Y.encodeStateAsUpdate(a, Y.encodeStateVector(c)), 'remote');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(c, Y.encodeStateVector(a)), 'remote');
  };
  return { a, c, sync };
}

const strip = (f: Forest | null) => JSON.parse(JSON.stringify(f));

describe('order keys', () => {
  it('makes keys between any two keys', () => {
    let keys = [keyBetween(undefined, undefined)];
    for (let i = 0; i < 40; i++) keys = [keyBetween(undefined, keys[0]), ...keys];
    for (let i = 0; i < 40; i++) keys.push(keyBetween(keys[keys.length - 1], undefined));
    for (let i = 0; i < 40; i++) keys.splice(1, 0, keyBetween(keys[0], keys[1]));
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps keys in order and only re-keys what moved', () => {
    const old = { a: '1', b: '2', c: '3', d: '4' } as Record<string, string>;
    const next = orderKeys(['b', 'c', 'd', 'a'], (id) => old[id]);
    expect([next.get('b'), next.get('c'), next.get('d')]).toEqual(['2', '3', '4']);
    expect(next.get('a')! > '4').toBe(true);
  });
});

describe('forest documents', () => {
  it('round-trips a forest', () => {
    const doc = new Y.Doc();
    const f = sample();
    writeForest(doc, null, f);
    expect(strip(readForest(doc))).toEqual({ ...strip(f), updatedAt: expect.any(String) });
  });

  it('merges concurrent edits to different nodes and to different parts of one node', () => {
    const { a, c, sync } = offline();
    const base = sample();
    writeForest(a, null, base);
    sync();
    const fa = readForest(a)!;
    const fc = readForest(c)!;
    // A changes the header's tablet styles and the text; C changes the header's base styles and adds a node.
    const na = withRoot(fa, (r) => {
      const s = setStyle(r, 'h', 'tablet', 'padding', '1rem');
      return { ...s, children: s.children.map((n) => (n.id === 'm' ? { ...(n as Branch), children: [{ ...text('Hi'), id: 'txt' }] } : n)) };
    });
    writeForest(a, fa, na);
    const nc = withRoot(fc, (r) => insertNode(setStyle(r, 'h', 'lg', 'color', 'red'), 'root', b('new', { tag: 'aside', name: 'Aside' })));
    writeForest(c, fc, nc);
    sync();
    const ra = strip(readForest(a));
    expect(ra).toEqual(strip(readForest(c)));
    const root = ra.trees[0].root;
    expect(root.children.map((n: Branch) => n.id)).toEqual(['h', 'm', 'f', 'new']);
    expect(root.children[0].styles).toEqual({ lg: { color: 'red' }, tablet: { padding: '1rem' } });
    expect(root.children[1].children[0].value).toBe('Hi');
  });

  it('moves a node without touching its siblings, and resolves concurrent moves of one node', () => {
    const { a, c, sync } = offline();
    writeForest(a, null, sample());
    sync();
    const fa = readForest(a)!;
    const fc = readForest(c)!;
    writeForest(a, fa, withRoot(fa, (r) => moveNode(r, 'f', 'root', 0)));
    writeForest(c, fc, withRoot(fc, (r) => moveNode(r, 'f', 'm')));
    sync();
    const ra = readForest(a)!;
    expect(strip(ra)).toEqual(strip(readForest(c)));
    // The node is in exactly one place.
    const ids = JSON.stringify(ra).match(/"id":"f"/g);
    expect(ids).toHaveLength(1);
  });

  it('keeps work added under a branch someone else deleted', () => {
    const { a, c, sync } = offline();
    writeForest(a, null, sample());
    sync();
    const fa = readForest(a)!;
    const fc = readForest(c)!;
    writeForest(a, fa, withRoot(fa, (r) => removeNode(r, 'm')));
    writeForest(c, fc, withRoot(fc, (r) => insertNode(r, 'm', b('kid', { tag: 'p', name: 'Kid' }))));
    sync();
    const root = readForest(a)!.trees[0].root;
    expect(root.children.map((n) => n.id)).toEqual(['h', 'f', 'kid']);
    expect(strip(readForest(a))).toEqual(strip(readForest(c)));
  });

  it('breaks a loop made by two concurrent moves', () => {
    const { a, c, sync } = offline();
    const base = withRoot(sample(), (r) => ({ ...r, children: [b('x', { tag: 'div' }), b('y', { tag: 'div' })] }));
    writeForest(a, null, base);
    sync();
    const fa = readForest(a)!;
    const fc = readForest(c)!;
    writeForest(a, fa, withRoot(fa, (r) => moveNode(r, 'x', 'y')));
    writeForest(c, fc, withRoot(fc, (r) => moveNode(r, 'y', 'x')));
    sync();
    const f = readForest(a)!;
    expect(strip(f)).toEqual(strip(readForest(c)));
    expect(JSON.stringify(f).match(/"id":"[xy]"/g)).toHaveLength(2);
  });

  it('merges two copies of the same forest without duplicating anything', () => {
    const { a, c, sync } = offline();
    writeForest(a, null, sample());
    writeForest(c, null, sample());
    sync();
    const f = readForest(a)!;
    expect(f.trees).toHaveLength(1);
    expect(f.trees[0].root.children.map((n) => n.id)).toEqual(['h', 'm', 'f']);
  });

  it('syncs trees, kits and names live', () => {
    const { a, c } = pair();
    const f = sample();
    writeForest(a, null, f);
    const extra = { ...createTree('About'), id: 't2' };
    const next = { ...f, name: 'Shop', trees: [extra, ...f.trees], kits: [...f.kits, { ...createKit('More', 'p{}'), id: 'k2' }] };
    writeForest(a, f, next);
    const r = readForest(c)!;
    expect(r.name).toBe('Shop');
    expect(r.trees.map((t) => t.id)).toEqual(['t2', 't1']);
    expect(r.kits.map((k) => k.id)).toEqual(['k1', 'k2']);
    writeForest(a, next, { ...next, trees: [f.trees[0]] });
    expect(readForest(c)!.trees.map((t) => t.id)).toEqual(['t1']);
  });

  it('prunes nodes added to a tree someone else deleted', () => {
    const { a, c, sync } = offline();
    const f = sample();
    const extra = { ...createTree('About'), id: 't2' };
    const both = { ...f, trees: [...f.trees, extra] };
    writeForest(a, null, both);
    sync();
    const fa = readForest(a)!;
    const fc = readForest(c)!;
    writeForest(a, fa, { ...fa, trees: [fa.trees[0]] });
    writeForest(c, fc, { ...fc, trees: [fc.trees[0], { ...fc.trees[1], root: insertNode(fc.trees[1].root, fc.trees[1].root.id, b('late', { tag: 'p' })) }] });
    sync();
    expect(readForest(a)!.trees).toHaveLength(1);
    expect(pruneStrays(a)).toBe(1);
    expect(pruneStrays(a)).toBe(0);
  });

  it('undoes only local changes', () => {
    const { a, c } = pair();
    const f = sample();
    writeForest(a, null, f, 'setup');
    const undo = new Y.UndoManager(sharedTypes(a), { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    const mine = withRoot(f, (r) => removeNode(r, 'f'));
    writeForest(a, f, mine);
    const fc = readForest(c)!;
    writeForest(c, fc, withRoot(fc, (r) => setStyle(r, 'h', 'lg', 'color', 'blue')));
    undo.undo();
    const r = readForest(a)!.trees[0].root;
    expect(r.children.map((n) => n.id)).toEqual(['h', 'm', 'f']);
    expect((r.children[0] as Branch).styles.lg).toEqual({ color: 'blue' });
  });
});

describe('rooms', () => {
  it('puts the room and key in the hash', () => {
    const room = newRoom();
    expect(parseRoomHash(`#${roomHash(room)}`)).toEqual(room);
    expect(parseRoomHash('#doc=abc&' + roomHash(room))).toEqual(room);
    expect(parseRoomHash('#collab=nope')).toBeNull();
  });
});

describe('components over collab', () => {
  it('carries component definitions and instance links', () => {
    const f = sample();
    const forest: Forest = {
      ...withRoot(f, (root) => ({ ...root, children: root.children.map((c) => (c.id === 'h' ? { ...(c as Branch), instance: { component: 'c1', props: { title: 'Hi' } } } : c)) })),
      components: [{ id: 'c1', name: 'Card', root: b('cr', { tag: 'div' }), props: [], variants: [] }],
    };
    const doc = new Y.Doc();
    writeForest(doc, null, forest);
    const back = readForest(doc)!;
    expect(back.components).toEqual(forest.components);
    expect((back.trees[0].root.children[0] as Branch).instance).toEqual({ component: 'c1', props: { title: 'Hi' } });
  });

  it('drops kit links that are not stylesheet URLs', () => {
    const f = sample();
    f.kits = [{ ...f.kits[0], href: 'javascript:alert(1)' }];
    const doc = new Y.Doc();
    writeForest(doc, null, f);
    expect(readForest(doc)!.kits[0].href).toBeUndefined();
  });
});

describe('concurrent component saves', () => {
  it('keeps both components', () => {
    const { a, c, sync } = offline();
    const f = sample();
    writeForest(a, null, f);
    sync();
    const base = readForest(c)!;
    const def = (id: string) => ({ id, name: id, root: b(`${id}r`, { tag: 'div' }), props: [], variants: [] });
    writeForest(a, base, { ...base, components: [def('A')] });
    writeForest(c, base, { ...base, components: [def('B')] });
    sync();
    expect(readForest(a)!.components!.map((x) => x.id).sort()).toEqual(['A', 'B']);
    expect(strip(readForest(a))).toEqual(strip(readForest(c)));
  });
});

describe('peer data that is not a string', () => {
  it('falls back for tree and forest names that are not strings', () => {
    const doc = new Y.Doc();
    writeForest(doc, null, sample());
    const t = [...doc.getMap<Y.Map<unknown>>('trees').values()][0];
    t.set('name', 42);
    doc.getMap<unknown>('forest').set('name', { x: 1 });
    const f = readForest(doc)!;
    expect(f.trees[0].name).toBe('Untitled tree');
    expect(f.name).toBe('Shared forest');
  });
});

describe('peer kits and components', () => {
  it('skips a malformed kit instead of throwing', () => {
    const doc = new Y.Doc();
    writeForest(doc, null, sample());
    const kits = doc.getMap<Y.Map<unknown>>('kits');
    const bad = new Y.Map<unknown>();
    kits.set('bad', bad);
    bad.set('order', 'zz');
    bad.set('data', JSON.stringify({ name: 'Bad', css: '', enabled: true, tokens: [null] }));
    const f = readForest(doc)!;
    expect(f.kits.some((k) => k.id === 'bad')).toBe(false);
  });
});

describe('malformed order keys from peers', () => {
  it('makes fresh keys instead of looping forever', () => {
    expect(keyBetween(undefined, '0')).toMatch(/^[0-9a-z]*[1-9a-z]$/);
    expect(keyBetween('a', 'A')).toMatch(/^[0-9a-z]*[1-9a-z]$/);
    const keys = orderKeys(['x', 'y', 'z'], (id) => ({ y: '0', z: 'A' })[id]);
    const list = ['x', 'y', 'z'].map((id) => keys.get(id)!);
    expect([...list].sort()).toEqual(list);
    expect(new Set(list).size).toBe(3);
  });
});

describe('entries from peers that are not maps', () => {
  it('reads, prunes and writes around them, and cuts very deep nesting', () => {
    const doc = new Y.Doc();
    const f = sample();
    writeForest(doc, null, f);
    doc.getMap('nodes').set('junk', 'boom');
    doc.getMap('trees').set('junk', 'boom');
    doc.getMap('kits').set('junk', 7);
    doc.getMap('components').set('junk', null);
    expect(() => pruneStrays(doc)).not.toThrow();
    const read = readForest(doc)!;
    expect(read.trees).toHaveLength(f.trees.length);
    const tree = read.trees[0];
    doc.getMap('nodes').set(tree.root.children[0]?.id ?? 'x', 'boom');
    expect(() => writeForest(doc, read, withRoot(read, (r) => r))).not.toThrow();
  });

  it('cuts a peer chain deeper than any layout', () => {
    const doc = new Y.Doc();
    const f = sample();
    writeForest(doc, null, f);
    const nodes = doc.getMap<Y.Map<unknown>>('nodes');
    const treeId = f.trees[0].id;
    let parent = f.trees[0].root.id;
    doc.transact(() => {
      for (let i = 0; i < 5000; i++) {
        const n = new Y.Map<unknown>();
        n.set('kind', 'branch');
        n.set('tree', treeId);
        n.set('parent', parent);
        n.set('order', 'i');
        n.set('tag', 'div');
        nodes.set(`deep${i}`, n);
        parent = `deep${i}`;
      }
    });
    expect(() => readForest(doc)).not.toThrow();
  });
});

describe('pass 19 fixes', () => {
  it('keeps a re-attached orphan where the editor shows it after an edit', async () => {
    const core = await import('@tree-weaver/core');
    const S = core.createBranch({ tag: 'section', name: 'S' });
    const T = core.createBranch({ tag: 'div', name: 'T' });
    const tree = core.createTree('Home');
    tree.root = { ...tree.root, children: [S, T] };
    const base = core.createForest('F', [tree]);
    const a = new Y.Doc();
    const b = new Y.Doc();
    writeForest(a, null, base);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    let fa = readForest(a)!;
    let fb = readForest(b)!;
    const names = (f: typeof base) => f.trees[0].root.children.map((c) => ('name' in c ? c.name : '')).join(',');
    const na = core.replaceTree(fa, { ...fa.trees[0], root: core.removeNode(fa.trees[0].root, S.id) });
    writeForest(a, fa, na);
    const X = core.createBranch({ tag: 'p', name: 'X' });
    const nb = core.replaceTree(fb, { ...fb.trees[0], root: core.insertNode(fb.trees[0].root, S.id, X) });
    writeForest(b, fb, nb);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    fb = readForest(b)!;
    const nb2 = core.replaceTree(fb, { ...fb.trees[0], root: core.setStyle(fb.trees[0].root, X.id, 'lg', 'color', 'red') });
    writeForest(b, fb, nb2);
    expect(names(readForest(b)!)).toBe(names(nb2));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    fa = readForest(a)!;
    expect(names(fa)).toBe(names(nb2));
  });
});

describe('pass 29 fixes', () => {
  it('merges concurrent edits to different tokens, rules and style properties', async () => {
    const { setToken, createTokenKit, createCustomKit, createRule } = await import('@tree-weaver/core');
    const start = { ...sample(), kits: [createTokenKit([{ name: '--brand', value: 'red' }, { name: '--space', value: '8px' }]), createCustomKit('Custom', [createRule('.card', { lg: { padding: '8px' } }), createRule('.btn', { lg: { color: 'red' } })])] };
    const { a, c, sync } = offline();
    writeForest(a, null, start);
    sync();
    const fa = readForest(a)!;
    const fc = readForest(c)!;
    const editRule = (f: Forest, sel: string, styles: Record<string, string>): Forest => ({
      ...f,
      kits: f.kits.map((k, i) => (i === 1 ? { ...k, rules: k.rules!.map((r) => (r.selector === sel ? { ...r, styles: { lg: styles } } : r)) } : k)),
    });
    writeForest(a, fa, withRoot(editRule({ ...fa, kits: setToken(fa.kits, { name: '--brand', value: 'blue' }) }, '.card', { padding: '24px' }), (r) => setStyle(r, 'h', 'lg', 'color', 'blue')));
    writeForest(c, fc, withRoot(editRule({ ...fc, kits: setToken(fc.kits, { name: '--space', value: '16px' }) }, '.btn', { color: 'green' }), (r) => setStyle(r, 'h', 'lg', 'margin', '0')));
    sync();
    for (const doc of [a, c]) {
      const f = readForest(doc)!;
      expect(f.kits[0].tokens).toEqual([{ name: '--brand', value: 'blue' }, { name: '--space', value: '16px' }]);
      expect(f.kits[0].css).toContain('--brand: blue');
      expect(f.kits[1].rules!.map((r) => [r.selector, r.styles.lg])).toEqual([['.card', { padding: '24px' }], ['.btn', { color: 'green' }]]);
      expect(f.kits[1].css).toContain('padding: 24px');
      expect((f.trees[0].root.children[0] as Branch).styles.lg).toEqual({ color: 'blue', margin: '0' });
    }
  });

  it('reads a style or attribute named __proto__ as data', () => {
    const doc = new Y.Doc();
    writeForest(doc, null, sample());
    const node = doc.getMap<Y.Map<unknown>>('nodes').get('h')!;
    doc.transact(() => {
      node.set('a:__proto__', 'x');
      node.set('sp:lg:__proto__', 'y');
    });
    const h = readForest(doc)!.trees[0].root.children[0] as Branch;
    expect(Object.getPrototypeOf(h.attrs)).toBe(Object.prototype);
    expect(Object.hasOwn(h.attrs, '__proto__')).toBe(true);
    expect(Object.hasOwn(h.styles.lg!, '__proto__')).toBe(true);
  });
});

describe('pass 31 fixes', () => {
  it('merges concurrent edits to different attributes of one leaf', async () => {
    const { createLeaf } = await import('@tree-weaver/core');
    const img = { ...createLeaf('a.png', 'image', { alt: 'old', width: '100' }), id: 'img' };
    const start = withRoot(sample(), (r) => ({ ...r, children: [...r.children, img] }));
    const { a, c, sync } = offline();
    writeForest(a, null, start);
    sync();
    const fa = readForest(a)!;
    const fc = readForest(c)!;
    const setAttr = (f: Forest, k: string, v: string) => withRoot(f, (r) => ({ ...r, children: r.children.map((n) => (n.id === 'img' ? { ...n, attrs: { ...(n as typeof img).attrs, [k]: v } } : n)) }));
    writeForest(a, fa, setAttr(fa, 'alt', 'A alt'));
    writeForest(c, fc, setAttr(fc, 'width', '300'));
    sync();
    for (const doc of [a, c]) expect((readForest(doc)!.trees[0].root.children.find((n) => n.id === 'img') as typeof img).attrs).toEqual({ alt: 'A alt', width: '300' });
  });
});
