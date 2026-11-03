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
| leaf       | content     | `Leaf`                      |
| design kit | stylesheet  | `DesignKit`                 |
| display    | screen size | `DisplayId` (`lg` is the base) |

## Generating Tree Weaver data

1. Write the JSON envelope: `{ "format": "tree-weaver", "version": 1, "tree": { "name": "...", "root": { "tag": "body", "children": [...] } } }`.
2. Leave out ids and timestamps. Use plain strings for text. Use image leaves, not `img` branches.
3. Put base styles on `lg`, and only overrides on `tablet`, `mobile-portrait` and the rest.
4. Prefer the forest's kit classes over inline styles. `kitManifest(kits)` (`@tree-weaver/kits`) lists them.
5. Validate before handing the file on, and fix every error the validator reports:

   ```ts
   import { validateText } from '@tree-weaver/formats';
   import { formatIssues } from '@tree-weaver/core';
   const result = validateText(text);
   if (!result.valid) throw new Error(formatIssues(result));
   ```

   Without the packages, validate against `schema/tree-weaver-v1.schema.json` with any
   draft 2020-12 validator.

6. Open the file in the [live editor](https://hynding.github.io/tree-weaver/) with Upload, or
   render it in code with `exportTree(tree, 'html', kits)` from `@tree-weaver/formats`.

Working examples are in [`examples/`](examples/); a test keeps them valid.

## Using the packages

The packages are not on npm yet. In this workspace, import them by name
(`@tree-weaver/core`, `@tree-weaver/formats`, `@tree-weaver/kits`, `@tree-weaver/branches`,
`@tree-weaver/storage`). Their builds use extensionless ESM imports, so consume them through a
bundler or Vitest, not plain `node`.

Useful entry points:

- `@tree-weaver/core`: `createForest`, `createTree`, `createBranch`, `createLeaf`; immutable ops
  `insertNode`, `moveNode`, `removeNode`, `setStyles`, `wrapNode`; `normalizeForest` /
  `normalizeTree` (lenient); `validateDocument` (strict); `renderDocument`; `TREE_WEAVER_SCHEMA`.
- `@tree-weaver/formats`: `importDocument(text, format?)`, `exportTree`, `exportForest`,
  `validateText`, `exportStorybook`.
- `@tree-weaver/branches`: ready-made blueprints (`BLUEPRINTS`, `responsiveGrid`, `flexRow`,
  `card`, …) and tree templates (`TEMPLATES`).
- `@tree-weaver/kits`: `analyzeKit`, `kitManifest`, `createStarterKit`.

## Working in this repository

- Requires Node 20+ and pnpm 10. `pnpm install`, then:
  - `pnpm test`: Vitest for every package (`packages/*/src/**/*.test.ts`);
  - `pnpm typecheck`;
  - `pnpm build`: packages, then the Stencil app into `apps/web/www`;
  - `pnpm dev`: the editor at http://localhost:3333;
  - `pnpm schema`: rewrite `schema/tree-weaver-v1.schema.json` after changing `packages/core/src/schema.ts`.
- Layout: `apps/web` is the Stencil editor; `packages/core` the model, ops, rendering, schema and
  validation; `packages/formats` import and export; `packages/kits` design kits;
  `packages/branches` the palette and templates; `packages/storage` IndexedDB / localStorage.
- Packages are DOM-free TypeScript. Keep it that way so they run in Node and in agents' tools.
- Model changes touch three places that must agree: the types in `core/src/model.ts`,
  `normalize.ts` (lenient import) and `schema.ts` + `validate.ts` (strict contract). Update all
  of them, run `pnpm schema`, and add an example or test when the format grows.
- Anything rendered from a tree passes through `safeTag`, `isSafeAttr` and `sanitizeCssValue`
  in `core/src/render.ts`. Don't add a path around them.
- CI (`.github/workflows/ci.yml`) runs `pnpm build` and `pnpm test`. Every push to `main`
  deploys the editor to GitHub Pages, including `llms.txt`, the schema, the docs and the examples.
