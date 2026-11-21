import { describe, expect, it } from 'vitest';
import { createKit } from './create';
import { normalizeKit } from './normalize';
import { inferTokenKind, isTokenKit, resetToken, rootTokens, setToken, themeTokens, tokenIdentifier, tokensToDtcg, tokenValues } from './tokens';

const kit = createKit('Kit', ':root { --brand: #2f6f4f; --brand-dark: var(--brand); --space-2: 0.5rem; --radius: 8px; --font-body: system-ui, sans-serif; } @media (max-width: 600px) { :root { --space-2: 4px; } } .card { --local: 1px; }');

describe('design tokens', () => {
  it('reads :root custom properties from kits, skipping media blocks and other rules', () => {
    expect(rootTokens(kit.css).map((t) => t.name)).toEqual(['--brand', '--brand-dark', '--space-2', '--radius', '--font-body']);
  });

  it('infers kinds and resolves references', () => {
    const tokens = themeTokens([kit]);
    const by = Object.fromEntries(tokens.map((t) => [t.name, t]));
    expect(by['--brand'].kind).toBe('color');
    expect(by['--brand-dark']).toMatchObject({ kind: 'color', resolved: '#2f6f4f', source: 'Kit', edited: false });
    expect(by['--space-2'].kind).toBe('space');
    expect(by['--radius'].kind).toBe('radius');
    expect(by['--font-body'].kind).toBe('font-family');
    expect(inferTokenKind('--fs-lg', '1.25rem')).toBe('font-size');
    expect(inferTokenKind('--font-weight-bold', '700')).toBe('font-weight');
    expect(inferTokenKind('--shadow', '0 1px 2px #000')).toBe('shadow');
    expect(inferTokenKind('--z', '10')).toBe('space');
  });

  it('writes edits to a token kit that loads last and wins', () => {
    let kits = setToken([kit], { name: '--brand', value: '#ff0000' });
    expect(kits).toHaveLength(2);
    expect(isTokenKit(kits[1])).toBe(true);
    expect(kits[1].css).toBe(':root {\n  --brand: #ff0000;\n}\n');
    const brand = themeTokens(kits).find((t) => t.name === '--brand')!;
    expect(brand).toMatchObject({ value: '#ff0000', kitValue: '#2f6f4f', edited: true, source: 'Tokens' });
    // References follow the edit.
    expect(tokenValues(kits).get('--brand-dark')).toBe('#ff0000');
    kits = setToken(kits, { name: '--brand', value: '#00ff00' });
    expect(kits).toHaveLength(2);
    expect(themeTokens(kits).find((t) => t.name === '--brand')!.kitValue).toBe('#2f6f4f');
    kits = setToken(kits, { name: '--new', value: '3rem', kind: 'space', description: 'Hero gap' });
    expect(themeTokens(kits).at(-1)).toMatchObject({ name: '--new', kind: 'space', description: 'Hero gap', edited: true });
    kits = resetToken(kits, '--brand');
    expect(themeTokens(kits).find((t) => t.name === '--brand')).toMatchObject({ value: '#2f6f4f', edited: false });
  });

  it('refuses bad names and values that would break out of the rule', () => {
    expect(() => setToken([], { name: 'brand', value: 'red' })).toThrow(/not a token name/);
    const kits = setToken([], { name: '--x', value: 'red; } body { color: blue' });
    expect(kits[0].css).toBe(':root {\n  --x: red, body color: blue;\n}\n');
  });

  it('round-trips through normalize, including from CSS only', () => {
    const [, tokenKit] = setToken([kit], { name: '--brand', value: '#123456', kind: 'color' });
    expect(normalizeKit(JSON.parse(JSON.stringify(tokenKit))).tokens).toEqual([{ name: '--brand', value: '#123456', kind: 'color' }]);
    expect(normalizeKit({ name: 'Tokens', source: 'tokens', css: ':root { --a: 1px; }' }).tokens).toEqual([{ name: '--a', value: '1px' }]);
  });

  it('names identifiers and writes DTCG', () => {
    expect(tokenIdentifier('--tw-color-accent')).toBe('twColorAccent');
    expect(tokenIdentifier('--2xl')).toBe('t2xl');
    expect(tokensToDtcg(themeTokens([kit]))).toMatchObject({ brand: { $value: '#2f6f4f', $type: 'color' }, 'space-2': { $value: '0.5rem', $type: 'dimension' } });
  });
});
