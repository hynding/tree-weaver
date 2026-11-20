import { themeTokens, tokensToDtcg, type DesignKit, type ThemeToken, type TokenKind } from '@tree-weaver/core';

/**
 * Design tokens written out for web codebases: a W3C Design Tokens file (`tokens.json`) and a
 * Tailwind theme that maps each token to a utility name (`bg-brand`, `p-space-3`), as CSS for
 * Tailwind v4 (`@theme inline`) and as a preset for Tailwind v3. Values stay `var(--token)`,
 * so kits.css (with the token kit's edits) remains the one source of the values.
 */

/** Tailwind theme namespaces per token kind: the v4 CSS variable prefix, the v3 theme key. */
const TAILWIND_NAMESPACE: Partial<Record<TokenKind, { v4: string; v3: string }>> = {
  color: { v4: 'color', v3: 'colors' },
  space: { v4: 'spacing', v3: 'spacing' },
  radius: { v4: 'radius', v3: 'borderRadius' },
  'font-size': { v4: 'text', v3: 'fontSize' },
  'font-family': { v4: 'font', v3: 'fontFamily' },
  'font-weight': { v4: 'font-weight', v3: 'fontWeight' },
  'line-height': { v4: 'leading', v3: 'lineHeight' },
  shadow: { v4: 'shadow', v3: 'boxShadow' },
};

/** CSS properties whose Tailwind utility can take a token of a kind, and the utility prefix. */
const TOKEN_UTILITIES: Record<string, { kind: TokenKind; prefix: string }> = {
  color: { kind: 'color', prefix: 'text' },
  background: { kind: 'color', prefix: 'bg' },
  'background-color': { kind: 'color', prefix: 'bg' },
  'border-color': { kind: 'color', prefix: 'border' },
  'border-radius': { kind: 'radius', prefix: 'rounded' },
  'font-size': { kind: 'font-size', prefix: 'text' },
  'font-family': { kind: 'font-family', prefix: 'font' },
  'font-weight': { kind: 'font-weight', prefix: 'font' },
  'line-height': { kind: 'line-height', prefix: 'leading' },
  'box-shadow': { kind: 'shadow', prefix: 'shadow' },
  gap: { kind: 'space', prefix: 'gap' },
  'row-gap': { kind: 'space', prefix: 'gap-y' },
  'column-gap': { kind: 'space', prefix: 'gap-x' },
  padding: { kind: 'space', prefix: 'p' },
  'padding-top': { kind: 'space', prefix: 'pt' },
  'padding-right': { kind: 'space', prefix: 'pr' },
  'padding-bottom': { kind: 'space', prefix: 'pb' },
  'padding-left': { kind: 'space', prefix: 'pl' },
  'padding-inline': { kind: 'space', prefix: 'px' },
  'padding-block': { kind: 'space', prefix: 'py' },
  margin: { kind: 'space', prefix: 'm' },
  'margin-top': { kind: 'space', prefix: 'mt' },
  'margin-right': { kind: 'space', prefix: 'mr' },
  'margin-bottom': { kind: 'space', prefix: 'mb' },
  'margin-left': { kind: 'space', prefix: 'ml' },
  'margin-inline': { kind: 'space', prefix: 'mx' },
  'margin-block': { kind: 'space', prefix: 'my' },
  width: { kind: 'space', prefix: 'w' },
  height: { kind: 'space', prefix: 'h' },
  'min-width': { kind: 'space', prefix: 'min-w' },
  'max-width': { kind: 'space', prefix: 'max-w' },
  'min-height': { kind: 'space', prefix: 'min-h' },
  'max-height': { kind: 'space', prefix: 'max-h' },
};

/** A token's Tailwind name: the custom property without its dashes, e.g. `brand` for `--brand`. */
export const tailwindTokenKey = (name: string): string => name.replace(/^--/, '');

/** Tokens Tailwind can name: those with a kind that has a theme namespace. */
export const tailwindTokens = (tokens: ThemeToken[]): ThemeToken[] => tokens.filter((t) => TAILWIND_NAMESPACE[t.kind]);

/** Keywords Tailwind's spacing and sizing utilities read as their own values. */
const SPACE_KEYWORDS = new Set(['auto', 'px', 'full', 'screen', 'min', 'max', 'fit', 'none', 'svw', 'lvw', 'dvw', 'svh', 'lvh', 'dvh', 'lh', 'dvi', 'svi', 'lvi']);
const SIZING = new Set(['w', 'h', 'min-w', 'max-w', 'min-h', 'max-h', 'size']);

/**
 * The theme utility for a declaration whose whole value is `var(--token)`, when the token's kind
 * fits the property: `bg-brand` for `background: var(--brand)`. Undefined otherwise.
 */
export function tailwindTokenClass(prop: string, value: string, kinds: ReadonlyMap<string, TokenKind>): string | undefined {
  const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value.trim());
  const use = Object.hasOwn(TOKEN_UTILITIES, prop) ? TOKEN_UTILITIES[prop] : undefined;
  if (!m || !use) return undefined;
  if (kinds.get(m[1]) !== use.kind || !TAILWIND_NAMESPACE[use.kind]) return undefined;
  // Tailwind's own keywords win over a token of that name (`max-w-lg` is 32rem, `w-screen` 100vw):
  // those take the arbitrary-value form instead.
  const key = tailwindTokenKey(m[1]);
  if (use.kind === 'space' && (SPACE_KEYWORDS.has(key) || (SIZING.has(use.prefix) && /^(\d?xs|sm|md|lg|\d?xl|prose)$/.test(key)))) return undefined;
  // Tailwind v3's `text-lg` sets the font size as well as a colour named `lg`.
  if (use.kind === 'color' && use.prefix === 'text' && /^(xs|sm|base|lg|\d?xl)$/.test(key)) return undefined;
  // `background` is a shorthand that also clears any background image; `bg-x` sets only the colour.
  return `${prop === 'background' ? 'bg-none ' : ''}${use.prefix}-${tailwindTokenKey(m[1])}`;
}

/** Tailwind v4: `@theme inline { --color-brand: var(--brand); }`. Empty when no token fits. */
export function tailwindThemeCss(tokens: ThemeToken[]): string {
  const lines = tailwindTokens(tokens).flatMap((t) => {
    const name = `--${TAILWIND_NAMESPACE[t.kind]!.v4}-${tailwindTokenKey(t.name)}`;
    // Tailwind's default sizes (`text-lg`) carry a line height too; a token's size doesn't.
    return name.startsWith('--text-') ? [`  ${name}: var(${t.name});`, `  ${name}--line-height: initial;`] : [`  ${name}: var(${t.name});`];
  });
  if (!lines.length) return '';
  return `/* Design tokens from Tree Weaver as Tailwind v4 theme values. Import after tailwindcss:\n   @import "tailwindcss"; @import "./tailwind.theme.css";\n   The values come from kits.css, so edit them there (or in the editor's Tokens tab). */\n@theme inline {\n${lines.join('\n')}\n}\n`;
}

/** Tailwind v3: a preset (`presets: [require('./tailwind.tokens.cjs')]`). Empty when no token fits. */
export function tailwindPreset(tokens: ThemeToken[]): string {
  const groups = new Map<string, string[]>();
  for (const t of tailwindTokens(tokens)) {
    const key = TAILWIND_NAMESPACE[t.kind]!.v3;
    groups.set(key, [...(groups.get(key) ?? []), `        ${JSON.stringify(tailwindTokenKey(t.name))}: ${JSON.stringify(`var(${t.name})`)},`]);
  }
  if (!groups.size) return '';
  const body = [...groups].map(([key, lines]) => `      ${key}: {\n${lines.join('\n')}\n      },`).join('\n');
  return `// Design tokens from Tree Weaver as a Tailwind v3 preset:\n//   module.exports = { presets: [require('./tailwind.tokens.cjs')], ... }\n// The values come from kits.css, so edit them there (or in the editor's Tokens tab).\nmodule.exports = {\n  theme: {\n    extend: {\n${body}\n    },\n  },\n};\n`;
}

/** `tokens.json`: the forest's tokens in the W3C Design Tokens format. Empty when there are none. */
export function tokensJson(kits: DesignKit[]): string {
  const tokens = themeTokens(kits);
  return tokens.length ? `${JSON.stringify(tokensToDtcg(tokens), null, 2)}\n` : '';
}
