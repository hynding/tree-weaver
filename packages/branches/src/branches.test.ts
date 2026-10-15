import { isBranch, normalizeTree, renderDocument, walk } from '@tree-weaver/core';
import { describe, expect, it } from 'vitest';
import { BLUEPRINT_CATEGORIES, BLUEPRINTS, responsiveGrid, TEMPLATES } from './index';

describe('blueprints', () => {
  it('have unique ids and known categories', () => {
    const ids = BLUEPRINTS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of BLUEPRINTS) expect(BLUEPRINT_CATEGORIES).toContain(b.category);
  });

  it('create fresh nodes with unique ids every time', () => {
    for (const b of BLUEPRINTS) {
      const first = b.create();
      const second = b.create();
      expect(first.id).not.toBe(second.id);
      const seen = new Set<string>();
      walk(first, (n) => {
        expect(seen.has(n.id)).toBe(false);
        seen.add(n.id);
      });
    }
  });

  it('builds grids that collapse on smaller displays', () => {
    const grid = responsiveGrid(3);
    expect(grid.children).toHaveLength(3);
    expect(grid.styles.tablet).toEqual({ 'grid-template-columns': 'repeat(2, minmax(0, 1fr))' });
    expect(grid.styles['mobile-portrait']).toEqual({ 'grid-template-columns': '1fr' });
  });
});

describe('templates', () => {
  it('produce valid trees that render', () => {
    for (const t of TEMPLATES) {
      const tree = t.create();
      expect(normalizeTree(JSON.parse(JSON.stringify(tree)))).toEqual(tree);
      expect(renderDocument(tree)).toContain('<body');
      let branches = 0;
      walk(tree.root, (n) => {
        if (isBranch(n)) branches++;
      });
      expect(branches).toBeGreaterThan(0);
    }
  });
});
