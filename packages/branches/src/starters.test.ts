import { checkTree, isBranch, syncInstances, themeTokens, validateDocument, walk, type Branch } from '@tree-weaver/core';
import { exportComponent, exportComponentDef, exportForest, importJson } from '@tree-weaver/formats';
import { describe, expect, it } from 'vitest';
import { getStarter, STARTERS } from './index';

describe('starter forests', () => {
  it('have unique ids and describe what they hold', () => {
    expect(new Set(STARTERS.map((s) => s.id)).size).toBe(STARTERS.length);
    for (const s of STARTERS) {
      const forest = s.create();
      expect(forest.trees.map((t) => t.name)).toEqual(s.trees);
      expect(forest.components!.map((c) => c.name).sort()).toEqual([...s.components].sort());
      expect(getStarter(s.id)).toBe(s);
    }
  });

  it.each(STARTERS.map((s) => [s.id, s] as const))('%s is a valid forest that passes the layout checks', (_id, s) => {
    const forest = s.create('Mine');
    expect(forest.name).toBe('Mine');
    const result = validateDocument({ format: 'tree-weaver', version: 1, forest: JSON.parse(JSON.stringify(forest)) });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    for (const tree of forest.trees) {
      const report = checkTree(tree);
      expect(report.issues.filter((i) => i.severity !== 'note'), tree.name).toEqual([]);
    }
  });

  it.each(STARTERS.map((s) => [s.id, s] as const))('%s uses its components, with instances in sync, and only tokens it defines', (_id, s) => {
    const forest = s.create();
    // Instances are expanded already: syncing changes nothing.
    expect(syncInstances(forest)).toBe(forest);
    const used = new Set<string>();
    const vars = new Set<string>();
    const collect = (root: Branch) =>
      walk(root, (n) => {
        if (!isBranch(n)) return;
        if (n.instance) used.add(n.instance.component);
        for (const map of Object.values(n.styles)) for (const value of Object.values(map ?? {})) for (const m of String(value).matchAll(/var\((--[\w-]+)/g)) vars.add(m[1]);
      });
    for (const tree of forest.trees) collect(tree.root);
    for (const c of forest.components!) {
      collect(c.root);
      for (const variant of c.variants) for (const byDisplay of Object.values(variant.styles)) for (const map of Object.values(byDisplay)) for (const value of Object.values(map ?? {})) for (const m of String(value).matchAll(/var\((--[\w-]+)/g)) vars.add(m[1]);
    }
    expect([...used].sort()).toEqual(forest.components!.map((c) => c.id).sort());
    const defined = new Set(themeTokens(forest.kits).map((t) => t.name));
    expect([...vars].filter((name) => !defined.has(name))).toEqual([]);
    // Every component has a variant some instance picks per display.
    expect(forest.components!.every((c) => c.variants.length > 0)).toBe(true);
  });

  it('makes fresh ids every time', () => {
    const a = getStarter('dashboard')!.create();
    const b = getStarter('dashboard')!.create();
    expect(a.id).not.toBe(b.id);
    expect(a.trees[0].id).not.toBe(b.trees[0].id);
    expect(a.components![0].id).not.toBe(b.components![0].id);
  });

  it('round-trips through JSON and exports as pages and components', () => {
    for (const s of STARTERS) {
      const forest = s.create();
      const back = importJson(exportForest(forest, 'json'));
      expect(back.kind).toBe('forest');
      if (back.kind === 'forest') expect(back.forest.components?.length).toBe(forest.components!.length);
      const page = exportComponent(forest.trees[0], { framework: 'react', kits: forest.kits });
      expect(page.files.some((f) => f.path === 'tokens.json')).toBe(true);
      for (const c of forest.components!) {
        const out = exportComponentDef(c, { framework: 'react', typescript: true, kits: forest.kits });
        expect(out.files[0].contents).toContain('function variantClasses');
      }
    }
  });
});
