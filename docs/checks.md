# Layout checks

Tree Weaver can look over a tree the way a reviewer would: on every display, for the problems that
only show when you look. Each issue names a rule, the node (its path, such as `/2/0`, and its id),
the displays it shows on, and a fix.

- **CLI:** `npx tree-weaver lint page.tree.json` (tree only) or `--render` (also in Chromium).
- **MCP:** the `check_layout` tool. It renders when Playwright is installed, and checks the tree alone otherwise.
- **Code:** `checkTree(tree)` and `checkRendered(tree, { browser, kits, displays })` from `@tree-weaver/core`,
  with `formatCheckReport(report)` for text.

## Rules

| Rule | Severity | What it finds |
| --- | --- | --- |
| `image-alt` | error | An image leaf with no `alt`. Use `alt: ""` for images that are only decoration. |
| `link-name` | error | A link or button with no text, image alt, `aria-label` or `title`. |
| `duplicate-id` | error | The same `id` attribute on more than one element. |
| `link-href` | warning | An `<a>` without `href`, which can't be followed or focused. |
| `form-label` | warning | An `input`, `select` or `textarea` without a `<label for>`, a wrapping `<label>` or an `aria-label`. |
| `heading-order` | warning | A heading that skips a level (`<h1>` then `<h3>`). A first heading below `<h2>` is a note. |
| `single-h1` | warning | More than one `<h1>`. |
| `empty-branch` | warning | A branch with no children, styles, classes or attributes: it renders nothing. |
| `fixed-width` | warning | A `width` or `min-width` in pixels wider than a display, with no `max-width`. |
| `contrast` | warning | Text below WCAG AA contrast: 4.5:1, or 3:1 for large text (24px, or 18.66px bold). |
| `overflow` | warning | Rendered only: an element that reaches past the right edge, so the page scrolls sideways. |
| `image-broken` | warning | Rendered only: an image that did not load. |

Issues that come from one style inherited by several displays are reported once, with every display
they show on. SVG drawings are skipped, apart from duplicate ids.

## Tree only or rendered

`checkTree` reads the tree alone. It is fast and needs nothing installed, so it suits CI and every
edit an agent makes. It only knows about colors set in the tree, not in the design kits, and it
measures contrast only when both the text color and a background color are set.

`checkRendered` renders the page with its design kits at each display's size, in a browser you
pass in (a Playwright `Browser` works), with scripts off. It runs every tree-only check, and then:

- **Overflow.** For each element that sticks out past the screen's right edge, it reports the
  outermost one. When the element is an item in a grid or flex container whose tracks are too wide,
  it reports the container. Content inside a box that scrolls or clips (`overflow-x: auto`) doesn't
  count.
- **Contrast** with the computed colors, including the design kits and semi-transparent layers.
  Text on background images is skipped.
- **Images** that failed to load.

`--render` needs Playwright and a Chromium build:

```sh
npm i -D playwright && npx playwright install chromium
```

Or set `TW_CHROMIUM_PATH` to point at a Chrome binary.

## The CLI

```sh
tree-weaver lint page.tree.json                         # tree only; exits 1 on errors
tree-weaver lint page.tree.json --strict                # warnings fail too
tree-weaver lint page.tree.json --render                # every display, in Chromium
tree-weaver lint site.forest.json --render -d tablet,mobile-portrait --json
```

`--json` prints `{ ok, trees: [{ tree, ok, counts, issues, rendered }] }`. `rendered` lists each
display's size and the page's size, so `pageWidth > width` means the page scrolls sideways.
