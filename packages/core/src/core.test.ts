import { describe, expect, it } from 'vitest';
import {
  addTableColumn,
  addTableRow,
  ancestorsOf,
  countTracks,
  createBranch,
  createForest,
  createTable,
  createTree,
  duplicateNode,
  equalColumns,
  findNode,
  History,
  insertNode,
  isBranch,
  moveNode,
  normalizeForest,
  removeNode,
  removeTableColumn,
  removeTableRow,
  renderDocument,
  renderForestIndex,
  renderTreeCss,
  resolveStyles,
  setStyle,
  tableSize,
  text,
  TreeDataError,
  updateTreeRoot,
  wrapNode,
  type Branch,
} from './index';

function sample() {
  const a = createBranch({ name: 'A', children: [text('one')] });
  const b = createBranch({ name: 'B' });
  const c = createBranch({ name: 'C', children: [b] });
  const root = createBranch({ tag: 'body', children: [a, c] });
  return { root, a, b, c };
}

describe('tree operations', () => {
  it('finds nodes and ancestors', () => {
    const { root, b, c } = sample();
    expect(findNode(root, b.id)).toBe(b);
    expect(ancestorsOf(root, b.id).map((n) => n.id)).toEqual([root.id, c.id]);
    expect(ancestorsOf(root, 'missing')).toEqual([]);
  });

  it('inserts without mutating and shares untouched subtrees', () => {
    const { root, a, c } = sample();
    const leaf = text('two');
    const next = insertNode(root, a.id, leaf);
    expect(next).not.toBe(root);
    expect((findNode(next, a.id) as Branch).children).toHaveLength(2);
    expect(a.children).toHaveLength(1);
    expect(findNode(next, c.id)).toBe(c);
  });

  it('refuses children on void tags', () => {
    const img = createBranch({ tag: 'img' });
    const root = createBranch({ children: [img] });
    expect(() => insertNode(root, img.id, text('x'))).toThrow();
  });

  it('removes and moves nodes', () => {
    const { root, a, b, c } = sample();
    expect(findNode(removeNode(root, a.id), a.id)).toBeNull();
    const moved = moveNode(root, b.id, root.id, 0);
    expect(moved.children[0].id).toBe(b.id);
    expect((findNode(moved, c.id) as Branch).children).toHaveLength(0);
  });

  it('adjusts the target index when moving down within the same parent', () => {
    const x = createBranch({ name: 'x' });
    const y = createBranch({ name: 'y' });
    const z = createBranch({ name: 'z' });
    const root = createBranch({ children: [x, y, z] });
    // Drop x before z (index 2 measured before removal) -> y, x, z
    expect(moveNode(root, x.id, root.id, 2).children.map((n) => n.id)).toEqual([y.id, x.id, z.id]);
  });

  it('prevents moving a branch into itself', () => {
    const { root, b, c } = sample();
    expect(() => moveNode(root, c.id, b.id)).toThrow(/inside itself/);
  });

  it('duplicates with fresh ids right after the original', () => {
    const { root, a } = sample();
    const { root: next, id } = duplicateNode(root, a.id);
    expect(id).not.toBe(a.id);
    expect(next.children.map((n) => n.id).slice(0, 2)).toEqual([a.id, id]);
    const copy = findNode(next, id) as Branch;
    expect(copy.children[0].id).not.toBe(a.children[0].id);
  });

  it('wraps a node', () => {
    const { root, a } = sample();
    const wrapper = createBranch({ type: 'flex-row' });
    const next = wrapNode(root, a.id, wrapper);
    expect(next.children[0].id).toBe(wrapper.id);
    expect((next.children[0] as Branch).children[0].id).toBe(a.id);
  });

  it('sets and clears styles per display', () => {
    const { root, a } = sample();
    let next = setStyle(root, a.id, 'lg', 'display', 'grid');
    next = setStyle(next, a.id, 'tablet', 'display', 'block');
    const branch = findNode(next, a.id) as Branch;
    expect(branch.styles).toEqual({ lg: { display: 'grid' }, tablet: { display: 'block' } });
    expect(resolveStyles(branch.styles, 'mobile-portrait')).toEqual({ display: 'block' });
    expect(resolveStyles(branch.styles, 'xl')).toEqual({ display: 'grid' });
    next = setStyle(next, a.id, 'tablet', 'display', null);
    expect((findNode(next, a.id) as Branch).styles.tablet).toBeUndefined();
  });

  it('updates a tree inside a forest', () => {
    const forest = createForest('F');
    const tree = forest.trees[0];
    const next = updateTreeRoot(forest, tree.id, (root) => insertNode(root, root.id, createBranch()));
    expect(next.trees[0].root.children).toHaveLength(1);
    expect(forest.trees[0].root.children).toHaveLength(0);
  });
});

describe('layout helpers', () => {
  it('counts grid tracks', () => {
    expect(countTracks(equalColumns(3))).toBe(3);
    expect(countTracks('200px 1fr minmax(0, 2fr)')).toBe(3);
    expect(countTracks('[full-start] 1fr [main] repeat(2, 10px 20px)')).toBe(5);
    expect(countTracks('none')).toBe(0);
  });

  it('builds and edits tables', () => {
    const table = createTable(2, 3);
    let root = createBranch({ children: [table] });
    expect(tableSize(table)).toEqual({ rows: 3, columns: 3 });
    root = addTableRow(root, table.id);
    root = addTableColumn(root, table.id);
    let t = findNode(root, table.id) as Branch;
    expect(tableSize(t)).toEqual({ rows: 4, columns: 4 });
    const head = (t.children[0] as Branch).children[0] as Branch;
    expect((head.children[3] as Branch).tag).toBe('th');
    root = removeTableRow(root, table.id, 1);
    root = removeTableColumn(root, table.id, 0);
    t = findNode(root, table.id) as Branch;
    expect(tableSize(t)).toEqual({ rows: 3, columns: 3 });
  });
});

describe('rendering', () => {
  it('emits styles under the right media queries in cascade order', () => {
    const branch = createBranch({ styles: { lg: { display: 'grid' }, 'mobile-portrait': { display: 'block' }, xl: { gap: '2rem' } } });
    const css = renderTreeCss(createBranch({ tag: 'body', children: [branch] }));
    const lg = css.indexOf('display: grid');
    const xl = css.indexOf('@media (min-width: 1440px)');
    const mp = css.indexOf('@media (max-width: 600px)');
    expect(lg).toBeGreaterThan(-1);
    expect(xl).toBeGreaterThan(lg);
    expect(mp).toBeGreaterThan(xl);
  });

  it('renders a forest index that links each tree', () => {
    const html = renderForestIndex('My <forest>', [
      { name: 'Home', href: 'blob:https://x/1' },
      { name: 'About "us"', href: 'blob:https://x/2' },
    ]);
    expect(html).toContain('<title>My &lt;forest&gt;</title>');
    expect(html).toContain('<a href="blob:https://x/1">Home</a>');
    expect(html).toContain('About "us"');
    expect(html).toContain('2 trees');
    expect(html).not.toContain('<script');
  });

  it('renders a safe standalone document', () => {
    const tree = createTree('Page <1>');
    const evil = createBranch({
      tag: 'script',
      attrs: { onclick: 'alert(1)', href: 'javascript:alert(1)', title: 'a "b"' },
      styles: { lg: { color: 'red}</style><script>' } },
      children: [text('<b>hi</b>')],
    });
    tree.root.children.push(evil);
    const html = renderDocument(tree, { kits: [{ id: 'k', name: 'Kit', css: '.x{}', enabled: true }] });
    expect(html).toContain('<title>Page &lt;1&gt;</title>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('title="a &quot;b&quot;"');
    expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;');
    expect(html).toContain('data-tw-kit="k"');
  });
});

describe('normalizeForest', () => {
  it('fills defaults, accepts shorthands and de-duplicates ids', () => {
    const forest = normalizeForest({
      name: 'Imported',
      trees: [
        {
          name: 'T',
          root: {
            children: [
              { id: 'same', tag: 'section', class: 'a b a', styles: { base: { color: 'red' }, bogus: { x: 'y' } } },
              { id: 'same', tag: 'div', children: ['plain text'] },
            ],
          },
        },
      ],
    });
    const [first, second] = forest.trees[0].root.children as Branch[];
    expect(forest.trees[0].root.tag).toBe('body');
    expect(first.classes).toEqual(['a', 'b']);
    expect(first.styles).toEqual({ lg: { color: 'red' } });
    expect(second.id).not.toBe(first.id);
    expect(second.children[0]).toMatchObject({ kind: 'leaf', type: 'text', value: 'plain text' });
    expect(isBranch(first)).toBe(true);
  });

  it('rejects malformed data with a path', () => {
    expect(() => normalizeForest({ trees: [{ root: { children: 'nope' } }] })).toThrow(TreeDataError);
    expect(() => normalizeForest({ trees: [{ root: { children: 'nope' } }] })).toThrow(/trees\[0\]\.root/);
  });
});

describe('History', () => {
  it('undoes and redoes', () => {
    const h = new History<number>(2);
    h.push(1);
    h.push(2);
    h.push(3); // 1 falls off
    expect(h.undo(4)).toBe(3);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBeUndefined();
    expect(h.redo(2)).toBe(3);
    expect(h.canRedo).toBe(true);
  });
});
