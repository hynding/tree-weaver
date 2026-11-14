# Exporting components

Tree Weaver can hand a tree to a codebase as source code: a **React**, **Vue** or **Svelte**
component, or an **HTML page with separate CSS files**. Use it when a layout built in the editor (or
by an agent) should become part of an app, rather than a standalone page.

- **Editor:** Export → **Component**, then pick the framework and the styling. A single file
  downloads as is; several files download as a zip.
- **CLI:** `npx tree-weaver export home.tree.json --framework react -o src/components/`
- **MCP:** the `export_component` tool (`framework`, `styling`, `outputDir`).
- **Code:** `exportComponent(tree, { framework, styling, kits })` from `@tree-weaver/formats`.

## What you get

| Framework | Files |
| --- | --- |
| `react` | `Home.jsx` (or `Home.tsx` with `--ts`), `Home.css`, `kits.css` |
| `vue` | `Home.vue` (template plus a `<style>` block; `kits.css` linked with `<style src>`), `kits.css` |
| `svelte` | `Home.svelte` (markup plus a `<style>` block of `:global` rules; `kits.css` imported), `kits.css` |
| `html` | `index.html`, `base.css` (the editor's base styles), `Home.css`, `kits.css` |

`kits.css` holds the forest's enabled design kits: kits with CSS are copied in, and linked kits
(with a URL) become `@import url(...)`. It is left out when there are no kits. The deployment's own
stylesheets (`TW_CSS_URLS`) are not included; the app loads its own.

The component's name comes from the tree's name in PascalCase (`Landing page` → `LandingPage`), or
`--name`. A name that starts with a digit gets a `Layout` prefix.

The page's `<body>` becomes a wrapper `<div>` with a class named after the tree (`landing-page`),
so the app can place and style it. SVG trees keep their `<svg>` root. Nothing from the editor (ids,
`data-tw` attributes) is left in the output, and everything passes through the same sanitizer as the
HTML export: no scripts, event handlers or `javascript:` URLs.

## Styling: CSS or Tailwind

**CSS** (the default) writes a class for each branch that has styles, named after the tree and the
branch (`landing-page__hero`, `landing-page__card-2`), and a stylesheet with a rule per class and a
media query per display, in the same cascade as the editor (`lg` is the base, then `xl`, `tablet`,
`mobile-landscape`, `mobile-portrait`). The tree's own classes, such as kit classes, are kept as they
are. In Svelte the rules are `:global` so that kit classes and app overrides reach them.

**Tailwind** writes utility classes instead, with each display as a responsive variant taken from
its media query:

| Display | Variant |
| --- | --- |
| `lg` | none (the base) |
| `xl` | `min-[1440px]:` |
| `tablet` | `max-[1024px]:` |
| `mobile-landscape` | `max-[932px]:landscape:` |
| `mobile-portrait` | `max-[600px]:portrait:` |

Common keyword values map to named utilities (`display: flex` → `flex`, `text-align: center` →
`text-center`), single values to the matching utility with an arbitrary value (`gap: 1rem` →
`gap-[1rem]`), and everything else to an arbitrary property (`[grid-template-columns:repeat(3,minmax(0,1fr))]`).
This needs Tailwind CSS v3.4 or later (for `max-*` variants), or v4. Make sure Tailwind scans the
exported files. If the forest's display settings use other breakpoints, the variants follow them.

## Limits

- One tree per component. To export a forest, export each tree.
- The output is static markup. Wire up data, state and events in the app.
- Images keep their URLs; copy any images the app should host itself.
