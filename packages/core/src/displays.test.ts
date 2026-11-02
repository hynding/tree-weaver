import { afterEach, describe, expect, it } from 'vitest';
import {
  applyDisplaySettings,
  changedDisplaySettings,
  createBranch,
  createCustomKit,
  createRule,
  DEFAULT_DISPLAYS,
  displayForMedia,
  formatDisplaySettings,
  getDisplay,
  mergeDisplaySettings,
  parseDisplaySettings,
  parseRulesCss,
  renderTreeCss,
} from './index';

afterEach(() => applyDisplaySettings({}));

describe('display settings', () => {
  it('reads pair syntax, size shorthand and JSON', () => {
    expect(parseDisplaySettings('xl.breakpoint=1600, tablet.size=768x1024; mobile-portrait.width=375px')).toEqual({
      settings: { xl: { breakpoint: 1600 }, tablet: { width: 768, height: 1024 }, 'mobile-portrait': { width: 375 } },
      errors: [],
    });
    expect(parseDisplaySettings('{"tablet":{"breakpoint":900}}').settings).toEqual({ tablet: { breakpoint: 900 } });
    expect(parseDisplaySettings('').settings).toEqual({});
  });

  it('reports what it could not read and keeps the rest', () => {
    const { settings, errors } = parseDisplaySettings('phone.width=300, tablet.depth=3, tablet.width=12, lg.breakpoint=900, xl.height=1200, junk');
    expect(settings).toEqual({ xl: { height: 1200 } });
    expect(errors).toHaveLength(5);
  });

  it('changes preview sizes and media queries, and restores defaults', () => {
    applyDisplaySettings({ tablet: { width: 768, breakpoint: 900 }, xl: { breakpoint: 1600 } });
    expect(getDisplay('tablet')).toMatchObject({ width: 768, height: 1180, breakpoint: 900, media: '(max-width: 900px)' });
    expect(getDisplay('xl').media).toBe('(min-width: 1600px)');
    const root = createBranch({ styles: { tablet: { color: 'red' } } });
    expect(renderTreeCss(root)).toContain('@media (max-width: 900px)');
    applyDisplaySettings({});
    expect(getDisplay('tablet')).toEqual(DEFAULT_DISPLAYS.find((d) => d.id === 'tablet'));
  });

  it('maps current and default media queries back to displays', () => {
    applyDisplaySettings({ tablet: { breakpoint: 900 } });
    expect(displayForMedia('(max-width:900px)')).toBe('tablet');
    expect(displayForMedia('(max-width: 1024px)')).toBe('tablet');
    expect(displayForMedia('(max-width: 333px)')).toBeUndefined();
    const { rules } = parseRulesCss('@media (max-width: 900px) { .a { color: red } }');
    expect(rules[0].styles.tablet).toEqual({ color: 'red' });
  });

  it('regenerates editable kit CSS with the current breakpoints', () => {
    const rule = { ...createRule('.a'), styles: { tablet: { color: 'red' } } };
    applyDisplaySettings({ tablet: { breakpoint: 900 } });
    expect(createCustomKit('k', [rule]).css).toContain('(max-width: 900px)');
  });

  it('merges, diffs and formats settings', () => {
    const merged = mergeDisplaySettings({ tablet: { width: 768, height: 1180 } }, { tablet: { height: 1024 } });
    expect(merged).toEqual({ tablet: { width: 768, height: 1024 } });
    expect(changedDisplaySettings({ tablet: { width: 820, height: 1024 } })).toEqual({ tablet: { height: 1024 } });
    const text = formatDisplaySettings({ xl: { breakpoint: 1600 }, tablet: { width: 768, height: 1024 }, lg: { height: 900 } });
    expect(text).toBe('lg.height=900,xl.breakpoint=1600,tablet.size=768x1024');
    expect(parseDisplaySettings(text).settings).toEqual({ xl: { breakpoint: 1600 }, tablet: { width: 768, height: 1024 }, lg: { height: 900 } });
  });
});
