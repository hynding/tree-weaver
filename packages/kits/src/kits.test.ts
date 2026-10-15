import { describe, expect, it, vi } from 'vitest';
import { analyzeKit, createStarterKit, kitClasses, kitFromFile, kitFromUrl } from './index';

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
  });

  it('falls back to @import when fetching fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('CORS');
    });
    const kit = await kitFromUrl('https://cdn.example.com/kit.css', fetchImpl as unknown as typeof fetch);
    expect(kit.css).toBe('@import url("https://cdn.example.com/kit.css");');
  });
});
