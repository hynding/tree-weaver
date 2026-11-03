# Tree Weaver format guide

How to write Tree Weaver documents by hand or from code, for people and AI agents. The
canonical definition is the JSON Schema at
[`schema/tree-weaver-v1.schema.json`](../schema/tree-weaver-v1.schema.json), published at
<https://hynding.github.io/tree-weaver/schema/tree-weaver-v1.schema.json>.

## The model in one minute

| Term       | What it is                                                                      | JSON                                                |
| ---------- | ------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Forest** | A project: trees plus the design kits (CSS) they share.                         | `{ "name", "trees": [...], "kits": [...] }`         |
| **Tree**   | One layout: a page, a screen, a section. Its `root` always renders as `<body>`. | `{ "name", "root": { branch } }`                    |
| **Branch** | An HTML element with classes, attributes, per-display styles and children.      | `{ "tag", "classes", "attrs", "styles", "children" }` |
| **Leaf**   | Content: text, or an image whose `value` is its URL.                            | `{ "kind": "leaf", "type": "text" \| "image", "value" }` or a plain string |

Files wrap a forest or a tree in an envelope:

```json
{
  "$schema": "https://hynding.github.io/tree-weaver/schema/tree-weaver-v1.schema.json",
  "format": "tree-weaver",
  "version": 1,
  "tree": { "name": "Home", "root": { "tag": "body", "children": [] } },
  "kits": []
}
```

Use `"forest": { ... }` instead of `"tree"` for a whole project. A bare forest (`{ "trees": [...] }`),
bare tree (`{ "root": {...} }`) or bare branch (`{ "tag": "section", ... }`) is accepted too.
YAML files use the same structure.

## What you can leave out

The importer fills these in, so agents should normally omit them:

- every `id` (branches, leaves, trees, forests, kits, rules), and `createdAt` / `updatedAt`;
- `kind`: an object with `tag` or `children` is a branch, anything else is a leaf;
- `tag` (defaults to `div`), `classes`, `attrs`, `styles`, `children`;
- the leaf `type` (defaults to `text`).

A plain string in `children` is a text leaf: `{ "tag": "h1", "children": ["Welcome"] }`.

## Displays and the style cascade

`styles` holds CSS declarations per display. Keys are display ids; values are maps of
kebab-case CSS properties to string values.

| Id                 | Display          | Applies when (default sizes)                 | Inherits from     |
| ------------------ | ---------------- | -------------------------------------------- | ----------------- |
| `lg`               | Desktop large    | always (the base)                            | nothing           |
| `xl`               | Desktop XL       | `min-width: 1440px`                          | `lg`              |
| `tablet`           | Tablet           | `max-width: 1024px`                          | `lg`              |
| `mobile-landscape` | Mobile landscape | `max-width: 932px` and landscape             | `lg`, `tablet`    |
| `mobile-portrait`  | Mobile portrait  | `max-width: 600px` and portrait              | `lg`, `tablet`    |

Put shared styles on `lg` and only what changes on the others. A `tablet` override also
reaches both phone displays unless they override it again.

```json
"styles": {
  "lg": { "display": "grid", "grid-template-columns": "repeat(3, minmax(0, 1fr))", "gap": "24px" },
  "tablet": { "grid-template-columns": "repeat(2, minmax(0, 1fr))" },
  "mobile-portrait": { "grid-template-columns": "1fr" }
}
```

Rules for values: strings with units (`"16px"`, not `16`), one value per property, no `;` or braces.
Custom properties (`"--gap": "8px"`) and `var(--token)` work.

## Layout recipes

- **Grid:** `display: grid` plus `grid-template-columns` on `lg`, fewer columns on `tablet` and
  `mobile-portrait`. Children are the cells; span with `grid-column: span 2`.
- **Flex row:** `display: flex`, `gap`, `align-items`; switch to `flex-direction: column` on
  `mobile-portrait` to stack.
- **Table:** real markup: `table` > `thead` / `tbody` > `tr` > `th` / `td`, with text leaves in the cells.
- **Image:** a leaf, not an `img` branch:
  `{ "kind": "leaf", "type": "image", "value": "https://…/photo.jpg", "attrs": { "alt": "…" } }`.

See [`examples/`](../examples/) for complete files: a minimal tree, a responsive landing page
(navbar, hero, feature grid), a pricing table and a two-page forest with shared kits and custom classes.

## Design kits and classes

A forest's `kits` load in order; later kits override earlier ones. A kit is one of:

- inline CSS: `{ "name": "Brand", "css": ".card { padding: 1rem }" }`;
- a linked stylesheet: `{ "name": "Bootstrap", "href": "https://cdn.example.com/bootstrap.css" }`;
- editable rules (the editor's Classes tab):
  `{ "name": "Custom styles", "source": "custom", "rules": [{ "selector": ".btn:hover", "styles": { "lg": { … } } }] }`.

Prefer classes from the forest's kits over inline styles. `kitManifest(forest.kits)` from
`@tree-weaver/kits` lists every class and design token the kits offer.

## What is not allowed

These are dropped or changed on import, and the validator reports them as errors:

- tags `script`, `style`, `iframe`, `object`, `embed`, `frame`, `frameset`, `base`, `meta`, `link`
  (they render as `div`; put CSS in a kit);
- event-handler attributes (`onclick`, …), the `style` attribute (use `styles`) and `javascript:` URLs;
- unknown display ids, camelCase CSS properties, children on void elements such as `img` or `br`.

## Validating

```ts
import { validateDocument, formatIssues } from '@tree-weaver/core';
import { validateText } from '@tree-weaver/formats';

const result = validateText(jsonOrYamlText); // or validateDocument(parsedObject)
if (!result.valid) console.log(formatIssues(result));
// error tree.root.children[0].styles.desktop: Unknown display "desktop"; these styles are dropped. Fix: Use one of: lg, xl, tablet, mobile-landscape, mobile-portrait
```

Each issue has `severity`, `path`, `message` and usually a `hint`. Errors mean the document
would not import as written; warnings flag aliases, unknown fields, duplicate ids and images
without `alt`. Any JSON Schema validator (Ajv, `jsonschema` in Python, …) can check the schema too.

## Accepted aliases

The importer also reads these; the validator warns and suggests the canonical form:
`class` (string) for `classes`, `text` or `src` for a leaf's `value`, and `base` for the `lg` display.

## Other formats

The same tree also moves as XML (lossless), HTML (a standalone page that imports back) and
Markdown (readable content, layout in front matter). See the [README](../README.md#formats).
