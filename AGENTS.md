# AGENTS.md

Guidance for AI coding agents (and people) who work on Tree Weaver or build Tree Weaver
data into another project. For the data format itself, read [`docs/format.md`](docs/format.md)
and the JSON Schema in [`schema/`](schema/).

## Vocabulary

Use these words in code, UI text, docs and commit messages:

| Word       | Means       | Type in code                |
| ---------- | ----------- | --------------------------- |
| forest     | project     | `Forest`                    |
| tree       | layout      | `Tree`                      |
| branch     | component   | `Branch`                    |
| leaf       | content: text, an image or an SVG shape | `Leaf` (`type: 'shape'` for SVG shapes) |
| design kit | stylesheet  | `DesignKit`                 |
| display    | screen size | `DisplayId` (`lg` is the base) |

## Generating Tree Weaver data

1. Write the JSON envelope: `{ "format": "tree-weaver", "version": 1, "tree": { "name": "...", "root": { "tag": "body", "children": [...] } } }`.
2. Leave out ids and timestamps. Use plain strings for text. Use image leaves, not `img` branches.
   For SVG, use an `svg` branch (or `"tag": "svg"` on the root for a drawing), `g`/`text`/`defs`
   branches, and shape leaves (`{ "type": "shape", "value": "path", "attrs": { "d": "..." } }`).
3. Put base styles on `lg`, and only overrides on `tablet`, `mobile-portrait` and the rest.
4. Prefer the forest's kit classes over inline styles. `kitManifest(kits)` (`@tree-weaver/kits`) lists them.
5. Validate before handing the file on, and fix every error the validator reports:

   ```ts
   import { validateText } from '@tree-weaver/formats';
   import { formatIssues } from '@tree-weaver/core';
   const result = validateText(text);
   if (!result.valid) throw new Error(formatIssues(result));
   ```

   From a shell: `npx tree-weaver validate file.json` (add `--json` for a report).
   Without the packages, validate against `schema/tree-weaver-v1.schema.json` with any
   draft 2020-12 validator.

6. To save tokens, write the [shorthand](docs/shorthand.md) (`"h2: Title"`, `{ "grid": 3, "children": [...] }`,
   `"@card"`) and run `npx tree-weaver expand page.short.yaml -o page.tree.json`.
7. To change an existing tree, send a [patch](docs/patch.md) instead of rewriting it:
   `npx tree-weaver patch page.tree.json edits.json`, with operations such as
   `{ "op": "setStyles", "target": "/1", "styles": { "padding": "2rem" } }`.
8. Open the file in the [live editor](https://hynding.github.io/tree-weaver/) with Upload, or
   render it in code with `exportTree(tree, 'html', kits)` from `@tree-weaver/formats`.

Working examples are in [`examples/`](examples/); a test keeps them valid.

## Using the CLI

The `tree-weaver` package has a CLI for agents with a shell. Full guide: [`docs/cli.md`](docs/cli.md).

```sh
npx tree-weaver new home.tree.json --template landing   # start from a template
npx tree-weaver outline home.tree.json                  # paths (/2/0/1) and ids of every node
npx tree-weaver add home.tree.json card --parent /2/0/1 # or --node '{"tag":"p","children":["Hi"]}'
npx tree-weaver patch home.tree.json --ops '[{"op":"setText","target":"/1/0","value":"Hi"}]'
npx tree-weaver validate home.tree.json                 # exits 1 with path + fix hint per error
npx tree-weaver render home.tree.json -o home.html
```

`expand` turns shorthand into a full document, `convert` moves between JSON, YAML, XML, HTML, Markdown and SVG, `kit` lists a stylesheet's
classes and tokens, and `schema` prints the JSON Schema. Every command takes `--json`.

## Using the packages

`npm i tree-weaver` installs the CLI and every library; import from `tree-weaver` or its subpaths
(`tree-weaver/core`, `/formats`, `/kits`, `/branches`, `/storage`). Each library is also published
on its own as `@tree-weaver/core`, `@tree-weaver/formats`, `@tree-weaver/kits`,
`@tree-weaver/branches` and `@tree-weaver/storage`. They are ESM only and run in plain Node 20+,
bundlers and browsers. In this workspace, import them by name.

Useful entry points:

- `@tree-weaver/core`: `createForest`, `createTree`, `createBranch`, `createLeaf`; immutable ops
  `insertNode`, `moveNode`, `removeNode`, `setStyles`, `wrapNode`; patches `applyPatch`,
  `resolveRef`, `TREE_WEAVER_PATCH_SCHEMA`; `normalizeForest` /
  `normalizeTree` (lenient); `validateDocument` (strict); `renderDocument`; `TREE_WEAVER_SCHEMA`.
- `@tree-weaver/formats`: `importDocument(text, format?)`, `exportTree`, `exportForest`,
  `validateText`, `exportStorybook`.
- `@tree-weaver/branches`: ready-made blueprints (`BLUEPRINTS`, `responsiveGrid`, `flexRow`,
  `card`, …), tree templates (`TEMPLATES`) and the shorthand (`expandShorthand`,
  `expandShorthandDocument`).
- `@tree-weaver/kits`: `analyzeKit`, `kitManifest`, `createStarterKit`.

## Working in this repository

- Requires Node 20+ and pnpm 10. `pnpm install`, then:
  - `pnpm test`: Vitest for every package (`packages/*/src/**/*.test.ts`);
  - `pnpm typecheck`;
  - `pnpm build`: packages, then the Stencil app into `apps/web/www`;
  - `pnpm dev`: the editor at http://localhost:3333;
  - `pnpm schema`: rewrite the files in `schema/` after changing `packages/core/src/schema.ts` or the
    patch schema in `packages/core/src/patch.ts`.
- Layout: `apps/web` is the Stencil editor; `packages/cli` the `tree-weaver` CLI and umbrella package; `packages/core` the model, ops, rendering, schema and
  validation; `packages/formats` import and export; `packages/kits` design kits;
  `packages/branches` the palette and templates; `packages/storage` IndexedDB / localStorage.
- Packages are DOM-free TypeScript. Keep it that way so they run in Node and in agents' tools.
- Model changes touch three places that must agree: the types in `core/src/model.ts`,
  `normalize.ts` (lenient import) and `schema.ts` + `validate.ts` (strict contract). Update all
  of them, run `pnpm schema`, and add an example or test when the format grows.
- Anything rendered from a tree passes through `safeTag`, `isSafeAttr` and `sanitizeCssValue`
  in `core/src/render.ts`. Don't add a path around them.
- Package sources use extensionless relative imports; `scripts/esm-extensions.mjs` adds `.js` to the
  built output so it runs in plain Node. `pnpm smoke` packs every package, installs the tarballs in
  an empty project and runs the libraries and the CLI there.
- The CLI lives in `packages/cli` (published as `tree-weaver`); `run(argv, io)` in `src/run.ts`
  takes an injectable file system, which the tests use. Keep `docs/cli.md` in step with it.
- Releases: `pnpm release:version x.y.z` sets every package's version, then a GitHub release tagged
  `vx.y.z` runs `.github/workflows/publish.yml`, which publishes to npm (needs the `NPM_TOKEN` secret).
- CI (`.github/workflows/ci.yml`) runs `pnpm build`, `pnpm test` and `pnpm smoke`. Every push to `main`
  deploys the editor to GitHub Pages, including `llms.txt`, the schema, the docs and the examples.
