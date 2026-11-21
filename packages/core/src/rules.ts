import { cssOverlaps } from './longhands';
import { createId } from './create';
import { declarationList, parseCss, type CssNode } from './css';
import { DISPLAY_IDS, displayForMedia } from './displays';
import type { DesignKit, DisplayId, StyleMap, StyleRule } from './model';
import { bracketsBalance, isSafeCssProp, renderDisplayCss, sanitizeCssValue, untilStable } from './render';

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
  // Repeated until nothing changes: dropping a character can bring `/` and `*` together.
  const out = untilStable(selector, (s) =>
    selectorPunctuation(
      s
        .replace(/\/\*[\s\S]*?(\*\/|$)/g, '')
        .replace(/<\/?(style|script)/gi, '')
        .replace(/[\n\r\f]+/g, ' '),
    ) ?? '',
  )
    .replace(/\s+/g, ' ')
    .trim();
  // An unclosed `(` or `[` would swallow every rule after it.
  return bracketsBalance(out) ? out : '';
}

/**
 * Drop `{`, `}`, `;` and `@` that could end the rule or start another, keeping escaped ones
 * (`.\@container`, Tailwind's `\@md\:flex`) and those inside strings (`[data-x="a;b"]`).
 * Null when a string is left open.
 */
function selectorPunctuation(selector: string): string | null {
  let out = '';
  let quote = '';
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === '\\') {
      // A trailing backslash would escape whatever the rule adds next.
      if (i + 1 < selector.length) out += c + selector[++i];
      continue;
    }
    if (quote) {
      if (c === quote) quote = '';
      out += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      out += c;
    } else if (!/[{};@]/.test(c)) out += c;
  }
  return quote ? null : out;
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
  return renderDisplayCss(rules.map((r) => ({ selector: sanitizeSelector(r.selector), styles: r.styles })).filter((r) => r.selector));
}

/** The kit with new rules, its CSS regenerated. */
export function withRules(kit: DesignKit, rules: StyleRule[]): DesignKit {
  return { ...kit, rules, css: renderRulesCss(rules) };
}

export function createCustomKit(name = 'Custom styles', rules: StyleRule[] = []): DesignKit {
  return withRules({ id: createId('k'), name, css: '', enabled: true, source: CUSTOM_KIT_SOURCE }, rules);
}


export interface ParsedRules {
  rules: StyleRule[];
  /** At-rules and media queries that don't map to a display, which editable kits can't hold. */
  skipped: string[];
  /**
   * Rules whose effect depends on where they sit, which merging by selector would change: a
   * property given twice in one rule (a fallback), a selector repeated after a rule that sets the
   * same property, or a plain rule after a media query that sets the same property.
   */
  reordered: string[];
  /**
   * What the kit's CSS would lose or change once written back from rules: a nested rule, a
   * property name or hack that isn't kept (`*zoom`), or a selector or value that has to be
   * tidied (`\@`, `content: "{"`).
   */
  changed: string[];
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
  const reordered: string[] = [];
  const seen: { selector: string; display: DisplayId; props: Set<string> }[] = [];
  const note = (text: string) => {
    if (!reordered.includes(text)) reordered.push(text);
  };
  const changed: string[] = [];
  const change = (text: string) => {
    if (!changed.includes(text)) changed.push(text);
  };
  const add = (selector: string, display: DisplayId, declarations: StyleMap, body: string) => {
    const sel = sanitizeSelector(selector);
    const plain = selector.replace(/\s+/g, ' ').trim();
    if (sel !== plain) change(`the selector ${plain || selector}`);
    // Strings set aside, a brace left in the body is a nested rule, which rules can't hold.
    if (/[{}]/.test(body.replace(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g, ''))) change(`a rule nested in ${plain}`);
    const entries = declarationList(body);
    for (const [prop, value] of entries) {
      if (!isSafeCssProp(prop)) change(`${prop} in ${plain}`);
      // Line breaks in a value (grid areas) are kept as spaces, which reads the same.
      else if (sanitizeCssValue(value) !== value.replace(/[\n\r\f]+/g, ' ').trim()) change(`the ${prop} value in ${plain}`);
    }
    if (!sel || !Object.keys(declarations).length) return;
    const list = entries.map(([prop]) => prop);
    const props = new Set(list);
    if (props.size < list.length) note(`a property given twice in ${sel}`);
    // A shorthand and its longhands clash too (`padding` and `padding-left`).
    const overlaps = (other: Set<string>) => [...props].some((p) => other.has(p) || [...other].some((o) => cssOverlaps(p, o)));
    let last = -1;
    seen.forEach((r, i) => {
      if (r.selector === sel && r.display === display) last = i;
    });
    if (last >= 0 && seen.slice(last + 1).some((r) => overlaps(r.props))) note(`${sel} set again after other rules`);
    if (display === 'lg' && seen.some((r) => r.display !== 'lg' && overlaps(r.props))) note(`${sel} after a media query`);
    // Display blocks are written back in display order (tablet before the phones), so a rule
    // that comes after one written later would lose to it once converted.
    else if (seen.some((r) => r.display !== 'lg' && DISPLAY_IDS.indexOf(r.display) > DISPLAY_IDS.indexOf(display) && overlaps(r.props))) {
      note(`${sel} after a narrower display's media query`);
    }
    seen.push({ selector: sel, display, props });
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
        if (display) add(node.selector, display, node.declarations, node.body);
      } else if (!display || node.name !== 'media' || !node.children) {
        skipped.push(`@${node.name}${node.prelude ? ` ${node.prelude}` : ''}`);
      } else {
        const target = displayForMedia(node.prelude);
        if (target && display === 'lg') visit(node.children, target);
        else skipped.push(`@media ${node.prelude}`);
      }
    }
  };
  visit(parseCss(css), 'lg');
  return { rules: [...bySelector.values()], skipped, reordered, changed };
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
