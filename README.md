# Tree Weaver

Tree Weaver is a visual builder for web layouts, in the spirit of GrapesJS. You weave **trees** of
**branches** and **leaves** into pages, tune them for every display type, style them with your own
design kits, and move them in and out as HTML, XML, JSON, YAML or Markdown. Everything saves
locally in your browser.

## Vocabulary

| Term       | Meaning                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------- |
| **Forest** | A project. Holds trees and the design kits they share.                                    |
| **Tree**   | One layout: a page, a screen, a reusable section.                                         |
| **Branch** | A component: an element with a tag, classes, attributes, per-display styles and children. |
| **Leaf**   | Content hanging off a branch: text or an image.                                           |

The same words are used in the code (`Forest`, `Tree`, `Branch`, `Leaf`) and in the UI.

**Try it:** https://hynding.github.io/tree-weaver/ (deployed from `main` by `.github/workflows/pages.yml`).

## What you can do

- **Build layouts** by clicking or dragging branches from the palette onto the canvas or the outline:
  sections, containers, responsive grids (2/3/4 columns, sidebar layouts), flex rows and columns, tables,
  headings, paragraphs, lists, links, buttons, images, figures, cards, a navbar, a hero, a feature grid.
- **Edit in place**: select anything in the canvas, double-click text to rewrite it, drag branches in
  the canvas or outline to reorder or re-parent them, and undo or redo every change.
- **Tune every display**: desktop large (the base), desktop XL, tablet, mobile landscape and mobile
  portrait. Styles cascade: XL and tablet inherit desktop, both mobile displays inherit tablet. The
  inspector edits the current display and shows inherited values as placeholders.
- **Lay out with grids, flex and tables**: one-click equal columns, track templates, gaps and alignment;
  child placement inside a parent grid or flex; add or remove table rows and columns.
- **Import design kits (CSS)**: upload a `.css` file, link one or more stylesheet URLs or paste CSS. Kits
  apply across the forest, load top to bottom (later kits override earlier ones), can be toggled and
  moved up or down, and their classes are suggested in the inspector. Linked stylesheets load from their
  URL in their place in that order; their CSS is also fetched, when the server allows it, so their
  classes can be listed. A starter kit, _Weaver Basic_, comes with every new forest.
- **Write custom classes and selectors** in the _Classes_ tab: add a class (`.promo`) or any selector
  (`nav a:hover`), then set its declarations per display, just like branch styles (other displays
  inherit from desktop large). Custom rules live in an editable kit, _Custom styles_, which loads after
  your other kits, saves with the forest and travels with every export. Give the selected branch a class
  from the rule, or use _Save styles as class_ in the inspector to move a branch's styles into a new
  class. Rules can also be edited as CSS, and a pasted or uploaded kit can be turned into editable rules.
- **See where styles come from**: the inspector's _Matched styles_ section lists every rule that styles
  the selected branch or leaf on the current display, strongest first, with overridden values struck
  out and inherited rules grouped by ancestor. Each rule names its source: the kit (with line number,
  linking to the kit), a stylesheet it `@import`s, or the styles set in the inspector. Rules from a
  linked stylesheet can be read when its server allows CORS; others are listed as unreadable.
- **Preview without the editor**: _Preview_ in the toolbar shows a tree as it ships, with its kits,
  custom classes and responsive styles but no outlines, handles or panels. _Fit window_ sizes it to the
  window, so the display media queries follow the real width; or pick a display to see it at that size.
  Switch trees from the preview, and press Esc to go back. _New tab_ opens the tree as a standalone page
  in a browser tab, and _Forest in new tab_ opens a list of every tree linking to its page. New tabs are
  snapshots: open them again after more edits.
- **Upload and download tree data** as JSON, YAML, XML, HTML or Markdown (see below).
- **Download a Storybook project** for a tree or the whole forest (see [Storybook](#storybook)).
- **Save locally**: forests autosave to IndexedDB (falling back to `localStorage`), and you can keep
  several forests in one browser.

## Formats

| Format   | Holds            | Round trip                                                                                                          |
| -------- | ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| JSON     | tree or forest   | Lossless.                                                                                                           |
| YAML     | tree or forest   | Lossless.                                                                                                           |
| XML      | tree or forest   | Lossless (`<tree-weaver>` → `<forest>` → `<tree>` → `<branch>` / `<leaf>`).                                         |
| HTML     | one tree         | A standalone page with kits and responsive CSS inlined. Branch ids, names and every display's styles import back. |
| Markdown | one tree         | Readable content (headings, lists, tables, links, images, code). Layout branches and styles ride along in front matter and HTML comments, so they import back. |

Imports also accept HTML and Markdown that Tree Weaver did not write: elements become branches,
text and images become leaves, inline `style` attributes become desktop styles, and `<style>` /
`<link rel="stylesheet">` become design kits. Scripts and event handler attributes are dropped.

JSON and YAML files use an envelope:

```json
{ "format": "tree-weaver", "version": 1, "forest": { "name": "My site", "trees": [], "kits": [] } }
```

Bare forests (`{ "trees": [...] }`), bare trees (`{ "root": {...} }`) and bare branches are accepted too.

### Storybook

Download → **Storybook** writes a zipped Storybook project (`@storybook/html-vite`, no framework) for
the current tree or the whole forest. Each tree becomes a stories file with:

- a **Whole tree** story, plus one per display type (desktop large, desktop XL, tablet, mobile
  landscape, mobile portrait), and the display types in the viewport toolbar;
- a story for every **named branch**;
- every text and image leaf as an **arg**, editable from the Controls panel.

Enabled design kits load globally in `.storybook/preview.js`. Unzip, then `npm install` and
`npm run storybook`. The export is one way: change layouts in Tree Weaver and export again.

## Deployment settings

These environment variables are read when the app is built (`pnpm build`), so changing one needs a
rebuild. The GitHub Pages workflow passes them from repository variables of the same name
(Settings → Secrets and variables → Actions → Variables).

| Variable              | Effect                                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TW_CSS_URLS`         | Stylesheet URLs, separated by commas, spaces or new lines. Every forest loads them first, in the given order, before its own kits. They are listed under _Always loaded first_ in the Kits tab, can't be removed or reordered there, are not saved into forests, and are linked first in HTML exports. |
| `TW_DISABLE_CSS_URLS` | `true` (or `1`, `yes`, `on`) hides the field for linking stylesheet URLs in the Kits tab. Stylesheets from `TW_CSS_URLS`, and linked kits a forest already has, still load.                             |

```sh
TW_CSS_URLS="https://cdn.example.com/reset.css,https://cdn.example.com/theme.css" TW_DISABLE_CSS_URLS=true pnpm build
```

## Workspace layout

```
apps/
  web/                 Stencil editor app (@tree-weaver/web)
packages/
  core/                Tree model, immutable operations, displays, CSS/HTML rendering, validation
  formats/             JSON, YAML, XML, HTML and Markdown import/export, Storybook export
  storage/             IndexedDB / localStorage / memory forest stores and preferences
  kits/                Design kit analysis (classes, tokens, imports) and the starter kit
  branches/            The branch library (palette blueprints) and tree templates
```

The packages are plain TypeScript with no DOM dependency, so they can run in Node as well as the browser.

## Development

Requires Node 20+ and pnpm 10.

```sh
pnpm install
pnpm dev          # builds the packages, then serves the editor at http://localhost:3333
pnpm build        # builds every package and the app (apps/web/www)
pnpm test         # unit tests for the packages (Vitest)
pnpm typecheck
```

The app uses relative asset paths, so the built `apps/web/www` folder works from any subpath, including GitHub Pages.

## Defaults chosen

- **Local save** uses IndexedDB, with `localStorage` and then memory as fallbacks.
- **Display types** are desktop large (1280, base), desktop XL (≥1440px), tablet (≤1024px), mobile
  landscape (≤932px, landscape) and mobile portrait (≤600px, portrait). Generated CSS targets
  branches with `[data-tw="<id>"]` selectors.
- **Forest imports** open as a new forest (with a fresh id if it would clash); tree imports join the
  current forest.
