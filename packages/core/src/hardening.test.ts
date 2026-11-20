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
