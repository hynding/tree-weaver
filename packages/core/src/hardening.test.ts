import { describe, expect, it } from 'vitest';
import {
  applyPatch,
  createBranch,
  createForest,
  createKit,
  createTree,
  diffForests,
  fillPlaceholders,
  isSafeAttr,
  parseVersionLog,
  renderDocument,
  sanitizeCssValue,
  saveComponent,
  text,
  validateDocument,
  VersionLogError,
} from './index';

describe('rendering untrusted trees', () => {
  it('keeps a branch id from closing the style element', () => {
    const root = createBranch({ tag: 'body', children: [createBranch({ tag: 'p', styles: { lg: { color: 'red' } } })] });
    (root.children[0] as { id: string }).id = 'a</style><img src=x onerror=alert(1)>';
    const html = renderDocument(createTree('T', root));
    expect(html).not.toContain('<img src=x');
    expect(html.match(/<\/style>/g)!.length).toBe(html.match(/<style/g)!.length);
  });

  it('strips nested style tags from CSS values', () => {
    expect(sanitizeCssValue('red</sty</stylele><img src=x onerror=alert(1)>')).not.toMatch(/<\/style/i);
  });

  it('refuses javascript: URLs hidden with whitespace or control characters', () => {
    expect(isSafeAttr('href', 'java\tscript:alert(1)')).toBe(false);
    expect(isSafeAttr('href', '\x01javascript:alert(1)')).toBe(false);
    expect(isSafeAttr('src', ' java\nscript:alert(1)')).toBe(false);
    expect(isSafeAttr('href', 'https://example.com/javascript')).toBe(true);
  });
});

describe('patches', () => {
  it('refuses to turn a branch with children into a void element', () => {
    const sec = createBranch({ tag: 'section', children: [text('Hi')] });
    const root = createBranch({ tag: 'body', children: [sec] });
    expect(() => applyPatch(root, [{ op: 'update', target: sec.id, tag: 'img' }])).toThrow(/can't hold children/);
    const empty = createBranch({ tag: 'div' });
    const r2 = createBranch({ tag: 'body', children: [empty] });
    expect(() => applyPatch(r2, [{ op: 'update', target: empty.id, tag: 'hr' }])).not.toThrow();
  });
});

describe('components', () => {
  it('fills only own prop values, never inherited object members', () => {
    expect(fillPlaceholders('Hi {{constructor}}{{toString}}', {})).toBe('Hi ');
  });

  it('keeps ids unique when a branch becomes a component instance', () => {
    const card = createBranch({ tag: 'div', name: 'Card', children: [text('x')] });
    const tree = createTree('T', createBranch({ tag: 'body', children: [card] }));
    const saved = saveComponent(createForest('F', [tree]), tree.id, card.id, 'Card')!;
    expect(saved.component.root.id).not.toBe(card.id);
    const result = validateDocument({ format: 'tree-weaver', version: 1, forest: saved.forest });
    expect(result.warnings.filter((w) => /Duplicate id/.test(w.message))).toEqual([]);
  });
});

describe('diffForests', () => {
  it('reports kit and tree order and component changes', () => {
    const f = createForest('F', [createTree('A'), createTree('B')]);
    f.kits = [createKit('One', 'a{}'), createKit('Two', 'b{}')];
    expect(diffForests(f, { ...f, kits: [...f.kits].reverse() }).empty).toBe(false);
    expect(diffForests(f, { ...f, trees: [...f.trees].reverse() }).other).toEqual(['Reordered trees']);
    expect(diffForests(f, { ...f }).empty).toBe(true);
  });
});

describe('parseVersionLog', () => {
  it('throws in strict mode when an entry is damaged, instead of dropping it', () => {
    const log = JSON.stringify({ version: 1, versions: [{ id: 'v1', document: '{}', createdAt: 'x' }, { id: 'v2', document: '{}' }] });
    expect(() => parseVersionLog(log, true)).toThrow(VersionLogError);
    expect(parseVersionLog(log).versions).toHaveLength(1);
  });
});

describe('forest-wide ids', () => {
  it('makes node and kit ids unique across trees', async () => {
    const { normalizeForest } = await import('./index');
    const tree = (id: string) => ({ id, name: id, root: { kind: 'branch', id: 'b1', tag: 'body', children: [{ kind: 'leaf', id: 'l1', type: 'text', value: 'x' }] } });
    const f = normalizeForest({ name: 'F', trees: [tree('A'), tree('B')], kits: [{ id: 'k', name: 'a', css: '' }, { id: 'k', name: 'b', css: '' }] });
    const ids = f.trees.flatMap((t) => [t.root.id, t.root.children[0].id]);
    expect(new Set(ids).size).toBe(4);
    expect(new Set(f.kits.map((k) => k.id)).size).toBe(2);
  });

  it('sees an instance being detached', async () => {
    const { detachInstance } = await import('./index');
    const card = createBranch({ tag: 'div', name: 'Card', children: [text('x')] });
    const tree = createTree('T', createBranch({ tag: 'body', children: [card] }));
    const saved = saveComponent(createForest('F', [tree]), tree.id, card.id, 'Card')!;
    const t = saved.forest.trees[0];
    const detached = { ...saved.forest, trees: [{ ...t, root: { ...t.root, children: [detachInstance(t.root.children[0] as never)] } }] };
    const diff = diffForests(saved.forest, detached);
    expect(diff.empty).toBe(false);
    expect(diff.trees[0].changes[0].fields).toContain('instance');
  });

  it('strips nested tags from selectors and token values', async () => {
    const { sanitizeSelector, sanitizeTokenValue } = await import('./index');
    expect(sanitizeSelector('</sty</stylele>')).not.toMatch(/<\/style/i);
    expect(sanitizeTokenValue('</sty</stylele>')).not.toMatch(/<\/style/i);
  });
});

describe('pass 3 fixes', () => {
  it('refuses a tag change that strands SVG children', async () => {
    const { createShape } = await import('./index');
    const svg = createBranch({ tag: 'svg', children: [createShape('rect')] });
    const root = createBranch({ tag: 'body', children: [svg] });
    expect(() => applyPatch(root, [{ op: 'update', target: svg.id, tag: 'div' }])).toThrow(/needs an SVG/);
  });

  it('drops comment markers from CSS values', () => {
    expect(sanitizeCssValue('url(a.png) /*')).toBe('url(a.png)');
  });

  it('keeps the old text as the default for a spaced placeholder', async () => {
    const { createComponent, instantiateComponent, updateTreeRoot, componentTreeId, updateNode } = await import('./index');
    const def = createComponent('Note', createBranch({ tag: 'div', children: [createBranch({ tag: 'p', children: [text('Hello')] })] }));
    const leafId = (def.root.children[0] as { children: { id: string }[] }).children[0].id;
    let forest = { ...createForest('F', [createTree('Home', createBranch({ tag: 'body', children: [instantiateComponent(def)] }))]), components: [def] };
    forest = updateTreeRoot(forest, componentTreeId(def.id), (root) => updateNode(root, leafId, (n) => ({ ...n, value: '{{ message }}' }) as never));
    expect(forest.components![0].props).toEqual([{ name: 'message', type: 'text', default: 'Hello' }]);
  });
});

describe('pass 4 fixes', () => {
  it('drops CSS values with unclosed brackets', async () => {
    const { sanitizeTokenValue } = await import('./index');
    expect(sanitizeCssValue('calc(100% - 10px')).toBe('');
    expect(sanitizeCssValue('calc(100% - 10px)')).toBe('calc(100% - 10px)');
    expect(sanitizeCssValue('[full-start] 1fr [full-end]')).toBe('[full-start] 1fr [full-end]');
    expect(sanitizeCssValue('"(" no-repeat')).toBe('"(" no-repeat');
    expect(sanitizeTokenValue('var(--x')).toBe('');
  });

  it('checks a tag change against the parent and the whole subtree', async () => {
    const { createShape } = await import('./index');
    const g = createBranch({ tag: 'g' });
    const svg = createBranch({ tag: 'svg', children: [g, createBranch({ tag: 'a', children: [createShape('rect')] })] });
    const root = createBranch({ tag: 'body', children: [svg] });
    expect(() => applyPatch(root, [{ op: 'update', target: g.id, tag: 'p' }])).toThrow(/can't be drawn inside an SVG/);
    expect(() => applyPatch(root, [{ op: 'update', target: svg.id, tag: 'div' }])).toThrow(/needs an SVG/);
  });
});

describe('pass 5 fixes', () => {
  it('handles escapes and unclosed brackets in selectors and values', async () => {
    const { sanitizeSelector, renderRulesCss } = await import('./index');
    expect(sanitizeCssValue('calc(1px\\)')).toBe('');
    expect(sanitizeCssValue('url(a\\)')).toBe('');
    expect(sanitizeCssValue('red\\')).toBe('');
    expect(sanitizeCssValue('"a\\"b"')).toBe('"a\\"b"');
    expect(sanitizeSelector('.a:not(.x')).toBe('');
    expect(sanitizeSelector('.a:not(.x)')).toBe('.a:not(.x)');
    const css = renderRulesCss([{ id: 'r1', selector: '.a:not(.x', styles: { lg: { color: 'blue' } } }, { id: 'r2', selector: '.b', styles: { lg: { color: 'red' } } }]);
    expect(css).not.toContain('.a');
    expect(css).toContain('.b');
  });
});

describe('pass 6 fixes', () => {
  it('turns line breaks in CSS values into spaces before checking brackets', () => {
    expect(sanitizeCssValue('"x\n("')).not.toMatch(/\n/);
    expect(sanitizeCssValue('"x\n("')).toBe('"x ("');
  });

  it('escapes quotes and backslashes in branch selectors so styles still match', async () => {
    const { branchSelector } = await import('./index');
    expect(branchSelector('a"b\\c')).toBe('[data-tw="a\\"b\\\\c"]');
  });
});

describe('pass 7 fixes', () => {
  it('gives an inserted node fresh ids when another tree already uses them', async () => {
    const { idsOutside } = await import('./index');
    const t1 = createTree('One', createBranch({ tag: 'body', type: 'root', children: [{ ...createBranch({ tag: 'p', children: [text('hello')] }), id: 'dup' }] }));
    const t2 = createTree('Two', createBranch({ tag: 'body', type: 'root' }));
    const result = applyPatch(t2.root, [{ op: 'insert', node: { tag: 'h1', id: 'dup', children: ['x'] } }], { takenIds: idsOutside([t1, t2], t2.id) });
    expect(result.root.children[0].id).not.toBe('dup');
  });

  it('checks a wrapped node again inside its new wrapper', async () => {
    const { createShape } = await import('./index');
    const rect = createShape('rect');
    const root = createBranch({ tag: 'body', children: [createBranch({ tag: 'svg', children: [rect] })] });
    expect(() => applyPatch(root, [{ op: 'wrap', target: rect.id, node: { tag: 'foreignObject' } }])).toThrow(/wrap/);
    expect(applyPatch(root, [{ op: 'wrap', target: rect.id, node: { tag: 'g' } }]).changes).toHaveLength(1);
  });
});

describe('pass 8 fixes', () => {
  it('checks the children of a new root where they will live', async () => {
    const { createShape } = await import('./index');
    const page = createBranch({ tag: 'body', type: 'root' });
    expect(() => applyPatch(page, [{ op: 'replace', target: '/', node: { tag: 'svg', children: [createShape('circle')] } }])).toThrow(/needs an SVG/);
    const svg = createBranch({ tag: 'svg', type: 'root' });
    expect(() => applyPatch(svg, [{ op: 'replace', target: '/', node: { tag: 'div', children: [{ tag: 'p' }] } }])).toThrow(/inside an SVG/);
    expect(applyPatch(page, [{ op: 'replace', target: '/', node: { tag: 'div', children: [{ tag: 'p', children: ['hi'] }] } }]).root.tag).toBe('body');
  });

  it('checks what an inserted, replacing or moved node holds, not just the node', async () => {
    const { createShape } = await import('./index');
    const p = createBranch({ tag: 'p' });
    const page = createBranch({ tag: 'body', children: [p] });
    expect(() => applyPatch(page, [{ op: 'insert', node: { tag: 'a', children: [createShape('circle')] } }])).toThrow(/needs an SVG/);
    expect(() => applyPatch(page, [{ op: 'replace', target: p.id, node: { tag: 'a', children: [createShape('circle')] } }])).toThrow(/needs an SVG/);
    const svgRoot = createBranch({ tag: 'svg', type: 'root' });
    expect(() => applyPatch(svgRoot, [{ op: 'insert', node: { tag: 'a', children: [{ tag: 'p' }] } }])).toThrow(/inside an SVG/);
    const link = createBranch({ tag: 'a', children: [createShape('circle')] });
    const inline = createBranch({ tag: 'body', children: [createBranch({ tag: 'svg', children: [link] })] });
    expect(() => applyPatch(inline, [{ op: 'move', target: link.id, parent: '/' }])).toThrow(/needs an SVG/);
  });

  it('refuses edits inside a component instance, which the next load would undo', async () => {
    const { createComponent, instantiateComponent } = await import('./index');
    const card = createComponent('Card', createBranch({ tag: 'div', children: [text('Hello')] }));
    const inst = instantiateComponent(card);
    const leaf = inst.children[0];
    const root = createBranch({ tag: 'body', children: [inst] });
    expect(() => applyPatch(root, [{ op: 'setText', target: leaf.id, value: 'EDITED' }])).toThrow(/component instance/);
    expect(() => applyPatch(root, [{ op: 'insert', parent: inst.id, node: 'more' }])).toThrow(/component instance/);
    expect(() => applyPatch(root, [{ op: 'setStyles', target: inst.id, styles: { color: 'red' } }])).toThrow(/component instance/);
    expect(() => applyPatch(root, [{ op: 'remove', target: leaf.id }])).toThrow(/component instance/);
    // The instance as a whole can still be moved, copied, wrapped and removed.
    expect(applyPatch(root, [{ op: 'duplicate', target: inst.id }]).changes).toHaveLength(1);
    expect(applyPatch(root, [{ op: 'remove', target: inst.id }]).root.children).toHaveLength(0);
  });
});

describe('pass 9 fixes', () => {
  it('refuses nodes that are or hold a component instance', () => {
    const p = createBranch({ tag: 'p' });
    const root = createBranch({ tag: 'body', children: [p] });
    const node = { kind: 'branch', tag: 'div', instance: { component: 'card' } };
    expect(() => applyPatch(root, [{ op: 'insert', node }])).toThrow(/component instance/);
    expect(() => applyPatch(root, [{ op: 'wrap', target: p.id, node }])).toThrow(/component instance/);
    expect(() => applyPatch(root, [{ op: 'replace', target: '/', node: { tag: 'div', children: [node] } }])).toThrow(/component instance/);
  });

  it('keeps the case of custom properties in setStyles', () => {
    const b = createBranch({ tag: 'div', styles: { lg: { '--brandColor': 'blue' } } });
    const root = createBranch({ tag: 'body', children: [b] });
    const out = applyPatch(root, [{ op: 'setStyles', target: b.id, styles: { '--brandColor': 'red', fontSize: '2rem' } }]).root.children[0];
    expect((out as typeof b).styles.lg).toEqual({ '--brandColor': 'red', 'font-size': '2rem' });
  });

  it("checks a wrapper's own children too", async () => {
    const { createShape } = await import('./index');
    const p = createBranch({ tag: 'p' });
    const page = createBranch({ tag: 'body', children: [p] });
    expect(() => applyPatch(page, [{ op: 'wrap', target: p.id, node: { tag: 'div', children: [createShape('circle')] } }])).toThrow(/needs an SVG/);
  });

  it('puts what is added beside a component template root inside it', async () => {
    const { createComponent, componentTreeId, updateTreeRoot, insertNode } = await import('./index');
    const card = createComponent('Card', createBranch({ tag: 'div', children: [text('Hi')] }));
    const forest = { ...createForest('F'), components: [card] };
    const next = updateTreeRoot(forest, componentTreeId(card.id), (body) => insertNode(body, body.id, createBranch({ tag: 'hr' })));
    const tmpl = next.components![0].root;
    expect(tmpl.id).toBe(card.root.id);
    expect(tmpl.children.map((c) => (c.kind === 'branch' ? c.tag : 'text'))).toEqual(['text', 'hr']);
  });
});

describe('pass 10 fixes', () => {
  it('reports why a component instance cannot be inserted somewhere', async () => {
    const { createComponent, instantiateComponent, insertionProblem } = await import('./index');
    const card = createComponent('Card', createBranch({ tag: 'div', children: [createBranch({ tag: 'p', children: [text('Hi')] })] }));
    const inst = instantiateComponent(card);
    const svg = createBranch({ tag: 'svg' });
    const root = createBranch({ tag: 'body', children: [inst, svg] });
    expect(insertionProblem(root, (inst.children[0] as typeof inst).id, instantiateComponent(card))).toMatch(/component instance/);
    expect(insertionProblem(root, svg.id, instantiateComponent(card))).toMatch(/inside an SVG/);
    expect(insertionProblem(root, root.id, instantiateComponent(card))).toBeNull();
  });
});

describe('pass 11 fixes', () => {
  it('reports style values that rendering would drop', () => {
    const doc = { kind: 'branch', tag: 'body', children: [{ tag: 'div', styles: { lg: { 'grid-template-columns': 'repeat(3, minmax(0, 1fr)' } } }] };
    const result = validateDocument(doc);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/unbalanced/);
  });

  it('edits an SVG-only component template inside an <svg>', async () => {
    const { createComponent, componentAsTree, placementProblem, createShape } = await import('./index');
    const g = createComponent('Group', createBranch({ tag: 'g' }));
    const tree = componentAsTree(g);
    expect(tree.root.tag).toBe('svg');
    expect(placementProblem(tree.root, g.root.id, createShape('rect'))).toBeNull();
    expect(placementProblem(tree.root, g.root.id, createBranch({ tag: 'div' }))).toMatch(/inside an SVG/);
  });
});

describe('pass 12 fixes', () => {
  it('does not expand huge repeat() counts', async () => {
    const { parseTracks, countTracks } = await import('./index');
    expect(parseTracks('repeat(99999999, 1fr)')).toBeNull();
    expect(countTracks('repeat(99999999, 1fr)')).toBe(1000);
  });

  it('reads colours named like Object properties as unknown', async () => {
    const { parseColor } = await import('./index');
    for (const v of ['constructor', 'toString', '__proto__']) expect(parseColor(v)).toBeNull();
  });

  it('resolves an unclosed var() quickly', async () => {
    const { resolveTokenValue } = await import('./index');
    const start = Date.now();
    resolveTokenValue(`var(--a, ${'x'.repeat(40000)}`, new Map());
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('edits a template whose <a> root holds shapes inside an <svg>', async () => {
    const { createComponent, componentAsTree, createShape } = await import('./index');
    const link = createComponent('Link', createBranch({ tag: 'a', children: [createShape('circle')] }));
    expect(componentAsTree(link).root.tag).toBe('svg');
  });
});

describe('pass 13 fixes', () => {
  it('reports non-string kinds and leaf types instead of throwing', () => {
    const bad = { toString: 1 };
    expect(() => validateDocument({ kind: 'branch', tag: 'body', children: [{ kind: bad }, { kind: 'leaf', type: bad, value: 'x' }] })).not.toThrow();
  });

  it('has no geometry for shapes named like Object properties', async () => {
    const { shapeGeometry } = await import('./index');
    expect(shapeGeometry('constructor')).toEqual([]);
    expect(shapeGeometry('__proto__')).toEqual([]);
    expect(shapeGeometry('circle')).toContain('r');
  });
});

describe('pass 14 fixes', () => {
  it('caps tokens that use each other many times', async () => {
    const { resolveTokenValue } = await import('./index');
    const raw = Array(12).fill('var(--a)').join(' ');
    const start = Date.now();
    const out = resolveTokenValue(raw, new Map([['--a', raw]]));
    expect(out.length).toBeLessThanOrEqual(8192);
    expect(Date.now() - start).toBeLessThan(500);
    expect(resolveTokenValue('var(--b)', new Map([['--b', 'var(--c)'], ['--c', 'red']]))).toBe('red');
  });

  it('parses deeply nested at-rules quickly', async () => {
    const { parseCss } = await import('./index');
    const start = Date.now();
    const css = `${'@media x{'.repeat(8000)}${'a{color:red}'.repeat(1000)}`;
    expect(() => parseCss(css)).not.toThrow();
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('opens a template inside an <svg> when an instance lives in one', async () => {
    const { createComponent, instantiateComponent, findTree, componentTreeId, insertionProblem } = await import('./index');
    const def = createComponent('Link', createBranch({ tag: 'a', attrs: { href: '#' } }));
    const tree = createTree('T', createBranch({ tag: 'body', type: 'root', children: [createBranch({ tag: 'svg', children: [instantiateComponent(def)] })] }));
    const forest = { ...createForest('F', [tree]), components: [def] };
    const opened = findTree(forest, componentTreeId(def.id))!;
    expect(opened.root.tag).toBe('svg');
    expect(insertionProblem(opened.root, def.root.id, createBranch({ tag: 'p' }))).toBeTruthy();
  });
});

describe('pass 15 fixes', () => {
  it('reports CSS whose meaning depends on rule order', async () => {
    const { parseRulesCss } = await import('./index');
    expect(parseRulesCss('.a{color:red} .b{color:blue} .a{color:green}').reordered).toHaveLength(1);
    expect(parseRulesCss('@media (max-width: 1024px){.c{color:red}} .c{color:blue}').reordered).toHaveLength(1);
    expect(parseRulesCss('.d{width:300px; width:some-future-keyword}').reordered).toHaveLength(1);
    expect(parseRulesCss('.a{color:red} .b{margin:0} .a{padding:0}').reordered).toEqual([]);
    expect(parseRulesCss('.a{color:red} @media (max-width: 1024px){.a{color:blue}}').reordered).toEqual([]);
  });

  it('gives a component saved from a tree root its own ids', async () => {
    const { saveComponent } = await import('./index');
    const tree = createTree('T', createBranch({ tag: 'body', type: 'root', children: [createBranch({ tag: 'p', children: [text('x')] })] }));
    const saved = saveComponent(createForest('F', [tree]), tree.id, tree.root.id, 'Page')!;
    const ids = (n: { id: string; children?: unknown[] }): string[] => [n.id, ...((n.children ?? []) as { id: string }[]).flatMap((c) => ids(c as never))];
    const treeIds = new Set(ids(saved.forest.trees[0].root as never));
    expect(ids(saved.component.root as never).some((id) => treeIds.has(id))).toBe(false);
    const result = validateDocument({ format: 'tree-weaver', version: 1, kind: 'forest', forest: saved.forest });
    expect(result.warnings.filter((i) => /Duplicate id/.test(i.message))).toEqual([]);
  });
});

describe('pass 16 fixes', () => {
  it('rejects an empty repeat() at once', async () => {
    const { parseTracks } = await import('./index');
    const start = Date.now();
    expect(parseTracks('repeat(1000000000000, )')).toBeNull();
    expect(Date.now() - start).toBeLessThan(100);
    expect(parseTracks('repeat(3, 1fr)')).toHaveLength(3);
  });
});

describe('pass 18 fixes', () => {
  it('reports display media blocks out of display order', async () => {
    const { parseRulesCss } = await import('./index');
    const css = '@media (max-width: 600px) and (orientation: portrait) { .a { color: red; } } @media (max-width: 1024px) { .a { color: blue; } }';
    expect(parseRulesCss(css).reordered).toHaveLength(1);
    const inOrder = '@media (max-width: 1024px) { .a { color: blue; } } @media (max-width: 600px) and (orientation: portrait) { .a { color: red; } }';
    expect(parseRulesCss(inOrder).reordered).toEqual([]);
  });

  it('prints elements that show whitespace on one line', async () => {
    const { renderNodeHtml } = await import('./index');
    const div = createBranch({ tag: 'div', styles: { lg: { 'white-space': 'pre-line' } }, children: [createBranch({ tag: 'p', children: [text('one')] }), createBranch({ tag: 'p', children: [text('two')] })] });
    expect(renderNodeHtml(div, { pretty: true })).not.toContain('\n');
  });
});

describe('pass 19 fixes', () => {
  it('gives an imported tree with a component: id a fresh id', async () => {
    const { normalizeTree } = await import('./index');
    const t = normalizeTree({ id: 'component:c_1', name: 'X', root: { kind: 'branch', tag: 'body', children: [] } });
    expect(t.id.startsWith('component:')).toBe(false);
  });

  it('writes text inside a textarea without leaf spans on the canvas', async () => {
    const { renderNodeHtml } = await import('./index');
    const ta = createBranch({ tag: 'textarea', children: [text('Hello')] });
    expect(renderNodeHtml(ta, { designer: true })).not.toContain('<span');
  });
});

describe('pass 20 fixes', () => {
  it('refuses a grid layout on a void element or an SVG', async () => {
    const { applyGridLayout, GRID_LAYOUTS } = await import('./index');
    const layout = GRID_LAYOUTS.find((l: { boxes?: number; areas?: unknown }) => l.boxes || l.areas)!;
    const hr = createBranch({ tag: 'hr' });
    const svg = createBranch({ tag: 'svg' });
    const root = createBranch({ tag: 'body', type: 'root', children: [hr, svg] });
    expect(() => applyGridLayout(root, hr.id, 'lg', layout)).toThrow(/can't hold children/);
    expect(() => applyGridLayout(root, svg.id, 'lg', layout)).toThrow();
  });
});

describe('pass 21 fixes', () => {
  it('reports CSS that rules would drop or tidy', async () => {
    const { parseRulesCss } = await import('./index');
    for (const css of ['.a { color: red; &:hover { color: blue } }', '.a { *zoom: 1 }', '.a { content: "{" }', '.x\\@md { color: red }']) {
      expect(parseRulesCss(css).changed.length).toBeGreaterThan(0);
    }
    expect(parseRulesCss('.a { color: red }\n.grid { grid-template-areas:\n  "a b"\n  "c d"; }\n@media (max-width: 767px) { .a { color: blue } }').changed).toEqual([]);
  });
});

describe('pass 22 fixes', () => {
  it('keeps semicolons inside url() and strings in token values', async () => {
    const { sanitizeTokenValue } = await import('./index');
    const url = 'url("data:image/svg+xml;charset=utf-8,%3Csvg%3E")';
    expect(sanitizeTokenValue(url)).toBe(url);
    expect(sanitizeTokenValue('red; } body { color: blue')).not.toMatch(/[;{}]/);
  });

  it('doubles a leading newline in <pre> so HTML parsers keep it', () => {
    const tree = createTree('T', createBranch({ tag: 'body', type: 'root', children: [createBranch({ tag: 'pre', children: [text('\nline2')] })] }));
    expect(renderDocument(tree)).toMatch(/<pre[^>]*>\n\nline2<\/pre>/);
  });
});

describe('pass 23 fixes', () => {
  it('drops a trailing semicolon from style and token values', async () => {
    const { sanitizeTokenValue } = await import('./index');
    expect(sanitizeCssValue('red;')).toBe('red');
    expect(sanitizeCssValue('url(data:a;b) ; ')).toBe('url(data:a;b)');
    expect(sanitizeTokenValue('#2f6f4f;')).toBe('#2f6f4f');
  });
});

describe('pass 26 fixes', () => {
  it('reports display sizes that hide a display\'s own styles', async () => {
    const { displayProblems, DEFAULT_DISPLAYS } = await import('./index');
    expect(displayProblems(DEFAULT_DISPLAYS)).toEqual([]);
    const wide = DEFAULT_DISPLAYS.map((d) => (d.id === 'tablet' ? { ...d, width: 1100 } : d));
    expect(displayProblems(wide)[0]).toMatch(/wider than its breakpoint/);
    const order = DEFAULT_DISPLAYS.map((d) => (d.id === 'mobile-portrait' ? { ...d, breakpoint: 2000, media: '(max-width: 2000px) and (orientation: portrait)', width: 390 } : d));
    expect(displayProblems(order).join(' ')).toMatch(/breakpoint \(2000px\) is above/);
  });
});

describe('pass 27 fixes', () => {
  it('turns the token kit on when a token is edited, and says when a later kit wins', async () => {
    const { setToken, tokenValues, tokenShadowed, createTokenKit } = await import('./index');
    const off = { ...createTokenKit([{ name: '--brand', value: 'red' }]), enabled: false };
    const kits = setToken([off], { name: '--brand', value: 'green' });
    expect(kits[0].enabled).toBe(true);
    expect(tokenValues(kits).get('--brand')).toBe('green');
    const later = createKit('Later', ':root { --brand: blue; }');
    const shadowed = setToken([createTokenKit([]), later], { name: '--brand', value: 'green' });
    expect(tokenShadowed(shadowed, '--brand')).toBe(true);
    expect(tokenShadowed(setToken([later, createTokenKit([])], { name: '--brand', value: 'green' }), '--brand')).toBe(false);
  });
});

describe('pass 28 fixes', () => {
  it('treats the "-" pick as base, never a variant named "-"', async () => {
    const { createComponent, variantPerDisplay, normalizeComponent } = await import('./index');
    const def = { ...createComponent('Card', createBranch({ tag: 'div' })), variants: [{ name: '-', styles: {} }, { name: 'big', styles: {} }] };
    expect(variantPerDisplay(def, { tablet: '-' }).tablet).toBeUndefined();
    expect(variantPerDisplay(def, { tablet: 'big' }).tablet?.name).toBe('big');
    expect(normalizeComponent(JSON.parse(JSON.stringify(def))).variants.map((v) => v.name)).toEqual(['big']);
  });
});
