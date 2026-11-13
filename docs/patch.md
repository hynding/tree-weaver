# Patches

A patch is a list of small, named edits to one tree. Agents edit far more often than they create,
and sending a patch is cheaper and safer than writing the whole tree again. A patch is applied in
order, all or nothing: if any operation fails, nothing changes and the error names the operation.

```sh
npx tree-weaver outline page.tree.json                  # find paths and ids
npx tree-weaver patch page.tree.json edits.json         # apply a patch file (JSON or YAML)
npx tree-weaver patch page.tree.json --ops '[{"op":"remove","target":"/3"}]'
npx tree-weaver patch page.tree.json edits.json --dry-run   # check it and print the result
```

From code: `applyPatch(tree.root, ops, { expandNode: expandShorthand })` (`@tree-weaver/core`, with
the shorthand from `@tree-weaver/branches`). It returns the new root, the ids and final paths of
what changed, and any validator warnings, and leaves the old tree alone.

A worked example is [`examples/landing-page.patch.json`](../examples/landing-page.patch.json), and the
JSON Schema is [`schema/tree-weaver-patch-v1.schema.json`](../schema/tree-weaver-patch-v1.schema.json)
(`tree-weaver schema --patch`).

## Naming nodes

`target` and `parent` take a node's **id**, or its **path**: child indexes from the root such as
`/2/0` (`/` is the root, the default `parent`). Each operation reads paths as the tree is at that
point in the patch, so an earlier insert or remove shifts the paths after it. Ids don't shift:
when a patch inserts a node and then works on it, give the node an `id` and use that.

## Operations

| Operation | Fields | What it does |
| --- | --- | --- |
| `insert` | `parent`, `index`, `node` | Adds `node` to `parent` at `index` (default: last; negative counts from the end, `-1` is last). |
| `replace` | `target`, `node` | Puts `node` in place of `target`. |
| `remove` | `target` | Removes `target` and everything in it. |
| `move` | `target`, `parent`, `index` | Moves `target` into `parent`, ending up at `index` (default: last). |
| `duplicate` | `target` | Copies `target`, with fresh ids, right after itself. |
| `wrap` | `target`, `node` | Wraps `target` in the new branch `node`. |
| `update` | `target`, `tag`, `name`, `type`, `classes`, `addClasses`, `removeClasses`, `attrs`, `value` | Changes a branch's fields, or a leaf's `value` and `attrs`. `classes` replaces the list; `null` in `attrs`, or for `name` and `type`, removes it. |
| `setStyles` | `target`, `styles`, `display` | Sets styles. Flat properties go on `display` (default `lg`); display keys hold their own: `{ "padding": "4rem 0", "tablet": { "padding": "2rem 0" } }`. `null` removes a property. |
| `setText` | `target`, `value` | Sets a text leaf, or makes `value` a branch's only content. |

`node` is a branch, a leaf or a string (a text leaf), in the canonical format or the
[shorthand](shorthand.md): `"h2: Pricing"`, `"@card"`, `{ "grid": 3, "children": [...] }`.

```json
[
  { "op": "insert", "parent": "/", "node": { "section": ["h2: Pricing"], "id": "pricing" } },
  { "op": "setStyles", "target": "pricing", "styles": { "padding": "4rem 0", "mobile-portrait": { "padding": "2rem 0" } } },
  { "op": "move", "target": "pricing", "parent": "/", "index": 2 },
  { "op": "update", "target": "/0", "addClasses": "sticky", "attrs": { "aria-label": "Site" } },
  { "op": "remove", "target": "/4" }
]
```

A patch can also be an object `{ "ops": [...] }` (with an optional `$schema`), or a single operation.

## Checks

Every new or changed node goes through the same strict checks as a whole document: no event
handlers or script URLs, styles under known displays, HTML kept out of SVG drawings and SVG shapes
kept inside them. A node that reuses an id already in the tree gets fresh ids. The root can't be
removed, moved, wrapped or given another tag.
