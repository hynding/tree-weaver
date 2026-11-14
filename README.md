# Tree Weaver

Tree Weaver is a visual builder for web layouts, in the spirit of GrapesJS. You weave **trees** of
**branches** and **leaves** into pages, tune them for every display type, style them with your own
design kits, and move them in and out as HTML, XML, JSON, YAML or Markdown. Everything saves
locally in your browser.

## Vocabulary

| Term       | Meaning                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------- |
| **Forest** | A project. Holds trees and the design kits they share.                                    |
| **Tree**   | One layout: a page, a screen, a reusable section, or an SVG drawing.                      |
| **Branch** | A component: an element with a tag, classes, attributes, per-display styles and children. |
| **Leaf**   | Content hanging off a branch: text, an image, or an SVG shape.                            |

The same words are used in the code (`Forest`, `Tree`, `Branch`, `Leaf`) and in the UI.

**Try it:** https://hynding.github.io/tree-weaver/ (deployed from `main` by `.github/workflows/pages.yml`).

## What you can do

- **Build layouts** by clicking or dragging branches from the palette onto the canvas or the outline:
  sections, containers, responsive grids (2/3/4 columns, sidebar layouts), flex rows and columns, tables,
  headings, paragraphs, lists, links, buttons, images, figures, cards, a navbar, a hero, a feature grid.
- **Draw SVG** the same way: plant an _SVG drawing_ tree (its root is an `<svg>`), or drop an SVG canvas
  into any page. Groups, text and gradients are branches; rectangles, circles, ellipses, lines, polylines,
  polygons and paths are shape leaves with their geometry and paint in the inspector. Fill, stroke,
  opacity and transform on a group are styles, so they can change per display. Shapes can only go
  inside an SVG, and HTML can't be dropped into one.
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
- **Upload and download tree data** as JSON, YAML, XML, HTML, Markdown or SVG (see below).
- **Download a Storybook project** for a tree or the whole forest, or **import stories from a built
  Storybook** as palette branches or trees (see [Storybook](#storybook)).
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
| SVG      | one drawing      | A standalone `.svg` of an SVG tree (or a page's first `<svg>`), with kits and responsive styles inside. Imports back as an SVG tree; SVG files from other tools import too, without scripts, animation or editor metadata. |

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

#### Importing from a Storybook

Upload → **Import from Storybook…** (also at the bottom of the Branches tab) reads a built Storybook
(`storybook build`, the `storybook-static` folder) from Storybook 6 to 10. Point it at a URL on the
same site as Tree Weaver, or upload the folder or a zip of it. Pick stories from the list (grouped by
component, with search), then choose:

- **Bring in as** palette branches, new trees (one per component, a section per story), or both.
  Palette branches are kept in this browser under _From Storybook_ and work in every forest; using
  one adds the design kits it needs to the forest.
- **Stylesheets:** link the Storybook's CSS files as linked kits, or copy their CSS. Styles injected
  at runtime (CSS-in-JS) are collected into one _runtime styles_ kit. Storybook's own preview styles
  are left out.
- Optionally, use the Storybook's **viewport** sizes for the display types (in this browser).

Each story is rendered in a hidden frame and imported as a **static snapshot**: its markup, styles
and text (string args name the branches that show them). Interactive behavior (state, event
handlers, data loading) does not come along, components that need a click or a portal to show
content come in as first rendered, and CSS-in-JS class names are the generated ones. Stories that
fail to render are listed and skipped.

Reading a rendered story needs it on Tree Weaver's own origin:

- **Upload** works for any Storybook. The files stay in this browser (IndexedDB) and a small service
  worker (`storybook-sw.js`) serves them at `<app>/__storybook__/<name>/`. Uploaded Storybooks run
  their own scripts on Tree Weaver's origin, so only upload Storybooks you trust. Uploaded CSS is
  always copied, since the files are only served in this browser.
- **A URL on the same site**, e.g. a Storybook published next to Tree Weaver on GitHub Pages.
- **A URL on another site** can't be rendered; Tree Weaver offers to link its stylesheets as kits
  instead (when that site allows cross-origin requests).

## Deployment settings

These environment variables are read when the app is built (`pnpm build`), so changing one needs a
rebuild. The GitHub Pages workflow passes them from repository variables of the same name
(Settings → Secrets and variables → Actions → Variables).

| Variable              | Effect                                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TW_CSS_URLS`         | Stylesheet URLs, separated by commas, spaces or new lines. Every forest loads them first, in the given order, before its own kits. They are listed under _Always loaded first_ in the Kits tab, can't be removed or reordered there, are not saved into forests, and are linked first in HTML exports. |
| `TW_DISABLE_CSS_URLS` | `true` (or `1`, `yes`, `on`) hides the field for linking stylesheet URLs in the Kits tab. Stylesheets from `TW_CSS_URLS`, and linked kits a forest already has, still load.                             |
| `TW_DISPLAYS`         | Display sizes and breakpoints, as `display.field=pixels` pairs separated by commas (or JSON, see below). Values set here apply to everyone and are locked in **Display settings**; the rest can still be changed there. |
| `TW_LOCK_DISPLAYS`    | `true` (or `1`, `yes`, `on`) locks every display setting in the app, so only the defaults and `TW_DISPLAYS` apply.                                                                                          |
| `TW_STORYBOOK_URLS`   | Built Storybook URLs, separated by spaces, offered in the Storybook import. Those on the same site as Tree Weaver are also read into the palette as _From Storybook_ libraries on first start (then kept, with a refresh button). |
| `TW_STORYBOOK_INCLUDE` | Title globs, separated by commas or new lines, that limit which stories show up, e.g. `Components/**, Patterns/Card`. `*` matches within one level, `**` across levels. |
| `TW_DISABLE_STORYBOOK_IMPORT` | `true` (or `1`, `yes`, `on`) hides the Storybook import. Libraries already in a browser's palette stay. |

```sh
TW_CSS_URLS="https://cdn.example.com/reset.css,https://cdn.example.com/theme.css" TW_DISABLE_CSS_URLS=true pnpm build
```

### Display sizes and breakpoints

Each display type has a preview **width** and **height** (the canvas and preview size) and, apart
from the base display, a **breakpoint**: the screen width its styles start to apply at in exported
CSS (`min-width` for Desktop XL, `max-width` for the others).

| Display (`id`)                        | Width × height | Breakpoint | Media query                                      |
| ------------------------------------- | -------------- | ---------- | ------------------------------------------------ |
| Desktop large (`lg`, base)            | 1280 × 800     | none       | none, applies everywhere                         |
| Desktop XL (`xl`)                     | 1920 × 1080    | 1440       | `(min-width: 1440px)`                            |
| Tablet (`tablet`)                     | 820 × 1180     | 1024       | `(max-width: 1024px)`                            |
| Mobile landscape (`mobile-landscape`) | 844 × 390      | 932        | `(max-width: 932px) and (orientation: landscape)` |
| Mobile portrait (`mobile-portrait`)   | 390 × 844      | 600        | `(max-width: 600px) and (orientation: portrait)`  |

There are two ways to change them:

1. **In the app:** the gear at the end of the display buttons (or the size label above the canvas)
   opens **Display settings**. Changes are saved in that browser only.
2. **With `TW_DISPLAYS` at build time:** fixes values for everyone using the deployment and locks
   them in the app. Display settings shows the exact `TW_DISPLAYS` value for whatever you've set
   there, ready to copy.

Fields are `width`, `height`, `size` (`WIDTHxHEIGHT`) and `breakpoint`, in whole CSS pixels from
100 to 10000. Anything not understood is skipped, and Display settings lists what was skipped.

```sh
TW_DISPLAYS="xl.breakpoint=1600,tablet.size=768x1024,mobile-portrait.width=375" pnpm build
# or as JSON
TW_DISPLAYS='{"tablet":{"width":768,"height":1024,"breakpoint":900}}' pnpm build
```

Changing a breakpoint changes the media queries in exports and in custom classes' CSS. Imported
HTML and CSS written with the default breakpoints still maps back to the right display.

## For AI agents and tools

Tree Weaver data is plain JSON (or YAML) with a published contract, so agents can write it directly:

- **Embedding and links** ([`docs/embed.md`](docs/embed.md)): a `<tree-weaver-editor>` element for other apps, and editor links
  that open a document (`?src=<url>`, or `#doc=` from `npx tree-weaver link file.json`).
- The **`tree-weaver` CLI** ([`docs/cli.md`](docs/cli.md)): `npx tree-weaver new | validate | render | convert | add | patch | expand | outline | kit | schema`,
  with `--json` reports. `npm i tree-weaver` also installs every library (`@tree-weaver/core`, `formats`, `kits`, `branches`, `storage`).

- [`docs/format.md`](docs/format.md): the format guide, with the display cascade and layout recipes.
- [`docs/shorthand.md`](docs/shorthand.md): a compact authoring form (`"h2: Title"`, `{ "grid": 3, ... }`, `"@card"`)
  that `tree-weaver expand` turns into full documents.
- [`docs/patch.md`](docs/patch.md): patches, lists of edits (`insert`, `move`, `setStyles`, …) applied with
  `tree-weaver patch` or `applyPatch`, all or nothing.
- [`schema/tree-weaver-v1.schema.json`](schema/tree-weaver-v1.schema.json): the JSON Schema (draft 2020-12),
  also served at https://hynding.github.io/tree-weaver/schema/tree-weaver-v1.schema.json. JSON exports name it in `$schema`.
- `validateDocument` (`@tree-weaver/core`) and `validateText` (`@tree-weaver/formats`): strict checks that report
  each problem with its path and a fix hint. The importer stays lenient; the validator tells you what it would drop.
- `kitManifest` (`@tree-weaver/kits`): every class and design token a forest's kits offer, as JSON.
- [`AGENTS.md`](AGENTS.md) and [`llms.txt`](llms.txt) (also at https://hynding.github.io/tree-weaver/llms.txt), plus
  working files in [`examples/`](examples/).

## Workspace layout

```
apps/
  web/                 Stencil editor app (@tree-weaver/web)
packages/
  cli/                 The `tree-weaver` CLI, and one package that re-exports every library
  embed/               The <tree-weaver-editor> element (@tree-weaver/embed), also served as /embed.js
  core/                Tree model, immutable operations, displays, CSS/HTML rendering, validation
  formats/             JSON, YAML, XML, HTML, Markdown and SVG import/export, Storybook export and import
  storage/             IndexedDB / localStorage / memory forest stores and preferences
  kits/                Design kit analysis (classes, tokens, imports) and the starter kit
  branches/            The branch library (palette blueprints) and tree templates
```

The packages are plain TypeScript with no DOM dependency, so they can run in Node as well as the browser.
They are published to npm as `tree-weaver` and `@tree-weaver/*` (see Releasing).

## Development

Requires Node 20+ and pnpm 10.

```sh
pnpm install
pnpm dev          # builds the packages, then serves the editor at http://localhost:3333
pnpm build        # builds every package and the app (apps/web/www)
pnpm test         # unit tests for the packages (Vitest)
pnpm typecheck
pnpm smoke        # packs the packages, installs them in an empty project and runs them in plain Node
```

The app uses relative asset paths, so the built `apps/web/www` folder works from any subpath, including GitHub Pages.

### Releasing to npm

1. Once: create the `tree-weaver` organization on npmjs.com (for the `@tree-weaver/*` packages) and add
   an npm automation or granular publish token as the repository secret `NPM_TOKEN`.
2. `pnpm release:version 0.2.0` to set every package's version, and merge that.
3. Publish a GitHub release tagged `v0.2.0`. `.github/workflows/publish.yml` builds, tests, runs the
   smoke test and publishes with provenance. Run it by hand from the Actions tab for a dry run.

## Defaults chosen

- **Local save** uses IndexedDB, with `localStorage` and then memory as fallbacks.
- **Display types** are desktop large (1280, base), desktop XL (≥1440px), tablet (≤1024px), mobile
  landscape (≤932px, landscape) and mobile portrait (≤600px, portrait). Generated CSS targets
  branches with `[data-tw="<id>"]` selectors.
- **Forest imports** open as a new forest (with a fresh id if it would clash); tree imports join the
  current forest.
