import { describe, expect, it, vi } from 'vitest';
import { analyzeKit, createEnvKits, createStarterKit, kitClasses, kitFromFile, kitFromUrl, parseCssUrls } from './index';

describe('analyzeKit', () => {
  it('extracts classes, tokens, imports and media queries', () => {
    const result = analyzeKit(`
      @import url("https://fonts.example.com/font.css");
      @import 'reset.css';
      /* .commented-out { } */
      :root { --brand: #123; --space: 4px; }
      .btn, .btn.btn-primary:hover > .icon { color: red; }
      a[href$=".pdf"] { content: ".nope"; }
      .grid\\:cols-2 { display: grid; }
      @media (max-width: 600px) { .stack { gap: 2px } }
      @font-face { font-family: X; src: url(x.woff2); }
    `);
    expect(result.classes).toEqual(['btn', 'btn-primary', 'grid:cols-2', 'icon', 'stack']);
    expect(result.tokens).toEqual([
      { name: '--brand', value: '#123' },
      { name: '--space', value: '4px' },
    ]);
    expect(result.imports).toEqual(['https://fonts.example.com/font.css', 'reset.css']);
    expect(result.media).toEqual(['(max-width: 600px)']);
    expect(result.ruleCount).toBe(5);
  });

  it('lists classes across enabled kits only', () => {
    const a = kitFromFile('a.css', '.one {} .two {}');
    const b = { ...kitFromFile('b.css', '.three {}'), enabled: false };
    expect(kitClasses([a, b])).toEqual(['one', 'two']);
    expect(a.name).toBe('a');
  });

  it('ships a starter kit with useful classes and tokens', () => {
    const kit = createStarterKit();
    const { classes, tokens } = analyzeKit(kit.css);
    expect(classes).toEqual(expect.arrayContaining(['container', 'card', 'btn', 'btn-primary', 'stack', 'grid-auto', 'table']));
    expect(tokens.length).toBeGreaterThan(5);
  });
});

describe('kitFromUrl', () => {
  it('fetches CSS when allowed', async () => {
    const fetchImpl = vi.fn(async () => new Response('.from-url {}', { status: 200 }));
    const kit = await kitFromUrl('https://cdn.example.com/kit.css?v=2', fetchImpl as unknown as typeof fetch);
    expect(kit.name).toBe('kit');
    expect(kit.css).toBe('.from-url {}');
    expect(kit.source).toBe('https://cdn.example.com/kit.css?v=2');
    expect(kit.href).toBe('https://cdn.example.com/kit.css?v=2');
  });

  it('still links the stylesheet when fetching fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('CORS');
    });
    const kit = await kitFromUrl('https://cdn.example.com/kit.css', fetchImpl as unknown as typeof fetch);
    expect(kit.href).toBe('https://cdn.example.com/kit.css');
    expect(kit.css).toBe('');
  });
});

describe('stylesheet URLs from the environment', () => {
  it('splits on commas, spaces and new lines, keeping order and dropping bad or repeated entries', () => {
    expect(parseCssUrls(' https://a.example/one.css,https://b.example/two.css\n  ftp://x/y.css javascript:alert(1)  https://a.example/one.css ')).toEqual([
      'https://a.example/one.css',
      'https://b.example/two.css',
    ]);
    expect(parseCssUrls(undefined)).toEqual([]);
    expect(parseCssUrls('')).toEqual([]);
  });

  it('makes linked env kits in the given order', () => {
    const kits = createEnvKits(['https://a.example/reset.css', 'https://b.example/theme.css']);
    expect(kits.map((k) => [k.id, k.name, k.href, k.source, k.enabled])).toEqual([
      ['env-1', 'reset', 'https://a.example/reset.css', 'env', true],
      ['env-2', 'theme', 'https://b.example/theme.css', 'env', true],
    ]);
  });
});
