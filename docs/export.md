# Exporting components

Tree Weaver can hand a tree to a codebase as source code: a **React**, **Vue** or **Svelte**
component, an **HTML page with separate CSS files**, or native code for apps: a **SwiftUI** view or a
**Flutter** widget. Use it when a layout built in the editor (or by an agent) should become part of
an app, rather than a standalone page.

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
| `swiftui` | `Home.swift`, one file with the styles built in (see [native apps](#native-apps-swiftui-and-flutter)) |
| `flutter` | `home.dart`, one file with the styles built in (see [native apps](#native-apps-swiftui-and-flutter)) |

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

## Native apps: SwiftUI and Flutter

`--framework swiftui` writes a SwiftUI `View` (iOS 16, iPadOS 16, macOS 13 or later);
`--framework flutter` writes a Flutter `StatelessWidget` (Flutter 3.27 or later). Each is one file
with the layout and its styles in it; `--styling` doesn't apply. The page scrolls vertically.

The tree is read into native building blocks rather than translated tag by tag:

| In the tree | SwiftUI | Flutter |
| --- | --- | --- |
| Branches (flex column, block) | `VStack` | `Flex` (vertical) |
| Flex rows | `HStack` (`Spacer` for `space-between`) | `Wrap`, or `Flex` with `Flexible` children |
| Grids (`repeat(3, …)`, `auto-fit`) | `LazyVGrid` | `_Grid`, a small helper written into the file |
| Headings, paragraphs, inline text | `Text` with `.largeTitle` … `.subheadline` | `Text` with the theme's `headlineLarge` … `titleSmall` |
| Links | `Link` (web, mail, phone) or `Button` | `TextButton` |
| Buttons | `Button` | `FilledButton` |
| Images | `AsyncImage` with the alt text as its accessibility label | `Image.network` with `semanticLabel` |
| Inputs, text areas | `TextField` | `TextField` |
| Lists, tables, `hr` | bulleted or numbered rows, `Grid`, `Divider` | rows, `Table`, `Divider` |

**Styles that carry over:** padding, gap, background, text colour, font size and weight, text
alignment, corner radius, border, width and height (in points: 1px = 1pt, 1rem = 16), opacity and
`margin: 0 auto` centring. Design kit rules on a single class (`.card { … }`) apply to branches with
that class, and `var(--token)` values are resolved from the kit's `:root`. Other selectors, web
fonts, shadows, transitions and positioning don't carry over.

**Displays become screen widths.** SwiftUI uses the desktop styles in a regular-width size class
(iPad full screen, Mac) and the mobile portrait styles in a compact one (iPhone). Flutter switches at
the tablet and mobile portrait breakpoints (`phone` and `tablet` booleans from the screen width), so
it has three layouts. What changes between displays changes in the app: a grid that goes from 3
columns to 1, a row that stacks into a column, padding and font sizes, and branches hidden with
`display: none` on some displays.

SVG trees and SVG branches become a placeholder comment: export the drawing as `.svg` and add it
to the app as an image asset. Links and buttons get empty actions to fill in.

### How the native output is checked

CI exports every example tree, every tree template and one tree holding every palette blueprint
(`node scripts/native-samples.mjs`, or `pnpm native:samples`), then builds the SwiftUI views as a
Swift package for macOS and the iOS Simulator (Xcode on a macOS runner), and runs `flutter analyze`
and a widget test that lays every Flutter sample out at desktop, tablet and phone widths with no
overflow or layout errors, on Flutter 3.27 and the current stable. Flutter 3.47 and later mark
`package:flutter/material.dart` as deprecated in favour of `package:material_ui`; the exports keep
the older import so they still build on 3.27, and the analyzer only reports it as info.

## Limits

- One tree per component. To export a forest, export each tree.
- The output is static markup (or static views). Wire up data, state and events in the app.
- Native exports are a starting point that looks like the layout, not a pixel-exact copy: check it in
  Xcode or with `flutter run`, then refine.
- Images keep their URLs; copy any images the app should host itself.
