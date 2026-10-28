import { describe, expect, it } from 'vitest';
import { normalizeKit } from './normalize';
import {
  classOfSelector,
  createCustomKit,
  createRule,
  isEditableKit,
  parseRulesCss,
  renderRulesCss,
  sanitizeSelector,
  setRuleStyle,
  withRules,
} from './rules';

describe('custom rules', () => {
  it('renders base styles first, then each display under its media query', () => {
    const card = createRule('.card', { lg: { padding: '2rem' }, 'mobile-portrait': { padding: '1rem' } });
    const link = createRule('nav > a:hover', { lg: { color: 'red' } });
    const css = renderRulesCss([card, link]);
    expect(css).toContain('.card {\n  padding: 2rem;\n}\nnav > a:hover {\n  color: red;\n}');
    expect(css).toContain('@media (max-width: 600px) and (orientation: portrait) {\n  .card {\n    padding: 1rem;\n  }\n}');
    expect(css.indexOf('nav > a')).toBeLessThan(css.indexOf('@media'));
  });

  it('reads its own CSS back, keeping ids for known selectors', () => {
    const card = createRule('.card', { lg: { padding: '2rem' }, tablet: { padding: '1.5rem' } });
    const { rules, skipped } = parseRulesCss(renderRulesCss([card]), [card]);
    expect(skipped).toEqual([]);
    expect(rules).toEqual([card]);
  });

  it('merges repeated selectors and reports what an editable kit cannot hold', () => {
    const { rules, skipped } = parseRulesCss(`.a { color: red } .a { margin: 0 } @media (min-width: 10px) { .b { color: blue } } @font-face { font-family: x }`);
    expect(rules).toHaveLength(1);
    expect(rules[0].styles.lg).toEqual({ color: 'red', margin: '0' });
    expect(skipped).toEqual(['@media (min-width: 10px)', '@font-face']);
  });

  it('keeps selectors from breaking out of their rule', () => {
    expect(sanitizeSelector('.a { } body { color: red')).toBe('.a body color: red');
    expect(sanitizeSelector('.a</style><script>')).toBe('.a>>');
    expect(sanitizeSelector('  .a   >  .b  ')).toBe('.a > .b');
  });

  it('knows when a selector is a single class', () => {
    expect(classOfSelector('.card')).toBe('card');
    expect(classOfSelector('.card:hover')).toBeNull();
    expect(classOfSelector('div')).toBeNull();
  });

  it('sets and clears declarations per display', () => {
    let rule = createRule('.x');
    rule = setRuleStyle(rule, 'tablet', 'gap', ' 1rem ');
    expect(rule.styles).toEqual({ tablet: { gap: '1rem' } });
    rule = setRuleStyle(rule, 'tablet', 'gap', null);
    expect(rule.styles).toEqual({});
  });

  it('keeps an editable kit’s CSS in step with its rules', () => {
    const kit = createCustomKit();
    expect(isEditableKit(kit)).toBe(true);
    const next = withRules(kit, [createRule('.x', { lg: { color: 'red' } })]);
    expect(next.css).toContain('.x {\n  color: red;\n}');
  });

  it('normalizes rules, regenerating CSS and reading CSS-only editable kits', () => {
    const fromRules = normalizeKit({ name: 'Custom', css: 'stale', rules: [{ id: 'r1', selector: '.x{', styles: { base: { color: 'red' } } }] });
    expect(fromRules.rules).toEqual([{ id: 'r1', selector: '.x', styles: { lg: { color: 'red' } } }]);
    expect(fromRules.css).toContain('.x {');
    const fromCss = normalizeKit({ name: 'Custom', css: '.y { margin: 0 }', editable: 'true' });
    expect(fromCss.rules?.[0]).toMatchObject({ selector: '.y', styles: { lg: { margin: '0' } } });
    expect(normalizeKit({ name: 'Plain', css: '.z{}' }).rules).toBeUndefined();
  });
});
