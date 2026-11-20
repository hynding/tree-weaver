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
