# Design tokens

Design tokens are the named colours, spacing, radii and type settings a design system is built
from. In Tree Weaver they are the CSS custom properties your design kits set on `:root`:

```css
:root {
  --brand: #2f6f4f;
  --space-3: 1rem;
  --radius: 10px;
  --font-body: system-ui, sans-serif;
}
.card { background: var(--brand); padding: var(--space-3); border-radius: var(--radius); }
```

Every enabled kit's `:root` custom properties are tokens; a later kit's value wins, as in CSS.
Style branches and classes with `var(--name)` and the name travels with them: change a token
and the canvas and every export follow.

## Editing tokens

- **Editor:** the **Tokens** tab lists the forest's tokens grouped by kind (colour, spacing,
  type, other). Pick a colour, type a new value, change a token's kind, or add a token. An edited
  token shows its kit value; the undo button brings it back.
- **CLI:** `tree-weaver tokens page.json` lists them; `--set brand=#d9480f` sets one (the name
  without its leading dashes), `--kind hero=space` sets a kind, `--reset brand` drops an edit.
  The file is written back (saved as a version first) unless `-o` names another file.
- **MCP:** `list_tokens` and `set_tokens` (`tokens: [{ name, value, kind? }]`, `reset: [names]`).
- **Code:** `themeTokens(kits)`, `setToken(kits, { name, value })` and `resetToken(kits, name)`
  from `@tree-weaver/core`.

Edits never change an imported kit. They go into a **token kit** (source `tokens`, named
"Tokens"): a kit whose `tokens` list is its source and whose CSS is generated from it as
`:root { ... }`. It is created last, so its values win, and kits added later go in before it. In
JSON and YAML the kit keeps each token's kind and description; XML and HTML keep only the CSS,
and the tokens are read back from it.

```json
{ "name": "Tokens", "source": "tokens", "tokens": [{ "name": "--brand", "value": "#d9480f" }, { "name": "--hero-gap", "value": "4rem", "kind": "space" }] }
```

## Kinds

A token's kind decides how exports name it. It is inferred from the name and value and can be set
explicitly:

| Kind | Inferred from | Tailwind | SwiftUI / Flutter |
| --- | --- | --- | --- |
| `color` | a colour value | `bg-`, `text-`, `border-` (`--color-*`) | `Color` |
| `space` | a length | `p-`, `m-`, `gap-`, `w-` and friends (`--spacing-*`) | `CGFloat` / `double` |
| `radius` | `radius` in the name | `rounded-` (`--radius-*`) | `CGFloat` / `double` |
| `font-size` | `font-size`, `text-`, `fs-` in the name | `text-` (`--text-*`) | `CGFloat` / `double` |
| `font-family` | a font list | `font-` (`--font-*`) | not written |
| `font-weight` | `weight` in the name | `font-` (`--font-weight-*`) | not written |
| `line-height` | `line-height`, `leading` | `leading-` (`--leading-*`) | not written |
| `shadow` | `shadow` in the name | `shadow-` (`--shadow-*`) | not written |
| `other` | anything else | not written | not written |

## In exports

| Export | What carries the tokens |
| --- | --- |
| React, Vue, Svelte, HTML (CSS) | `kits.css` holds the kits and the token kit; the CSS keeps `var(--name)`. `tokens.json` lists every token in the [W3C Design Tokens](https://www.designtokens.org/) format. |
| Tailwind | A style that is exactly `var(--brand)` becomes the theme utility (`bg-brand`, `p-space-3`, `rounded-radius`) when the token's kind fits the property. `tailwind.theme.css` defines them for Tailwind v4 (`@theme inline`), `tailwind.tokens.cjs` as a v3 preset. Both point at `var(--name)`, so `kits.css` stays the one source of values. Plus `tokens.json`. |
| SwiftUI | `DesignTokens.swift`: `enum DesignTokens { static let brand = Color(...); static let space3: CGFloat = 16 }`. Styles that are exactly `var(--name)` use `DesignTokens.name`. |
| Flutter | `design_tokens.dart`: `abstract final class DesignTokens { static const brand = Color(0xFF2F6F4F); ... }`, imported by the widget when it uses one. |

`tree-weaver tokens page.json -f css|json|tailwind|tailwind-v3|swift|dart` prints any of these on
its own.

Only whole values are named: `padding: var(--space-3)` and `padding: var(--space-2) var(--space-3)`
(per side, natively) become token references; `margin: calc(var(--space-3) * 2)` is written as
its value. A token set on the branch or class itself (`--brand: red` in its styles) shadows the
kit token, so it is written as a value too.
