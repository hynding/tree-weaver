import { describe, expect, it } from 'vitest';
import {
  alignRuleLines,
  compareSpecificity,
  locateRules,
  resolveCascade,
  selectorSpecificity,
  sortByPrecedence,
  splitSelectorList,
  UNLAYERED,
  type CascadeDeclaration,
  type CascadeRule,
  type Specificity,
} from './cascade';

const decl = (property: string, value: string, opts: { important?: boolean; longhands?: string[] } = {}): CascadeDeclaration => ({
  property,
  value,
  important: opts.important ?? false,
  longhands: opts.longhands ?? [property],
});

const rule = (specificity: Specificity, order: number, declarations: CascadeDeclaration[], extra: Partial<CascadeRule> = {}): CascadeRule => ({
  specificity,
  layer: UNLAYERED,
  order,
  declarations,
  ...extra,
});

describe('selector specificity', () => {
  it.each([
    ['*', [0, 0, 0]],
    ['div', [0, 0, 1]],
    ['.btn', [0, 1, 0]],
    ['#main', [1, 0, 0]],
    ['ul li a.active', [0, 1, 3]],
    ['a[href$=".pdf"]:hover', [0, 2, 1]],
    ['p::first-line', [0, 0, 2]],
    ['p:before', [0, 0, 2]],
    ['.card > .title + p ~ span', [0, 2, 2]],
    [':is(#a, .b) p', [1, 0, 1]],
    [':not(.x, div)', [0, 1, 0]],
    [':where(#a, .b) p', [0, 0, 1]],
    [':has(> img)', [0, 0, 1]],
    [':nth-child(2n+1)', [0, 1, 0]],
    ['li:nth-child(2n of .item)', [0, 2, 1]],
    ['svg|rect', [0, 0, 1]],
    ['.a\\:hover', [0, 1, 0]],
    ['[data-tw="b_1"]', [0, 1, 0]],
  ] as [string, Specificity][])('%s → %j', (selector, expected) => {
    expect(selectorSpecificity(selector)).toEqual(expected);
  });

  it('splits selector lists at top-level commas only', () => {
    expect(splitSelectorList('a, b:is(c, d), [title="x,y"]')).toEqual(['a', 'b:is(c, d)', '[title="x,y"]']);
  });

  it('compares ids before classes before types', () => {
    expect(compareSpecificity([1, 0, 0], [0, 9, 9])).toBeGreaterThan(0);
    expect(compareSpecificity([0, 1, 0], [0, 0, 9])).toBeGreaterThan(0);
    expect(compareSpecificity([0, 1, 1], [0, 1, 1])).toBe(0);
  });
});

describe('cascade', () => {
  it('lets more specific and later rules win, and marks the rest overridden', () => {
    const tag = rule([0, 0, 1], 0, [decl('color', 'black'), decl('margin-top', '0')]);
    const cls = rule([0, 1, 0], 1, [decl('color', 'green')]);
    const later = rule([0, 0, 1], 2, [decl('margin-top', '8px')]);
    const winners = resolveCascade([[tag, cls, later]]);
    expect(winners.get('color')?.value).toBe('green');
    expect(winners.get('margin-top')?.value).toBe('8px');
    expect(tag.declarations.map((d) => d.overridden)).toEqual([true, true]);
    expect(cls.declarations[0].overridden).toBe(false);
  });

  it('lets !important beat specificity, and inline styles beat rules', () => {
    const important = rule([0, 0, 1], 0, [decl('color', 'red', { important: true })]);
    const id = rule([1, 0, 0], 1, [decl('color', 'blue'), decl('padding-top', '1px')]);
    const inline = rule([0, 0, 0], 2, [decl('padding-top', '4px')], { inline: true });
    const winners = resolveCascade([[important, id, inline]]);
    expect(winners.get('color')?.value).toBe('red');
    expect(winners.get('padding-top')?.value).toBe('4px');
  });

  it('ranks unlayered above layers, and reverses that for !important', () => {
    const early = rule([1, 0, 0], 0, [decl('color', 'early'), decl('width', 'early', { important: true })], { layer: 0 });
    const late = rule([1, 0, 0], 1, [decl('color', 'late'), decl('width', 'late', { important: true })], { layer: 1 });
    const plain = rule([0, 0, 1], 2, [decl('color', 'plain'), decl('width', 'plain', { important: true })]);
    const winners = resolveCascade([[early, late, plain]]);
    expect(winners.get('color')?.value).toBe('plain');
    expect(winners.get('width')?.value).toBe('early');
  });

  it('keeps a shorthand alive while any of its longhands still wins', () => {
    const padding = decl('padding', '1rem', { longhands: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'] });
    const top = decl('padding-top', '0');
    resolveCascade([[rule([0, 1, 0], 0, [padding]), rule([0, 1, 0], 1, [top])]]);
    expect(padding.overridden).toBe(false);
    const all = decl('padding', '2rem', { longhands: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'] });
    resolveCascade([[rule([0, 1, 0], 0, [padding]), rule([0, 1, 0], 1, [all])]]);
    expect(padding.overridden).toBe(true);
  });

  it('inherits only inherited properties, from the nearest ancestor, below the element’s own rules', () => {
    const own = rule([0, 1, 0], 5, [decl('font-size', '14px')]);
    const parent = rule([0, 1, 0], 3, [decl('color', 'navy'), decl('font-size', '20px'), decl('margin-top', '9px')]);
    const root = rule([0, 1, 0], 9, [decl('color', 'gray', { important: true }), decl('--space', '4px')]);
    const winners = resolveCascade([[own], [parent], [root]]);
    expect(winners.get('font-size')?.value).toBe('14px');
    expect(winners.get('color')?.value).toBe('navy');
    expect(winners.get('--space')?.value).toBe('4px');
    expect(winners.has('margin-top')).toBe(false);
    expect(root.declarations[0].overridden).toBe(true);
  });

  it('sorts rules so the strongest comes first', () => {
    const a = rule([0, 0, 1], 0, []);
    const b = rule([0, 1, 0], 1, []);
    const c = rule([0, 0, 1], 2, []);
    const inline = rule([0, 0, 0], 3, [], { inline: true });
    expect(sortByPrecedence([a, b, c, inline])).toEqual([inline, b, c, a]);
  });
});

describe('rule lines', () => {
  const css = `/* Kit
   header */
@import url("reset.css");
:root { --x: 1; }

.btn,
.button { padding: 1rem; }
@media (min-width: 600px) {
  .btn { padding: 2rem; }
}
@font-face { font-family: X; src: url(x.woff); }
@keyframes spin { from { rotate: 0deg } to { rotate: 1turn } }
a[href='x{y}'] { color: red; }
`;

  it('finds style rules and their lines, skipping at-rule blocks', () => {
    expect(locateRules(css)).toEqual([
      { selector: ':root', line: 4 },
      { selector: '.btn,\n.button', line: 6 },
      { selector: '.btn', line: 9 },
      { selector: "a[href='x{y}']", line: 13 },
    ]);
  });

  it('lines up the rules a browser parsed, past rules it dropped', () => {
    expect(alignRuleLines(css, [':root', '.btn, .button', '.btn', 'a[href="x{y}"]'])).toEqual([4, 6, 9, 13]);
    expect(alignRuleLines(css, [':root', '.unknown', '.btn'])).toEqual([4, undefined, 9]);
  });
});
