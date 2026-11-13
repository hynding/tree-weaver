import { describe, expect, it } from 'vitest';
import { createBranch } from './create';
import {
  applyGridLayout,
  applySmallScreen,
  areaNames,
  brokenAreas,
  clearAreas,
  startAreas,
  flowAreas,
  formatAreas,
  gapPreset,
  getGridLayout,
  matchGridLayout,
  paintAreas,
  parseAreas,
  readSmallScreen,
  removeAreaColumn,
  resizeAreas,
  smallerDisplays,
} from './grid-layouts';
import { resolveStyles } from './displays';
import type { Branch } from './model';
import { findNode } from './ops';

describe('named areas', () => {
  it('parses and formats areas', () => {
    const areas = parseAreas(`"header header" "nav main" ". footer"`);
    expect(areas).toEqual([
      ['header', 'header'],
      ['nav', 'main'],
      ['.', 'footer'],
    ]);
    expect(formatAreas(areas!)).toBe('"header header" "nav main" ". footer"');
    expect(parseAreas('none')).toEqual([]);
    expect(parseAreas("'a ...'")).toEqual([['a', '.']]);
  });

  it('rejects uneven or unquoted values', () => {
    expect(parseAreas('"a b" "c"')).toBeNull();
    expect(parseAreas('a b')).toBeNull();
  });

  it('lists names and finds broken areas', () => {
    const areas = parseAreas('"a a b" "c a b"')!;
    expect(areaNames(areas)).toEqual(['a', 'b', 'c']);
    expect(brokenAreas(areas)).toEqual(['a']);
  });

  it('paints rectangles in any direction', () => {
    const areas = resizeAreas([], 2, 3);
    expect(paintAreas(areas, [1, 2], [0, 1], 'x')).toEqual([
      ['.', 'x', 'x'],
      ['.', 'x', 'x'],
    ]);
  });

  it('resizes by stretching the last column', () => {
    expect(resizeAreas([['a', 'b']], 2, 3)).toEqual([
      ['a', 'b', 'b'],
      ['.', '.', '.'],
    ]);
    expect(removeAreaColumn([['a', 'b', 'c']], 1)).toEqual([['a', 'c']]);
  });

  it('flows areas into fewer columns', () => {
    expect(flowAreas(['a', 'b', 'c'], 2)).toEqual([
      ['a', 'b'],
      ['c', 'c'],
    ]);
    expect(flowAreas(['a', 'b'], 1)).toEqual([['a'], ['b']]);
  });
});

const grid = (children: Branch[] = []): Branch => createBranch({ tag: 'section', children });

describe('layouts', () => {
  it('applies a layout with areas, filling existing children and adding boxes', () => {
    const first = createBranch({ styles: { lg: { 'grid-column': 'span 2' } } });
    const root = grid([first]);
    const { root: next, created } = applyGridLayout(root, root.id, 'lg', getGridLayout('holy-grail')!);
    expect(created).toHaveLength(4);
    expect(next.styles.lg).toMatchObject({ display: 'grid', 'grid-template-columns': '200px minmax(0, 1fr) 200px', gap: '1rem' });
    expect(next.children.map((c) => (c as Branch).styles.lg?.['grid-area'])).toEqual(['header', 'nav', 'main', 'aside', 'footer']);
    expect((next.children[0] as Branch).styles.lg?.['grid-column']).toBeUndefined();
    expect((next.children[1] as Branch).tag).toBe('nav');
    expect(matchGridLayout(next.styles.lg!)?.id).toBe('holy-grail');
  });

  it('applies plain columns and clears areas inherited from a bigger display', () => {
    const root = grid();
    let { root: next } = applyGridLayout(root, root.id, 'lg', getGridLayout('sidebar-left')!);
    ({ root: next } = applyGridLayout(next, root.id, 'tablet', getGridLayout('two')!));
    expect(next.styles.tablet).toMatchObject({ 'grid-template-columns': 'repeat(2, minmax(0, 1fr))', 'grid-template-areas': 'none' });
    expect((next.children[0] as Branch).styles.tablet?.['grid-area']).toBe('auto');
    expect(next.children).toHaveLength(2);
  });
});

describe('smaller screens', () => {
  it('lists the narrower displays', () => {
    expect(smallerDisplays()).toEqual(['tablet', 'mobile-landscape', 'mobile-portrait']);
  });

  it('stacks named areas in reading order', () => {
    const root = grid();
    const { root: laid } = applyGridLayout(root, root.id, 'lg', getGridLayout('holy-grail')!);
    const next = applySmallScreen(laid, root.id, 'tablet', { kind: 'stack' });
    expect(next.styles.tablet).toEqual({ 'grid-template-columns': 'minmax(0, 1fr)', 'grid-template-areas': '"header" "nav" "main" "aside" "footer"' });
    expect(readSmallScreen(next, 'tablet')).toEqual({ kind: 'stack' });
    expect(readSmallScreen(next, 'mobile-portrait')).toEqual({ kind: 'keep' });
    const two = applySmallScreen(next, root.id, 'mobile-landscape', { kind: 'columns', count: 2 });
    expect(readSmallScreen(two, 'mobile-landscape')).toEqual({ kind: 'columns', count: 2 });
    const kept = applySmallScreen(next, root.id, 'tablet', { kind: 'keep' });
    expect(kept.styles.tablet).toBeUndefined();
  });

  it('pulls wide children back inside fewer columns', () => {
    const wide = createBranch({ styles: { lg: { 'grid-column': '2 / span 3' } } });
    const full = createBranch({ styles: { lg: { 'grid-column': '1 / -1' } } });
    const plain = createBranch();
    const root = grid([wide, full, plain]);
    root.styles = { lg: { display: 'grid', 'grid-template-columns': 'repeat(4, minmax(0, 1fr))' } };
    const next = applySmallScreen(root, root.id, 'tablet', { kind: 'columns', count: 2 });
    expect(resolveStyles((findNode(next, wide.id) as Branch).styles, 'tablet')['grid-column']).toBe('span 2');
    expect((findNode(next, full.id) as Branch).styles.tablet).toBeUndefined();
    expect((findNode(next, plain.id) as Branch).styles.tablet).toBeUndefined();
    expect(readSmallScreen(next, 'tablet')).toEqual({ kind: 'columns', count: 2 });
  });

  it('calls hand-made columns custom', () => {
    const root = grid();
    root.styles = { lg: { display: 'grid' }, tablet: { 'grid-template-columns': '1fr 200px' } };
    expect(readSmallScreen(root, 'tablet')).toEqual({ kind: 'custom' });
  });
});

describe('starting and clearing areas', () => {
  it('names an area after each child', () => {
    const a = createBranch({ name: 'Top bar' });
    const b = createBranch({ type: 'card' });
    const c = createBranch({ type: 'card' });
    const root = grid([a, b, c]);
    root.styles = { lg: { display: 'grid', 'grid-template-columns': 'repeat(2, minmax(0, 1fr))' } };
    const next = startAreas(root, root.id, 'lg');
    expect(next.styles.lg?.['grid-template-areas']).toBe('"top-bar card" "card-2 card-2"');
    expect(next.children.map((x) => (x as Branch).styles.lg?.['grid-area'])).toEqual(['top-bar', 'card', 'card-2']);
    const tablet = clearAreas(next, root.id, 'tablet');
    expect(tablet.styles.tablet?.['grid-template-areas']).toBe('none');
    expect((tablet.children[0] as Branch).styles.tablet?.['grid-area']).toBe('auto');
    const cleared = clearAreas(next, root.id, 'lg');
    expect(cleared.styles.lg?.['grid-template-areas']).toBeUndefined();
    expect((cleared.children[0] as Branch).styles.lg).toBeUndefined();
  });
});

describe('gap presets', () => {
  it('matches equivalent values', () => {
    expect(gapPreset('1rem')?.id).toBe('medium');
    expect(gapPreset('16px')?.id).toBe('medium');
    expect(gapPreset('0px')?.id).toBe('none');
    expect(gapPreset('8px 8px')?.id).toBe('small');
    expect(gapPreset('12px')).toBeUndefined();
    expect(gapPreset(undefined)).toBeUndefined();
  });
});
