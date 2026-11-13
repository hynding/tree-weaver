# Authoring shorthand

Full Tree Weaver JSON is explicit, which makes it long. The shorthand lets you (or an agent) describe
the same tree in a fraction of the text, and expands it into the canonical format through the branch
library. Canonical nodes pass through unchanged, so you can mix the two freely.

```sh
npx tree-weaver expand page.short.yaml -o page.tree.json     # expand, check and write
npx tree-weaver add page.tree.json --node '{"grid": 3, "children": ["@card", "@card", "@card"]}'
```

Patches take shorthand nodes too (see [patches](patch.md)). From code:
`expandShorthand(node)` and `expandShorthandDocument(doc)` from `@tree-weaver/branches`.

A complete page is in [`examples/landing-page.short.yaml`](../examples/landing-page.short.yaml).

## Strings

| Shorthand | Becomes |
| --- | --- |
| `"Plain text"` | a text leaf |
| `"h2: Pricing"` | `<h2>` holding the text "Pricing" |
| `"a.btn.btn-primary[href=/join]: Join"` | `<a class="btn btn-primary" href="/join">Join</a>` |
| `"section#pricing:"` | an empty `<section id="pricing">` (the colon is required) |
| `"img: https://…/dog.jpg \| A dog on a beach"` | an image leaf, with the alt text after ` \| ` |
| `"@card"` | the `card` branch from the library (`tree-weaver add --list` lists them) |
| `"\\h2: kept as text"` | a leading backslash keeps the rest as plain text |

The part before the colon is `tag.class.class#id[attr=value][attr="quoted value"]`, and only counts
when the tag is a known HTML or SVG element. So `"Price: $5"` and `"Note: read me"` stay text.

## Objects

Every object form also takes `id`, `name`, `type`, `classes` (or `class`), `attrs`, `styles`, and the
`href` and `alt` attributes.

| Shorthand | Becomes |
| --- | --- |
| `{ "h2": "Pricing" }` | `<h2>Pricing</h2>`. The value is the text, as written (not read as shorthand) |
| `{ "ul.plain": ["li: One", "li: Two"] }` | a `<ul class="plain">` with these children (a single object is one child) |
| `{ "a": "Docs", "href": "/docs" }` | a link |
| `{ "grid": 3, "children": [...] }` | a responsive grid: 3 columns, 2 on tablets, 1 on portrait phones |
| `{ "grid": "2fr 1fr", "children": [...] }` | a grid with these columns, 1 on portrait phones |
| `{ "row": [...] }` | a wrapping flex row that stacks on portrait phones |
| `{ "column": [...] }` | a flex column with a gap |
| `{ "section": [...], "name": "Features" }` | a section with a centered container holding the children |
| `{ "table": [["Plan", "Price"], ["Basic", "$5"]] }` | a table; the first row is the header unless `"header": false` |
| `{ "img": "https://…", "alt": "…" }` | an image leaf |
| `{ "use": "hero", "classes": ["dark"] }` | a library branch with changes on top; `children` replaces its children |

An object with `kind`, `tag` or `value` is a canonical branch or leaf. Its children may still be
shorthand.

## Styles

`styles` may be flat: properties outside a display key go on `lg`, the base display. camelCase
property names become kebab-case.

```json
{ "row": ["@button", "@button"], "styles": { "gap": "2rem", "tablet": { "gap": "1rem" } } }
```

## Documents

`expand` accepts an envelope (`{ "tree": { "name": ..., "root": ... } }`), a forest, a tree, or just a
list of nodes, which become the page body. A `root` written as a list is the body's children.

```yaml
tree:
  name: Home
  root:
    - "h1: Welcome"
    - grid: 2
      children: ["@card", "@card"]
```

Mistakes are reported with the path to the part that couldn't be read, for example
`Found "h2", "p"; a shorthand object names one element or layout (at root.children[0])`.
