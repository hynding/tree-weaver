import { parseColor } from './checks';
import { createId } from './create';
import { parseCss, type CssNode } from './css';
import type { DesignKit } from './model';
import { bracketsBalance, untilStable } from './render';

/**
 * Design tokens: the named colours, spacing and type sizes a forest's design kits define as
 * CSS custom properties (`:root { --brand: #2f6f4f }`).
 *
 * Every enabled kit's `:root` custom properties are tokens. Edits go into a token kit: a kit
 * whose `tokens` are its source and whose `css` is generated from them (`:root { ... }`). It
 * loads after the other kits, so its values win, and everything that reads kits (the canvas,
 * the web exports' kits.css, the native exports) sees the edited values without knowing about
 * tokens. Exports also write the tokens out in each platform's own form: tokens.json, a
 * Tailwind theme, a SwiftUI `DesignTokens` enum and a Flutter `DesignTokens` class.
 */

export type TokenKind = 'color' | 'space' | 'radius' | 'font-family' | 'font-size' | 'font-weight' | 'line-height' | 'shadow' | 'other';

export const TOKEN_KINDS: readonly TokenKind[] = ['color', 'space', 'radius', 'font-family', 'font-size', 'font-weight', 'line-height', 'shadow', 'other'];

/** How the editor groups token kinds. */
export const TOKEN_GROUPS: readonly { label: string; kinds: readonly TokenKind[] }[] = [
  { label: 'Color', kinds: ['color'] },
  { label: 'Spacing', kinds: ['space', 'radius'] },
  { label: 'Type', kinds: ['font-family', 'font-size', 'font-weight', 'line-height'] },
  { label: 'Other', kinds: ['shadow', 'other'] },
];

export interface DesignToken {
  /** A CSS custom property name, e.g. `--brand`. */
  name: string;
  /** Any CSS value, including `var(--other)`. */
  value: string;
  /** What the value is. Inferred from the name and value when left out. */
  kind?: TokenKind;
  description?: string;
}

/** A token as the forest sees it: its current value, where that comes from, and its kind. */
export interface ThemeToken {
  name: string;
  value: string;
  kind: TokenKind;
  description?: string;
  /** The value with `var()` references to other tokens resolved. */
  resolved: string;
  /** Name of the kit the value comes from. */
  source: string;
  /** The value a design kit gives it, when the token kit overrides that. */
  kitValue?: string;
  /** True when the token kit sets it (an edit, or a token added in the editor). */
  edited: boolean;
}

/** Source of the kit that holds token edits. */
export const TOKENS_KIT_SOURCE = 'tokens';

export const isTokenKit = (kit: DesignKit): kit is DesignKit & { tokens: DesignToken[] } => Array.isArray(kit.tokens);

const TOKEN_NAME = /^--[A-Za-z_][\w-]*$/;
export const isTokenName = (name: string): boolean => TOKEN_NAME.test(name);

/** A token value that can't end its declaration or rule early. */
export function sanitizeTokenValue(value: string): string {
  const out = untilStable(value, (v) =>
    v
      .replace(/\/\*[\s\S]*?(\*\/|$)/g, '')
      .replace(/<\/?(style|script)/gi, '')
      .replace(/[{};]/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
  // An unclosed bracket would swallow the rest of the stylesheet.
  return bracketsBalance(out) ? out : '';
}

/** `:root { --a: 1; }` for a list of tokens. */
export function renderTokensCss(tokens: DesignToken[]): string {
  const lines = tokens.filter((t) => isTokenName(t.name) && sanitizeTokenValue(t.value)).map((t) => `  ${t.name}: ${sanitizeTokenValue(t.value)};`);
  return lines.length ? `:root {\n${lines.join('\n')}\n}\n` : '';
}

/** The kit with new tokens, its CSS regenerated. */
export function withTokens(kit: DesignKit, tokens: DesignToken[]): DesignKit {
  return { ...kit, tokens, css: renderTokensCss(tokens) };
}

export function createTokenKit(tokens: DesignToken[] = [], name = 'Tokens'): DesignKit {
  return withTokens({ id: createId('k'), name, css: '', enabled: true, source: TOKENS_KIT_SOURCE }, tokens);
}

const ROOT_SELECTORS = new Set([':root', 'html', ':root, html', 'html, :root']);

/** Custom properties set on `:root` (or `html`) in a stylesheet, in order. Media blocks are skipped. */
export function rootTokens(css: string): DesignToken[] {
  const out = new Map<string, string>();
  const visit = (nodes: CssNode[]) => {
    for (const node of nodes) {
      if (node.type !== 'rule' || !ROOT_SELECTORS.has(node.selector.replace(/\s+/g, ' ').trim())) continue;
      for (const [prop, value] of Object.entries(node.declarations)) if (isTokenName(prop)) out.set(prop, value.trim());
    }
  };
  visit(parseCss(css));
  return [...out].map(([name, value]) => ({ name, value }));
}

/** A token kit read back from CSS (formats that carry only CSS, such as XML and HTML). */
export const tokensFromCss = (css: string): DesignToken[] => rootTokens(css);

/** The longest value `resolveTokenValue` makes. */
const MAX_RESOLVED = 8192;

/** Replace `var(--name, fallback)` with token values, a few levels deep. */
export function resolveTokenValue(value: string, tokens: ReadonlyMap<string, string>, depth = 0): string {
  if (depth > 6 || !value.includes('var(')) return value;
  // The fallback is text with any number of one-level (…) groups; no two quantifiers can match the
  // same characters, so an unclosed `var(` can't make it backtrack.
  // Tokens that use each other several times grow with every level, so the output is capped and a
  // value that would pass the cap is left as it is.
  let size = value.length;
  let over = false;
  const out = value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (m: string, name: string, fallback?: string) => {
    if (over) return m;
    const next = tokens.get(name) ?? fallback?.trim() ?? '';
    size += next.length - m.length;
    if (size > MAX_RESOLVED) over = true;
    return over ? m : next;
  });
  if (over) return value;
  return out === value ? out : resolveTokenValue(out, tokens, depth + 1);
}

const LENGTH = /^-?\d*\.?\d+(px|rem|em|pt|%|vw|vh|ch)?$/;
const FONT_KEYWORDS = /\b(serif|sans-serif|monospace|system-ui|cursive|fantasy|ui-sans-serif|ui-serif|ui-monospace|-apple-system)\b/;

/** Guess what a token is from its name and (resolved) value. */
export function inferTokenKind(name: string, value: string): TokenKind {
  const n = name.toLowerCase();
  const v = value.trim().toLowerCase();
  if (/shadow/.test(n)) return 'shadow';
  if (/radius|rounded|corner/.test(n)) return 'radius';
  if (/weight/.test(n) || (/font/.test(n) && /^(\d00|bold|normal|lighter|bolder)$/.test(v))) return 'font-weight';
  if (/line-?height|leading/.test(n)) return 'line-height';
  if (/family|font/.test(n) && (FONT_KEYWORDS.test(v) || /["',]/.test(v))) return 'font-family';
  if (FONT_KEYWORDS.test(v) && /,/.test(v)) return 'font-family';
  if (!/^(0|\d*\.?\d+)$/.test(v) && parseColor(v)) return 'color';
  if (/font-?size|text-|size|fs-/.test(n) && LENGTH.test(v)) return 'font-size';
  if (LENGTH.test(v) || /^(clamp|calc|min|max)\(/.test(v)) return 'space';
  return 'other';
}

/**
 * The forest's tokens: every enabled kit's `:root` custom properties, later kits winning, with
 * the token kit's edits on top. Order: first definition wins the position.
 */
export function themeTokens(kits: DesignKit[]): ThemeToken[] {
  const byName = new Map<string, ThemeToken & { explicitKind?: TokenKind }>();
  for (const kit of kits) {
    if (!kit.enabled) continue;
    const edited = isTokenKit(kit);
    const list = edited ? kit.tokens : kit.css.trim() ? rootTokens(kit.css) : [];
    for (const t of list) {
      if (!isTokenName(t.name)) continue;
      const prev = byName.get(t.name);
      const explicitKind = t.kind ?? prev?.explicitKind;
      byName.set(t.name, {
        name: t.name,
        value: t.value,
        kind: explicitKind ?? 'other',
        explicitKind,
        description: t.description ?? prev?.description,
        resolved: t.value,
        source: kit.name,
        kitValue: edited && prev ? (prev.edited ? prev.kitValue : prev.value) : undefined,
        edited: edited || (prev?.edited ?? false),
      });
    }
  }
  const values = new Map([...byName].map(([k, t]) => [k, t.value]));
  return [...byName.values()].map(({ explicitKind, ...t }) => {
    const resolved = resolveTokenValue(t.value, values);
    const out: ThemeToken = { ...t, resolved, kind: explicitKind ?? inferTokenKind(t.name, resolved) };
    if (out.kitValue === undefined) delete out.kitValue;
    if (out.description === undefined) delete out.description;
    return out;
  });
}

/** Token name → resolved value, for the forest's enabled kits. */
export function tokenValues(kits: DesignKit[]): Map<string, string> {
  return new Map(themeTokens(kits).map((t) => [t.name, t.resolved]));
}

/** The kits with a token set (or added) in the token kit, created last when missing. */
export function setToken(kits: DesignKit[], token: DesignToken): DesignKit[] {
  if (!isTokenName(token.name)) throw new Error(`"${token.name}" is not a token name: use --letters-digits-and-dashes`);
  const value = sanitizeTokenValue(token.value);
  if (!value) throw new Error(`Token ${token.name} needs a value`);
  const clean: DesignToken = { name: token.name, value, ...(token.kind ? { kind: token.kind } : {}), ...(token.description ? { description: token.description } : {}) };
  const i = kits.findIndex(isTokenKit);
  if (i < 0) return [...kits, createTokenKit([clean])];
  const kit = kits[i] as DesignKit & { tokens: DesignToken[] };
  const exists = kit.tokens.some((t) => t.name === token.name);
  const tokens = exists ? kit.tokens.map((t) => (t.name === token.name ? { ...t, ...clean } : t)) : [...kit.tokens, clean];
  return kits.map((k, j) => (j === i ? withTokens(k, tokens) : k));
}

/** Add kits before the token kit, so token edits keep winning over newly added kits. */
export function addKitsBeforeTokens(kits: DesignKit[], added: DesignKit[]): DesignKit[] {
  if (!added.length) return kits;
  const i = kits.findIndex(isTokenKit);
  return i < 0 ? [...kits, ...added] : [...kits.slice(0, i), ...added, ...kits.slice(i)];
}

/** The kits with a token edit removed, so the kit value shows again (or the added token is gone). */
export function resetToken(kits: DesignKit[], name: string): DesignKit[] {
  return kits.map((k) => (isTokenKit(k) ? withTokens(k, k.tokens.filter((t) => t.name !== name)) : k));
}

/** A token name as a Swift or Dart identifier: `--tw-color-accent` → `twColorAccent`. */
export function tokenIdentifier(name: string): string {
  const words = name.replace(/^--/, '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  const id = words.map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1))).join('');
  return !id ? 'token' : /^[0-9]/.test(id) ? `t${id}` : id;
}

/** Tokens as a W3C Design Tokens (DTCG) file: `{ "brand": { "$value": "#2f6f4f", "$type": "color" } }`. */
export function tokensToDtcg(tokens: ThemeToken[]): Record<string, unknown> {
  const TYPE: Partial<Record<TokenKind, string>> = { color: 'color', space: 'dimension', radius: 'dimension', 'font-size': 'dimension', 'font-family': 'fontFamily', 'font-weight': 'fontWeight', 'line-height': 'number', shadow: 'shadow' };
  const out: Record<string, unknown> = {};
  for (const t of tokens) {
    const entry: Record<string, unknown> = { $value: t.resolved };
    const type = TYPE[t.kind];
    if (type) entry.$type = type;
    if (t.description) entry.$description = t.description;
    out[t.name.replace(/^--/, '')] = entry;
  }
  return out;
}
