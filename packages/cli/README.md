# tree-weaver

Create, check, edit and render [Tree Weaver](https://github.com/hynding/tree-weaver) layouts from
a shell or from code. A **forest** (project) holds **trees** (layouts); a tree is made of
**branches** (elements) and **leaves** (text, images, SVG shapes), with styles per display type.

```sh
npx tree-weaver new home.tree.json --template landing
npx tree-weaver add home.tree.json grid-3 --parent /1
npx tree-weaver validate home.tree.json
npx tree-weaver render home.tree.json -o home.html
```

Commands: `new`, `validate`, `render`, `convert`, `add`, `outline`, `kit`, `schema`. Every one
takes `--help` and `--json`. Full guide: [docs/cli.md](https://github.com/hynding/tree-weaver/blob/main/docs/cli.md).

## As a library

This package also re-exports every Tree Weaver library:

```ts
import { createTree, insertNode, getBlueprint, exportTree, validateDocument } from 'tree-weaver';
```

Subpaths: `tree-weaver/core`, `tree-weaver/formats`, `tree-weaver/kits`, `tree-weaver/branches`,
`tree-weaver/storage` and `tree-weaver/cli` (`run(argv)`).

## For AI agents

- Format guide: https://github.com/hynding/tree-weaver/blob/main/docs/format.md
- JSON Schema: https://hynding.github.io/tree-weaver/schema/tree-weaver-v1.schema.json (also `tree-weaver schema`)
- llms.txt: https://hynding.github.io/tree-weaver/llms.txt
- Live editor (open any file with Upload): https://hynding.github.io/tree-weaver/
