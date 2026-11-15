# Reusable components

A component is a branch you save once in a forest and use as many times as you like. Each use
is an **instance** that stays linked: change the component and every instance follows. A
component has **props**, the parts each instance fills in (a title, a link, an image), and
**variants**, named style changes such as `compact` or `stacked` that an instance can pick per
display.

Components live in forests (`forest.components`). A single-tree document has none.

## Props

Props are placeholders in the template, written `{{name}}`:

| Where | Example | Inferred type |
| --- | --- | --- |
| Text leaf | `{{title}}` | `text` |
| Attribute value | `href="{{link}}"` | `url` for `href`, `image` for `src`, otherwise `text` |
| Image leaf URL | `{{image}}` | `image` |
| Class name | `card-{{tone}}` | `enum` |
| `data-show-if` | `data-show-if="badge"` | `boolean` |

A branch with `data-show-if="badge"` is shown only when the `badge` prop is set (any value but
empty, `false` or `0`); `data-show-if="!badge"` shows it only when it is not. The attribute is
removed from the output.

Props found in the template are added automatically. Each prop can also be declared with a
type, a default, a description and, for `enum`, its options:

```json
{ "name": "tone", "type": "enum", "default": "plain", "options": ["plain", "warm", "cool"] }
```

When you turn existing text into a placeholder (say `Hello` becomes `{{message}}`), the old text
becomes the prop's default, so instances keep looking the same.

## Variants

A variant is a set of style overrides for the template's branches, keyed by branch id, per
display, in the same shape as a branch's own `styles`:

```json
{
  "name": "stacked",
  "styles": { "b_root": { "lg": { "flex-direction": "column", "gap": "8px" } } }
}
```

An instance picks a variant per display. Displays without a pick inherit it as styles do, so
`{ "lg": "row", "mobile-portrait": "stacked" }` is `row` on desktops and tablets and `stacked`
on phones in portrait. When a narrower display switches to another variant (or back to the base
look, written `-`), whatever the wider variant set and the new one does not is undone.

## Instances

An instance is a branch with an `instance` field:

```json
{
  "id": "b_k2",
  "tag": "article",
  "instance": { "component": "c_card", "props": { "title": "Hello" }, "variants": { "lg": "compact" } },
  "children": ["…expanded template…"]
}
```

The instance's tag, classes, attributes, styles and children are the template expanded with
its props and variants. Expanded ids are `<instance id>~<template id>`, so they are stable and
unique. Tree Weaver re-expands every instance when a document is opened or imported and
whenever a component changes, so a stale copy is corrected and every renderer, check and export
reads plain branches. Edits made inside an instance are not kept: change its props or variants,
edit the component, or **detach** the instance to turn it into ordinary branches.

## In the editor

- **Save as component:** select a branch and use **Save as component** at the top of the
  Inspector (or **Save tree as component** with nothing selected). The branch becomes the first
  instance.
- **Insert:** components are listed at the top of the **Branches** tab. Click one to insert it at
  the selection, or drag it onto the canvas or the outline.
- **Instance settings:** with an instance selected, the Inspector shows its props, a variant per
  display, **Detach** and **Edit component**.
- **Edit a component:** **Edit component**, the pencil in the Branches tab, or the Components group
  of the tree picker opens the template on the canvas. Edit it like any tree; changes reach every
  instance. The banner above the Inspector holds the name, props and variants. Pick a variant under
  **Showing** to see it, and style changes you make then go into that variant only.

## CLI

```sh
tree-weaver components site.json                          # list components, props, variants
tree-weaver components site.json save b_card -n Card      # save a branch (id or outline path)
tree-weaver components site.json insert Card --parent /1 \
  --prop title=Hello --prop badge=true --variant mobile-portrait=stacked
tree-weaver export site.json --component Card -f react -o src/components
```

`save` and `insert` write the file back (saved as a version first) unless `-o` names another
file. `--variant name` without a display means `lg`.

## MCP

- `list_components`: props, variants and instance counts.
- `save_component`: `{ path, branch, name? }`.
- `insert_component`: `{ path, component, parent?, index?, props?, variants? }`.
- `export_component` with `component` exports a component instead of a tree.

## Exports

`export --component` (CLI), `export_component` with `component` (MCP) and **Export → Component**
in the editor (when a component is open) turn a component into code with its props:

- **React:** a function component with props and defaults (`title = "Card title"`), a TypeScript
  interface with `--typescript`, `{badge && (…)}` for `data-show-if`, and template literals for
  attributes and classes that mix text and props.
- **Vue:** `defineProps` with defaults, `:href="link"` bindings and `v-if`.
- **Svelte:** `export let` props and `{#if}` blocks.
- **Variants** (CSS styling) become a `variant` prop that works per display, as in the editor.
  Pass one variant for every display, or a pick per display that inherits like styles do (`-`
  is the base look):

  ```jsx
  <Card variant="compact" />
  <Card variant={{ lg: 'row', 'mobile-portrait': 'stacked' }} />
  ```

  ```vue
  <Card :variant="{ tablet: 'stacked', 'mobile-portrait': '-' }" />
  ```

  The component turns the prop into one modifier class per display on its root
  (`card--lg-row card--xl-row card--tablet-row card--mobile-landscape-row
  card--mobile-portrait-stacked`). The stylesheet holds, under each display's media query, what
  changes when that display shows a different variant from the display it inherits from, so
  switching at a breakpoint also undoes what the wider variant set. With `--typescript`, React
  exports type the prop (`CardVariant`, `CardDisplay`). Variant names become class-safe slugs; a
  variant named `base` is exported as `base-2`, because `base` is the modifier for no variant.
  `pnpm e2e:variants` renders exported components next to the editor at every display size and
  checks that they look the same.
- **Tailwind** styling keeps the props; variants are left out.
- **HTML, SwiftUI and Flutter** have no props: they export the component as it looks with its
  defaults.

Trees that contain instances need nothing special: every export reads the expanded branches.

## Code

From `@tree-weaver/core`: `createComponent(name, branch)`, `saveComponent(forest, treeId,
branchId, name)`, `instantiateComponent(def, props, variants)`, `syncInstances(forest)`,
`detachInstance(branch)`, `instancesOf(forest, id)` and `componentProps(def)`. From
`@tree-weaver/formats`: `exportComponentDef(def, { framework, styling })`.
