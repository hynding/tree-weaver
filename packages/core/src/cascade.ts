/**
 * The pieces of the CSS cascade the inspector needs to explain where an element's
 * styles come from: selector specificity, which declarations win, and where each
 * rule sits in its stylesheet's text. Nothing here touches the DOM, so the editor
 * collects matched rules from the canvas and hands them over as plain data.
 */

/** `[ids, classes/attributes/pseudo-classes, types/pseudo-elements]` */
export type Specificity = [number, number, number];

export interface CascadeDeclaration {
  property: string;
  value: string;
  important: boolean;
  /** The longhand properties this declaration sets (just itself unless it is a shorthand). */
  longhands: string[];
  /** Set by `resolveCascade`: another declaration wins every property this one sets. */
  overridden?: boolean;
}

export interface CascadeRule {
  specificity: Specificity;
  /**
   * Cascade layer position, in the order layers are first declared. Unlayered rules
   * use `UNLAYERED`, which beats every layer for normal declarations and loses to
   * every layer for `!important` ones.
   */
  layer: number;
  /** Position among all rules in the document, so later rules win ties. */
  order: number;
  /** From a `style` attribute, which beats every rule. */
  inline?: boolean;
  declarations: CascadeDeclaration[];
}

export const UNLAYERED = Number.MAX_SAFE_INTEGER;

/* ----------------------------------------------------------- selectors */

/** Split a selector list at its top-level commas: `a, b:is(c, d)` → `a`, `b:is(c, d)`. */
export function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === '\\') i++;
    else if (ch === '"' || ch === "'") i = skipString(selector, i);
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(selector.slice(start).trim());
  return parts.filter(Boolean);
}

/** Index of the closing quote of the string starting at `start`. */
function skipString(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length && text[i] !== text[start]) {
    if (text[i] === '\\') i++;
    i++;
  }
  return i;
}

/** Index just past the `)` matching the `(` at `open`. */
function skipParens(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') i++;
    else if (ch === '"' || ch === "'") i = skipString(text, i);
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i + 1;
  }
  return text.length;
}

const IDENT_CHAR = /[-_a-zA-Z0-9 -￿]/;

/** Index just past the identifier starting at `start`, escapes included. */
function skipIdent(text: string, start: number): number {
  let i = start;
  while (i < text.length) {
    if (text[i] === '\\') i += 2;
    else if (IDENT_CHAR.test(text[i])) i++;
    else break;
  }
  return i;
}

/** Pseudo-elements that may still be written with one colon. */
const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);

const add = (a: Specificity, b: Specificity): Specificity => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Positive when `a` is more specific than `b`. */
export function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

const maxSpecificity = (list: string): Specificity =>
  splitSelectorList(list)
    .map(selectorSpecificity)
    .reduce<Specificity>((best, s) => (compareSpecificity(s, best) > 0 ? s : best), [0, 0, 0]);

/**
 * Specificity of one complex selector (no top-level commas), following Selectors
 * Level 4: `:is()`, `:not()` and `:has()` count as their most specific argument,
 * `:where()` counts as nothing, and `:nth-child(… of S)` adds S to its own weight.
 */
export function selectorSpecificity(selector: string): Specificity {
  let s: Specificity = [0, 0, 0];
  let i = 0;
  while (i < selector.length) {
    const ch = selector[i];
    if (ch === '#') {
      s[0]++;
      i = skipIdent(selector, i + 1);
    } else if (ch === '.') {
      s[1]++;
      i = skipIdent(selector, i + 1);
    } else if (ch === '[') {
      s[1]++;
      while (i < selector.length && selector[i] !== ']') {
        if (selector[i] === '"' || selector[i] === "'") i = skipString(selector, i);
        i++;
      }
      i++;
    } else if (ch === ':') {
      const element = selector[i + 1] === ':';
      const nameStart = i + (element ? 2 : 1);
      const nameEnd = skipIdent(selector, nameStart);
      const name = selector.slice(nameStart, nameEnd).toLowerCase();
      let end = nameEnd;
      let args: string | null = null;
      if (selector[nameEnd] === '(') {
        end = skipParens(selector, nameEnd);
        args = selector.slice(nameEnd + 1, end - 1);
      }
      if (element || LEGACY_PSEUDO_ELEMENTS.has(name)) s[2]++;
      else if (name === 'where') {
        // Adds nothing.
      } else if ((name === 'is' || name === 'not' || name === 'has' || name === 'matches' || name === '-webkit-any') && args !== null) {
        s = add(s, maxSpecificity(args));
      } else if ((name === 'nth-child' || name === 'nth-last-child') && args !== null && /\sof\s/i.test(args)) {
        s = add(add(s, [0, 1, 0]), maxSpecificity(args.slice(args.search(/\sof\s/i) + 4)));
      } else s[1]++;
      i = end;
    } else if (ch === '\\' || IDENT_CHAR.test(ch)) {
      const end = skipIdent(selector, i);
      // `ns|type`: the namespace prefix adds nothing.
      if (selector[end] !== '|' || selector[end + 1] === '=') s[2]++;
      i = end;
    } else i++;
  }
  return s;
}

/* -------------------------------------------------------------- cascade */

/** Precedence of a declaration in a rule, as a tuple compared left to right. */
function precedence(rule: CascadeRule, important: boolean): number[] {
  const layer = important ? -rule.layer : rule.layer;
  return [important ? 1 : 0, rule.inline ? 1 : 0, layer, ...rule.specificity, rule.order];
}

function compareTuples(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Rules sorted the way DevTools lists them: the rule whose normal declarations win comes first. */
export function sortByPrecedence<T extends CascadeRule>(rules: T[]): T[] {
  return [...rules].sort((a, b) => compareTuples(precedence(b, false), precedence(a, false)));
}

/** Properties that pass from parent to child. Custom properties (`--*`) inherit too. */
export const INHERITED_PROPERTIES: ReadonlySet<string> = new Set([
  'border-collapse',
  'border-spacing',
  'caption-side',
  'color',
  'color-scheme',
  'cursor',
  'direction',
  'empty-cells',
  'font',
  'font-family',
  'font-feature-settings',
  'font-kerning',
  'font-optical-sizing',
  'font-palette',
  'font-size',
  'font-size-adjust',
  'font-stretch',
  'font-style',
  'font-synthesis',
  'font-variant',
  'font-variant-alternates',
  'font-variant-caps',
  'font-variant-east-asian',
  'font-variant-ligatures',
  'font-variant-numeric',
  'font-variant-position',
  'font-variation-settings',
  'font-weight',
  'hyphens',
  'letter-spacing',
  'line-break',
  'line-height',
  'list-style',
  'list-style-image',
  'list-style-position',
  'list-style-type',
  'orphans',
  'overflow-wrap',
  'paint-order',
  'pointer-events',
  'quotes',
  'tab-size',
  'text-align',
  'text-align-last',
  'text-decoration-skip-ink',
  'text-indent',
  'text-justify',
  'text-rendering',
  'text-shadow',
  'text-transform',
  'text-underline-offset',
  'text-underline-position',
  'text-wrap',
  'visibility',
  'white-space',
  'widows',
  'word-break',
  'word-spacing',
  'word-wrap',
  'writing-mode',
  '-webkit-font-smoothing',
  '-webkit-text-fill-color',
]);

export const isInherited = (property: string): boolean => property.startsWith('--') || INHERITED_PROPERTIES.has(property);

/**
 * Work out which declarations take effect. `groups[0]` holds the rules that match the
 * element itself and later groups hold its ancestors' rules, nearest first; from those,
 * only inherited properties count, and only where nothing closer set them. Each
 * declaration's `overridden` is set in place. Returns the winning declaration for every
 * longhand property.
 */
export function resolveCascade(groups: CascadeRule[][]): Map<string, CascadeDeclaration> {
  const decided = new Map<string, CascadeDeclaration>();
  groups.forEach((rules, depth) => {
    const own = depth === 0;
    const best = new Map<string, { decl: CascadeDeclaration; key: number[] }>();
    for (const rule of rules) {
      for (const decl of rule.declarations) {
        const key = precedence(rule, decl.important);
        for (const prop of decl.longhands) {
          if (decided.has(prop) || (!own && !isInherited(prop))) continue;
          const current = best.get(prop);
          if (!current || compareTuples(key, current.key) >= 0) best.set(prop, { decl, key });
        }
      }
    }
    for (const rule of rules) {
      for (const decl of rule.declarations) {
        const counted = decl.longhands.filter((p) => own || isInherited(p));
        decl.overridden = !counted.some((p) => !decided.has(p) && best.get(p)?.decl === decl);
      }
    }
    for (const [prop, { decl }] of best) decided.set(prop, decl);
  });
  return decided;
}

/* ------------------------------------------------------- source lines */

export interface RuleLocation {
  selector: string;
  /** 1-based line of the selector's start. */
  line: number;
}

/** At-rules whose blocks hold style rules the cascade sees. */
const GROUPING_AT_RULES = new Set(['media', 'supports', 'layer', 'container', 'scope', 'document', '-moz-document', 'starting-style']);

/**
 * Every style rule in a stylesheet's text, in source order, with the line it starts on.
 * Rules inside `@media`, `@supports`, `@layer` and similar blocks are included;
 * `@font-face`, `@keyframes` and other at-rule blocks are skipped.
 */
export function locateRules(css: string): RuleLocation[] {
  // Blank out comments (keeping new lines) so offsets still match the original text.
  const text = css.replace(/\/\*[\s\S]*?(\*\/|$)/g, (c) => c.replace(/[^\n]/g, ' '));
  const out: RuleLocation[] = [];
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineAt = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'") i = skipString(text, i);
    else if (ch === ';' || ch === '}') start = i + 1;
    else if (ch === '{') {
      const prelude = text.slice(start, i);
      const trimmed = prelude.trim();
      const at = /^@([-\w]+)/.exec(trimmed);
      if (at && GROUPING_AT_RULES.has(at[1].toLowerCase())) {
        start = i + 1;
        continue;
      }
      if (!at && trimmed) out.push({ selector: trimmed, line: lineAt(start + prelude.search(/\S/)) });
      i = skipBlock(text, i);
      start = i + 1;
    }
  }
  return out;
}

/** Index of the `}` closing the block opened at `open`. */
function skipBlock(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'") i = skipString(text, i);
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return text.length;
}

/** Selectors compared loosely: browsers re-serialize whitespace, quotes and case. */
const looseSelector = (selector: string) => selector.replace(/["'\s]/g, '').toLowerCase();

/** How far ahead to look for a rule the browser parsed, past rules it dropped. */
const LOOKAHEAD = 64;

/**
 * Lines for the style rules a browser parsed from `css`, given their selectors in the
 * order the browser lists them. Browsers drop rules they can't parse, so each rule is
 * found by selector from where the last one was found; any not found get `undefined`.
 */
export function alignRuleLines(css: string | RuleLocation[], parsedSelectors: string[]): (number | undefined)[] {
  const located = (typeof css === 'string' ? locateRules(css) : css).map((r) => ({ key: looseSelector(r.selector), line: r.line }));
  let next = 0;
  return parsedSelectors.map((selector) => {
    const key = looseSelector(selector);
    for (let j = next; j < Math.min(located.length, next + LOOKAHEAD); j++) {
      if (located[j].key === key) {
        next = j + 1;
        return located[j].line;
      }
    }
    return undefined;
  });
}
