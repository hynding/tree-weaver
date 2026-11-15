# Template gallery

The template gallery starts a whole forest instead of a single tree. Each starter comes with:

- **A theme kit** of design tokens (`--color-brand`, `--space-4`, `--text-xl`, `--radius-md`,
  `--shadow-card` and the rest). Every style in the forest refers to them as `var(--token)`, so
  changing one in the **Tokens** tab restyles every tree, and edits can be reset back to the theme.
- **Components** with props and variants that switch per display. Instances pick a variant on the
  displays where the layout should change, such as compact stat tiles on phones or form fields with
  the label beside the input on desktops.
- **Two trees** built from both, checked at every display size (no sideways scrolling, heading order,
  labels and contrast).

| Starter | Trees | Components | What changes per display |
| --- | --- | --- | --- |
| `dashboard`: Analytics dashboard | Overview, Settings | Button, Stat tile, Form field | The sidebar becomes a top bar on tablets; stat tiles go 4, 2, 1 across and switch to `Compact` on portrait phones; settings fields are `Inline` on desktops and stacked from tablets down. |
| `landing`: Product landing page | Home, Pricing | Button, Feature card, Pricing card | The hero stacks and centers on tablets; feature cards switch to `Row` on portrait phones; the navigation links hide on portrait phones; the featured plan uses the `Featured` variant. |
| `form`: Sign-up and contact forms | Sign up, Contact | Form field, Button | The contact page goes from two columns to one on tablets, and its fields from `Inline` to stacked. |

## In the editor

**Forest → New forest** opens the gallery, with a live preview of each starter's first tree. Pick
one to plant it as a new forest in this browser, or **Start blank** for the usual landing page tree
with the Weaver Basic kit.

## CLI

```sh
tree-weaver new --list                                  # templates (trees) and starters (forests)
tree-weaver new --starter dashboard -o admin.forest.json
tree-weaver new --starter landing -n "Fernwood" -o site.yaml
```

Starters are forests, so they write JSON, YAML or XML.

## MCP

`create_tree` with `"starter": "dashboard"` (or `landing`, `form`) writes the forest, and
`catalog` with `kind: "starters"` (or the `tree-weaver://catalog/starters` resource) lists them.

## Code

`STARTERS` and `getStarter(id)` from `@tree-weaver/branches`. `getStarter('landing').create(name)`
returns a new forest with fresh ids each time.
