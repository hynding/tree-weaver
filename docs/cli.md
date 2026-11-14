# The `tree-weaver` CLI

`tree-weaver` creates, checks, edits and renders Tree Weaver forests and trees from a shell.
It is built for AI agents as much as people: every command reads and writes plain files,
takes `-` for stdin, and has a `--json` report for scripts.

```sh
npx tree-weaver --help             # no install
npm i -D tree-weaver               # or add it to a project (also installs the libraries)
```

Requires Node 20 or later.

## A typical agent loop

```sh
tree-weaver new home.tree.json --template landing --name "Home"   # start from a template
tree-weaver outline home.tree.json                                # see paths and ids
tree-weaver add home.tree.json card --parent /2/0/1               # insert a library branch
tree-weaver add home.tree.json --node '"p.muted: Fine print"'    # shorthand, or full JSON
tree-weaver patch home.tree.json edits.json                       # several edits, all or nothing
tree-weaver validate home.tree.json                               # strict check, exits 1 on errors
tree-weaver lint home.tree.json --render                          # layout and accessibility, per display
tree-weaver render home.tree.json -o home.html                    # standalone HTML page
tree-weaver export home.tree.json -f react -o src/components/     # or a component for an app
```

Or write the JSON yourself (see the [format guide](format.md)) and run `validate` until it passes,
or write it in the [shorthand](shorthand.md) and run `expand`.

## Commands

| Command | What it does |
| --- | --- |
| `new [file]` | Start a tree from a template (`--template`, `--list`), with the Weaver Basic starter kit unless `--bare`. `--forest` writes a forest holding the tree. The format comes from the file extension, or `--format` (default JSON to stdout). |
| `validate <file...>` | Check documents against the contract. JSON and YAML are checked as written; HTML, XML, Markdown and SVG are imported first. Prints each problem with its path and a fix hint. `--strict` fails on warnings too. Exits 1 when any file has errors. |
| `render <file>` | Write a standalone HTML page with the kits and the responsive CSS inlined. `--kit style.css` adds design kits (repeatable). |
| `lint <file>` | Check trees for layout and accessibility problems: alt text, heading order, link and form labels, duplicate ids, empty branches, fixed widths and contrast, each with a path, its displays and a fix. `--render` also renders every display in Chromium (needs Playwright) for sideways overflow, contrast with kits applied and broken images; `-d` picks displays. Exits 1 on errors, or on warnings with `--strict`. See [layout checks](checks.md). |
| `export <file>` | Write a tree as source code for an app: `--framework react` (default), `vue`, `svelte` or `html`, with `--styling css` (a stylesheet with readable class names, the default) or `tailwind` (utility classes, displays as responsive variants). `-o <dir>` writes the files there; otherwise they are printed. `--ts` writes `.tsx`, `--name` names the component. See [exporting components](export.md). |
| `convert <file>` | Convert between `json`, `yaml`, `xml`, `html`, `markdown` and `svg` (`--to`, or the extension of `-o`). Forests stay forests in JSON, YAML and XML; other formats take one tree. |
| `add <file> <blueprint>` | Insert a ready-made branch (`--list` shows them: `grid-3`, `card`, `hero`, `table`, `svg-badge`, …) or any branch or leaf as JSON or [shorthand](shorthand.md) (`--node`). `--parent` takes an id or a path, `--index` a position (negative counts from the end: `--index=-1`). The file is rewritten in its own format unless `-o` is given. |
| `patch <file> [patch]` | Apply a [patch](patch.md): a JSON or YAML list of operations (`insert`, `replace`, `remove`, `move`, `duplicate`, `wrap`, `update`, `setStyles`, `setText`) naming nodes by id or path. All or nothing. `--ops` takes the patch inline, `--dry-run` prints the result instead of writing it, and `--json` reports the id and final path of each change. |
| `expand <file>` | Expand the [authoring shorthand](shorthand.md) in a JSON or YAML file (`"h2: Title"`, `{ "grid": 3, "children": [...] }`, `"@card"`) into a full document, check it and write it (`-o`, `--to`). |
| `outline <file>` | Print each tree as an indented list of branches and leaves with their path and id. `--json` gives the same as nested JSON. |
| `kit <file...>` | Print the classes, design tokens and media queries of `.css` files, or of a document's kits, as JSON. Use the classes instead of inventing inline styles. |
| `schema` | Print the JSON Schema (draft 2020-12) for documents, or with `--patch` for patches. |
| `link <file\|url>` | Print a link that opens the document in the editor: a file is packed into the link (`#doc=`, nothing is uploaded), a URL becomes `?src=`. `--editor` points at another deployment. See [embedding](embed.md). |

Aliases: `check` = `validate`, `ls` = `outline`, `html` = `render`, `component` = `export`, `init` / `create` = `new`.

## Common options

| Option | Meaning |
| --- | --- |
| `-o, --output <file>` | Write here instead of stdout. The extension picks the format. |
| `-t, --tree <ref>` | Pick a tree in a forest by id, name or 1-based number. Without it, commands use the first tree and say so on stderr. |
| `-F, --from <fmt>` | Input format, when the file extension doesn't say. |
| `--json` | Print a machine-readable report on stdout. Errors become `{ "ok": false, "error": "..." }`. |
| `-h, --help` | Help for the command. |

Commands that produce a document (`new`, `render`, `convert`, `add` on stdin) print it on stdout
when there is no output file; the `--json` report replaces the one-line summary only when the
document goes to a file.

## Paths and ids

`outline` shows every node's **path**: the child indexes from the root, such as `/2/0/1` (the second
child of the first child of the third child of the root). `/` is the root. Paths are stable as long
as the tree doesn't change above them; ids are stable for good. Files written without ids get fresh
ids each time they are read, so let `add` or `convert` write the file back once (`tree-weaver convert
page.json --to json -o page.json`) before referring to ids across commands.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success. |
| 1 | A document is invalid, or the command failed (missing file, unknown tree, a parent that can't hold children). |
| 2 | The command was called wrongly (unknown command or option, missing argument). |

## From code

The same package exports every library and the CLI runner:

```ts
import { createTree, insertNode, getBlueprint, exportTree, validateDocument } from 'tree-weaver';
import { run } from 'tree-weaver/cli';

const code = await run(['validate', 'home.tree.json', '--json']);
```

The libraries are also available on their own: `@tree-weaver/core`, `@tree-weaver/formats`,
`@tree-weaver/kits`, `@tree-weaver/branches` and `@tree-weaver/storage` (browser storage, also at
`tree-weaver/storage`).
