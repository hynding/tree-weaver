import { createId } from './create';
import { parseCss, type CssNode } from './css';
import { DISPLAYS } from './displays';
import type { DesignKit, DisplayId, StyleMap, StyleRule } from './model';
import { renderDisplayCss } from './render';

/**
 * Custom classes and selectors. They live in an editable design kit: a kit whose
 * `rules` are its source and whose `css` is generated from them, so everything that
 * reads kits (the canvas, exports, matched styles, class suggestions) sees them as CSS.
 */

/** Source of the kit new custom rules go into. */
export const CUSTOM_KIT_SOURCE = 'custom';

export const isEditableKit = (kit: DesignKit): kit is DesignKit & { rules: StyleRule[] } => Array.isArray(kit.rules);

/** Tidy a selector so it can't break out of its rule: no braces, semicolons, comments or tags. */
export function sanitizeSelector(selector: string): string {
  return selector
    .replace(/\/\*[\s\S]*?(\*\/|$)/g, '')
    .replace(/<\/?(style|script)/gi, '')
    .replace(/[{};@]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const CLASS_NAME = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/;

/** Whether `name` can be used as a class without escaping. */
export const isClassName = (name: string): boolean => CLASS_NAME.test(name);

/** The class a selector targets when it is a single plain class, e.g. `card` for `.card`. */
export function classOfSelector(selector: string): string | null {
  const m = /^\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)$/.exec(selector.trim());
  return m ? m[1] : null;
}

export function createRule(selector: string, styles: StyleRule['styles'] = {}): StyleRule {
  return { id: createId('r'), selector: sanitizeSelector(selector), styles };
}

/** CSS for a list of custom rules: base rules first, then one media block per display. */
export function renderRulesCss(rules: StyleRule[]): string {
  return renderDisplayCss(rules.map((r) => ({ selector: sanitizeSelector(r.selector), styles: r.styles })));
}

/** The kit with new rules, its CSS regenerated. */
export function withRules(kit: DesignKit, rules: StyleRule[]): DesignKit {
  return { ...kit, rules, css: renderRulesCss(rules) };
}

export function createCustomKit(name = 'Custom styles', rules: StyleRule[] = []): DesignKit {
  return withRules({ id: createId('k'), name, css: '', enabled: true, source: CUSTOM_KIT_SOURCE }, rules);
}

const normalizeMedia = (m: string): string => m.replace(/\s+/g, '').toLowerCase();
const MEDIA_TO_DISPLAY = new Map<string, DisplayId>(DISPLAYS.filter((d) => d.media).map((d) => [normalizeMedia(d.media as string), d.id]));

export interface ParsedRules {
  rules: StyleRule[];
  /** At-rules and media queries that don't map to a display, which editable kits can't hold. */
  skipped: string[];
}

/**
 * Read CSS into custom rules. Plain rules become base display styles, and rules inside a
 * display's media query become that display's styles. Rules sharing a selector merge.
 * `previous` keeps rule ids stable for selectors that were already there.
 */
export function parseRulesCss(css: string, previous: StyleRule[] = []): ParsedRules {
  const bySelector = new Map<string, StyleRule>();
  const skipped: string[] = [];
  const known = new Map(previous.map((r) => [r.selector, r.id]));
  const add = (selector: string, display: DisplayId, declarations: StyleMap) => {
    const sel = sanitizeSelector(selector);
    if (!sel || !Object.keys(declarations).length) return;
    let rule = bySelector.get(sel);
    if (!rule) {
      rule = { id: known.get(sel) ?? createId('r'), selector: sel, styles: {} };
      bySelector.set(sel, rule);
    }
    rule.styles[display] = { ...rule.styles[display], ...declarations };
  };
  const visit = (nodes: CssNode[], display: DisplayId | null) => {
    for (const node of nodes) {
      if (node.type === 'rule') {
        if (display) add(node.selector, display, node.declarations);
      } else if (!display || node.name !== 'media' || !node.children) {
        skipped.push(`@${node.name}${node.prelude ? ` ${node.prelude}` : ''}`);
      } else {
        const target = MEDIA_TO_DISPLAY.get(normalizeMedia(node.prelude));
        if (target && display === 'lg') visit(node.children, target);
        else skipped.push(`@media ${node.prelude}`);
      }
    }
  };
  visit(parseCss(css), 'lg');
  return { rules: [...bySelector.values()], skipped };
}

/** Set or clear one declaration of a rule on a display. */
export function setRuleStyle(rule: StyleRule, display: DisplayId, prop: string, value: string | null): StyleRule {
  const current: StyleMap = { ...rule.styles[display] };
  if (value === null || value.trim() === '') delete current[prop];
  else current[prop] = value.trim();
  const styles = { ...rule.styles };
  if (Object.keys(current).length) styles[display] = current;
  else delete styles[display];
  return { ...rule, styles };
}
