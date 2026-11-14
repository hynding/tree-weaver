import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { checkRendered, checkTree, contrastRatio, createBranch, createLeaf, createShape, createSvgTree, createTree, formatCheckReport, parseColor, text, type Branch, type BranchInit, type CheckBrowser } from './index';

const page = (children: BranchInit['children'], name = 'Page') => createTree(name, createBranch({ tag: 'body', type: 'root', name: 'Body', children }));
const rules = (tree: ReturnType<typeof page>) => checkTree(tree).issues.map((i) => `${i.rule}@${i.path}`);

describe('colors', () => {
  it('parses colors and measures contrast', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseColor('#00000080')![3]).toBeCloseTo(0.5, 2);
    expect(parseColor('rgb(10, 20, 30)')).toEqual([10, 20, 30, 1]);
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual([10, 20, 30, 0.5]);
    expect(parseColor('navy')).toEqual([0, 0, 128, 1]);
    expect(parseColor('var(--x)')).toBeNull();
    expect(contrastRatio([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(21, 5);
    expect(contrastRatio(parseColor('#777')!, parseColor('#fff')!)).toBeCloseTo(4.48, 2);
  });
});

describe('checkTree', () => {
  it('passes a clean page', () => {
    const tree = page([
      createBranch({ tag: 'h1', children: [text('Title')] }),
      createBranch({ tag: 'h2', children: [text('Part')] }),
      createLeaf('a.png', 'image', { alt: 'A chart' }),
      createBranch({ tag: 'a', attrs: { href: '/x' }, children: [text('More')] }),
      createBranch({ tag: 'label', attrs: { for: 'q' }, children: [text('Search')] }),
      createBranch({ tag: 'input', attrs: { id: 'q' } }),
      createBranch({ tag: 'p', styles: { lg: { color: '#222', 'background-color': '#fff' } }, children: [text('Readable')] }),
    ]);
    const r = checkTree(tree);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('finds missing alt text, nameless links, missing labels and duplicate ids', () => {
    const tree = page([
      createLeaf('a.png', 'image'),
      createBranch({ tag: 'a', attrs: { href: '/x' } }),
      createBranch({ tag: 'a', children: [text('No href')] }),
      createBranch({ tag: 'button', attrs: { 'aria-label': 'Close' } }),
      createBranch({ tag: 'input', attrs: { id: 'dup' } }),
      createBranch({ tag: 'label', children: [text('Wrapped'), createBranch({ tag: 'input' })] }),
      createBranch({ tag: 'input', attrs: { type: 'submit', value: 'Go' } }),
      createBranch({ tag: 'div', attrs: { id: 'dup' }, children: [text('x')] }),
    ]);
    expect(rules(tree)).toEqual(['image-alt@/0', 'link-name@/1', 'duplicate-id@/7', 'link-href@/2', 'form-label@/4']);
    const r = checkTree(tree);
    expect(r.ok).toBe(false);
    expect(r.counts).toEqual({ errors: 3, warnings: 2, info: 0 });
    expect(r.issues[0].fix).toContain('attrs.alt');
  });

  it('checks heading order and the number of h1s', () => {
    const tree = page([
      createBranch({ tag: 'h1', children: [text('A')] }),
      createBranch({ tag: 'h3', children: [text('B')] }),
      createBranch({ tag: 'h1', children: [text('C')] }),
    ]);
    expect(rules(tree)).toEqual(['heading-order@/1', 'single-h1@/2']);
    expect(rules(page([createBranch({ tag: 'h3', children: [text('Deep')] })]))).toEqual(['heading-order@/0']);
    expect(checkTree(page([createBranch({ tag: 'h3', children: [text('Deep')] })])).issues[0].severity).toBe('info');
  });

  it('finds empty branches but not styled or self-contained ones', () => {
    const tree = page([
      createBranch({ tag: 'div' }),
      createBranch({ tag: 'div', classes: ['spacer'] }),
      createBranch({ tag: 'div', styles: { lg: { height: '2rem' } } }),
      createBranch({ tag: 'hr' }),
      createBranch({ tag: 'textarea', attrs: { 'aria-label': 'Notes' } }),
    ]);
    expect(rules(tree)).toEqual(['empty-branch@/0']);
  });

  it('flags fixed widths per display, grouped', () => {
    const wide = createBranch({ tag: 'div', name: 'Strip', styles: { lg: { width: '900px' } }, children: [text('x')] });
    const fine = createBranch({ tag: 'div', styles: { lg: { width: '900px', 'max-width': '100%' } }, children: [text('x')] });
    const r = checkTree(page([wide, fine]));
    expect(r.issues).toHaveLength(1);
    const issue = r.issues[0];
    expect(issue.rule).toBe('fixed-width');
    expect(issue.displays).toEqual(['tablet', 'mobile-landscape', 'mobile-portrait'].filter((d) => issue.displays!.includes(d as never)));
    expect(issue.displays).toContain('mobile-portrait');
    expect(issue.displays).not.toContain('lg');
    expect(issue.message).toContain('"Strip"');
  });

  it('measures contrast of colors set in the tree, with large text at 3:1', () => {
    const section = createBranch({
      tag: 'section',
      styles: { lg: { 'background-color': '#ffffff' }, 'mobile-portrait': { 'background-color': '#999999' } },
      children: [
        createBranch({ tag: 'p', styles: { lg: { color: '#777' } }, children: [text('Grey body text')] }),
        createBranch({ tag: 'h2', styles: { lg: { color: '#777' } }, children: [text('Big heading')] }),
        createBranch({ tag: 'p', styles: { lg: { color: 'var(--muted)' } }, children: [text('Unknown')] }),
      ],
    });
    const r = checkTree(page([section]));
    const contrast = r.issues.filter((i) => i.rule === 'contrast');
    expect(contrast.map((i) => i.path)).toEqual(['/0/0', '/0/0', '/0/1']);
    expect(contrast[0].message).toContain('#777777 on #ffffff');
    expect(contrast[0].displays).not.toContain('mobile-portrait');
    expect(contrast[1].displays).toEqual(['mobile-portrait']);
    expect(contrast[2].displays).toEqual(['mobile-portrait']);
  });

  it('leaves SVG drawings alone', () => {
    const tree = createSvgTree('Logo', [createShape('circle'), createBranch({ tag: 'g' })]);
    expect(checkTree(tree).issues).toEqual([]);
  });

  it('formats a report', () => {
    const text = formatCheckReport(checkTree(page([createLeaf('a.png', 'image')])));
    expect(text).toMatch(/^FAILED "Page": 1 error, 0 warnings, 0 notes/);
    expect(text).toContain('error image-alt at /0: ');
    expect(text).toContain('Fix: ');
  });
});

/** Chromium through Playwright when it's installed; these tests skip otherwise. */
function chromium(): { launch(o: object): Promise<CheckBrowser & { close(): Promise<void> }> } | null {
  try {
    return (createRequire(import.meta.url)('playwright') as { chromium: ReturnType<typeof chromium> }).chromium;
  } catch {
    return null;
  }
}
// Needs a Chromium build too: TW_CHROMIUM_PATH, Playwright's browsers, or the cloud image's copy.
if (!process.env.TW_CHROMIUM_PATH && existsSync('/opt/pw-browsers/chromium')) process.env.TW_CHROMIUM_PATH = '/opt/pw-browsers/chromium';
const pw = process.env.TW_CHROMIUM_PATH || process.env.PLAYWRIGHT_BROWSERS_PATH ? chromium() : null;

describe.skipIf(!pw)('checkRendered', () => {
  it('finds what overflows on small displays and contrast from kits', async () => {
    const browser = await pw!.launch({ headless: true, ...(process.env.TW_CHROMIUM_PATH ? { executablePath: process.env.TW_CHROMIUM_PATH } : {}) });
    try {
      const grid: Branch = createBranch({
        tag: 'div',
        name: 'Gallery',
        styles: { lg: { display: 'grid', 'grid-template-columns': 'repeat(4, 300px)' } },
        children: [1, 2, 3, 4].map((n) => createBranch({ tag: 'div', children: [text(`Tile ${n}`)] })),
      });
      const muted = createBranch({ tag: 'p', classes: ['muted'], children: [text('Hard to read')] });
      const tree = page([createBranch({ tag: 'h1', children: [text('Hi')] }), grid, muted]);
      const kit = { id: 'k1', name: 'Kit', css: '.muted { color: #aaa; }', enabled: true };
      const r = await checkRendered(tree, { browser, kits: [kit], displays: ['lg', 'tablet', 'mobile-portrait'] });
      expect(r.rendered!.map((d) => d.display)).toEqual(['lg', 'tablet', 'mobile-portrait']);
      const overflow = r.issues.filter((i) => i.rule === 'overflow');
      expect(overflow).toHaveLength(1);
      expect(overflow[0].path).toBe('/1');
      expect(overflow[0].displays).toEqual(['tablet', 'mobile-portrait']);
      expect(overflow[0].message).toContain('"Gallery"');
      const contrast = r.issues.filter((i) => i.rule === 'contrast');
      expect(contrast).toHaveLength(1);
      expect(contrast[0].path).toBe('/2');
      expect(contrast[0].message).toContain('#aaaaaa on #ffffff');
      expect(r.rendered!.find((d) => d.display === 'tablet')!.pageWidth).toBeGreaterThan(r.rendered!.find((d) => d.display === 'tablet')!.width);
    } finally {
      await browser.close();
    }
  }, 60000);
});
