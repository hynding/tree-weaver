import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { normalizeTree } from './normalize';
import { TREE_WEAVER_SCHEMA } from './schema';
import { formatIssues, validateDocument } from './validate';

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
const schemaValid = ajv.compile(TREE_WEAVER_SCHEMA);

const env = (root: unknown, extra: Record<string, unknown> = {}) => ({ format: 'tree-weaver', version: 1, tree: { name: 'T', root, ...extra } });
const body = (...children: unknown[]) => ({ tag: 'body', children });
const paths = (issues: { path: string }[]) => issues.map((i) => i.path);

describe('validateDocument', () => {
  it('accepts a minimal hand-written tree without ids', () => {
    const doc = env(body({ tag: 'h1', children: ['Hello'] }, { tag: 'p', children: [{ value: 'World' }] }));
    const result = validateDocument(doc);
    expect(result).toMatchObject({ valid: true, kind: 'tree', errors: [], warnings: [] });
    expect(result.counts).toEqual({ trees: 1, branches: 3, leaves: 2 });
    expect(schemaValid(doc)).toBe(true);
  });

  it('recognises bare forests, trees and branches', () => {
    expect(validateDocument({ trees: [] }).kind).toBe('forest');
    expect(validateDocument({ root: body() }).kind).toBe('tree');
    expect(validateDocument({ tag: 'section' }).kind).toBe('branch');
    expect(validateDocument(42)).toMatchObject({ valid: false, kind: null });
    expect(validateDocument({ hello: 1 })).toMatchObject({ valid: false, kind: null });
  });

  it('reports unknown displays with the list of valid ones', () => {
    const r = validateDocument(env(body({ tag: 'div', styles: { desktop: { padding: '8px' }, mobile: { padding: '4px' } } })));
    expect(r.valid).toBe(false);
    expect(paths(r.errors)).toEqual(['tree.root.children[0].styles.desktop', 'tree.root.children[0].styles.mobile']);
    expect(r.errors[0].hint).toBe('Use one of: lg, xl, tablet, mobile-landscape, mobile-portrait');
  });

  it('spots declarations written without a display', () => {
    const r = validateDocument(env(body({ tag: 'div', styles: { paddingTop: '8px' } })));
    expect(r.errors[0].hint).toBe('Write "styles": { "lg": { "padding-top": "8px" } }');
  });

  it('flags camelCase properties, numbers without units and the base alias', () => {
    const r = validateDocument(env(body({ tag: 'div', styles: { base: { gridTemplateColumns: '1fr 1fr', padding: 16, opacity: 0.5 } } })));
    expect(r.errors.map((e) => e.hint)).toEqual(['Use "grid-template-columns"']);
    expect(r.warnings.map((w) => w.hint)).toEqual(['Rename it to "lg"', 'Write it with a unit, e.g. "16px"', 'Write it as "0.5"']);
  });

  it('rejects script-like tags, event handlers and style attributes', () => {
    const r = validateDocument(
      env(body({ tag: 'script', children: ['alert(1)'] }, { tag: 'a', attrs: { onclick: 'x()', style: 'color:red', href: 'javascript:x()' } })),
    );
    expect(paths(r.errors)).toEqual([
      'tree.root.children[0].tag',
      'tree.root.children[1].attrs.onclick',
      'tree.root.children[1].attrs.style',
      'tree.root.children[1].attrs.href',
    ]);
  });

  it('catches void elements with children and leaves with children', () => {
    const r = validateDocument(env(body({ tag: 'img', children: ['x'] }, { kind: 'leaf', value: 'a', children: [] })));
    expect(paths(r.errors)).toEqual(['tree.root.children[0].children', 'tree.root.children[1].children']);
    expect(r.errors[0].hint).toContain('image leaf');
  });

  it('warns about aliases, unknown fields, duplicate ids and images without alt', () => {
    const r = validateDocument(
      env(body({ id: 'a', tag: 'div', class: 'one two', color: 'red' }, { id: 'a', kind: 'leaf', type: 'image', src: 'x.png' })),
    );
    expect(r.valid).toBe(true);
    expect(paths(r.warnings)).toEqual([
      'tree.root.children[0].color',
      'tree.root.children[0].class',
      'tree.root.children[1].id',
      'tree.root.children[1].src',
      'tree.root.children[1].attrs',
    ]);
  });

  it('checks the envelope and kits', () => {
    const r = validateDocument({
      format: 'tree-weaver',
      version: 2,
      tree: { root: body() },
      kits: [{ name: 'k', href: 'ftp://x/y.css' }, { name: 'r', rules: [{ selector: '.a { color: red }' }] }],
    });
    expect(paths(r.errors)).toEqual(['version', 'kits[0].href', 'kits[1].rules[0].selector']);
  });

  it('requires the tree root to be a branch', () => {
    expect(paths(validateDocument(env('Just text')).errors)).toEqual(['tree.root']);
    expect(paths(validateDocument(env({ tag: 'main' })).warnings)).toEqual(['tree.root.tag']);
  });

  it('formats issues one per line with their fix', () => {
    const text = formatIssues(validateDocument(env(body({ tag: 'div', styles: { desktop: {} } }))));
    expect(text).toBe('error tree.root.children[0].styles.desktop: Unknown display "desktop"; these styles are dropped. Fix: Use one of: lg, xl, tablet, mobile-landscape, mobile-portrait');
  });

  it('passes whatever normalize produces', () => {
    const tree = normalizeTree({ root: body({ tag: 'section', classes: ['a'], styles: { lg: { gap: '1rem' } }, children: ['x', { type: 'image', value: 'a.png', attrs: { alt: '' } }] }) });
    const doc = { format: 'tree-weaver', version: 1, tree };
    expect(validateDocument(doc)).toMatchObject({ valid: true, warnings: [] });
    expect(schemaValid(doc)).toBe(true);
  });
});

describe('schema and validator agree', () => {
  const bad: [string, unknown][] = [
    ['unknown display', env(body({ tag: 'div', styles: { desktop: { padding: '1px' } } }))],
    ['camelCase property', env(body({ tag: 'div', styles: { lg: { fontSize: '1px' } } }))],
    ['blocked tag', env(body({ tag: 'script' }))],
    ['event handler', env(body({ tag: 'div', attrs: { onClick: 'x' } }))],
    ['style attribute', env(body({ tag: 'div', attrs: { style: 'x' } }))],
    ['bad leaf type', env(body({ kind: 'leaf', type: 'video', value: 'x' }))],
    ['leaf without value', env(body({ kind: 'leaf' }))],
    ['newer version', { format: 'tree-weaver', version: 9, tree: { root: body() } }],
    ['bad kit href', { format: 'tree-weaver', tree: { root: body() }, kits: [{ href: 'file:///x.css' }] }],
  ];
  it.each(bad)('both reject: %s', (_, doc) => {
    expect(validateDocument(doc).valid).toBe(false);
    expect(schemaValid(doc)).toBe(false);
  });
});
