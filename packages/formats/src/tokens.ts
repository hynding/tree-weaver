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

/**
 * The theme utility for a declaration whose whole value is `var(--token)`, when the token's kind
 * fits the property: `bg-brand` for `background: var(--brand)`. Undefined otherwise.
 */
export function tailwindTokenClass(prop: string, value: string, kinds: ReadonlyMap<string, TokenKind>): string | undefined {
  const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value.trim());
  const use = Object.hasOwn(TOKEN_UTILITIES, prop) ? TOKEN_UTILITIES[prop] : undefined;
  if (!m || !use) return undefined;
  return kinds.get(m[1]) === use.kind && TAILWIND_NAMESPACE[use.kind] ? `${use.prefix}-${tailwindTokenKey(m[1])}` : undefined;
}

/** Tailwind v4: `@theme inline { --color-brand: var(--brand); }`. Empty when no token fits. */
export function tailwindThemeCss(tokens: ThemeToken[]): string {
  const lines = tailwindTokens(tokens).map((t) => `  --${TAILWIND_NAMESPACE[t.kind]!.v4}-${tailwindTokenKey(t.name)}: var(${t.name});`);
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
