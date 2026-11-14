# Embedding the editor

Put the Tree Weaver editor inside your own app, hand people a link that opens a tree, or let an
agent pass a tree to a person to refine and then read it back.

## `<tree-weaver-editor>`

```html
<script type="module" src="https://hynding.github.io/tree-weaver/embed.js"></script>

<tree-weaver-editor id="editor" src="/layouts/home.tree.json" style="height: 80vh"></tree-weaver-editor>

<script type="module">
  const editor = document.getElementById('editor');
  editor.addEventListener('change', (e) => save(e.detail.forest)); // plain JSON, debounced
  await editor.ready;
  await editor.load({ tree: { name: 'Draft', root: { tag: 'body', children: ['h1: Hello'] } } });
  const html = await editor.getDocument({ format: 'html', scope: 'tree' });
</script>
```

Or from npm, for bundlers: `npm i @tree-weaver/embed`, then `import '@tree-weaver/embed'` (it registers
the element) or `import { TreeWeaverEditor, defineTreeWeaverEditor } from '@tree-weaver/embed'`.

| Attribute | Meaning |
| --- | --- |
| `src` | A document URL to open (JSON, YAML, XML, HTML, Markdown or SVG). The server must allow cross-origin requests from the editor. |
| `editor` | The editor's URL. Default: the hosted editor. Point it at your own deployment (`pnpm build`, then serve `apps/web/www`) to pin a version or set deployment options. |
| `title` | Accessible name of the editor frame. |

| Method / property | Does |
| --- | --- |
| `ready` | A promise that resolves when the editor can take calls. |
| `load(document, { format? })` | Open a forest or tree: an object, JSON text, or YAML, XML, HTML, Markdown or SVG text. Replaces what is open. Resolves to `{ kind, trees }`. |
| `getDocument({ format?, scope? })` | The forest (or `scope: 'tree'` for the open tree) as text in `format` (default `json`). HTML, Markdown and SVG always give the open tree. |
| `getForest()` | The forest as plain JSON. |
| `setDisplay(id)` | Show `lg`, `xl`, `tablet`, `mobile-landscape` or `mobile-portrait`. |
| `selectTree(idOrName)` | Open a tree of the forest. |
| `forest` | The latest forest from a `change` event. |

Events: `ready`, `change` (`detail: { forest, treeId }`), `error` (`detail: { message }`, when a call fails).
Calls reject with an `Error` whose message says what was wrong with the document.

The element sizes like a block (640px tall by default); set `height` in CSS.

## How it works

The element hosts the editor in an iframe, so the editor's styles, keyboard shortcuts and state
can't clash with your page, and talks to it with `postMessage`. With `?embed=1` in its URL the editor:

- keeps documents in memory only (nothing goes to the browser's storage; your page owns the data),
  and shows "Embedded" where it normally shows the save state;
- answers messages only from the page that frames it, and only from the origins in `?origin=`
  (the element sets this to your page's origin). Without `?origin=`, the first origin that writes to
  it is the only one it will answer;
- sends `change` events only to that origin. The one message sent before that is `ready`, which
  carries no document.

The plain editor (without `?embed=1`) ignores messages entirely, so a page that frames it can't read
someone's saved forests.

### Using an iframe directly

```html
<iframe id="tw" src="https://hynding.github.io/tree-weaver/?embed=1&origin=https://your.site"></iframe>
<script>
  const tw = document.getElementById('tw');
  addEventListener('message', (e) => {
    if (e.source !== tw.contentWindow || e.data?.source !== 'tree-weaver-editor') return;
    if (e.data.type === 'ready') tw.contentWindow.postMessage({ source: 'tree-weaver-host', id: '1', type: 'load', document: myTree }, '*');
    if (e.data.type === 'change') save(e.data.forest);
    if (e.data.type === 'response') console.log(e.data.id, e.data.ok ? e.data.result : e.data.error);
  });
</script>
```

Host messages: `{ source: 'tree-weaver-host', id?, type }` with `type` one of `load` (`document`,
`format?`), `getDocument` (`format?`, `scope?`), `setDisplay` (`display`), `selectTree` (`tree`) and
`ping`. Every message with an `id` gets a `response` with the same `id` and either `ok: true, result`
or `ok: false, error`. The TypeScript types are `HostMessage` and `EditorMessage` in `@tree-weaver/embed`.

## Links that open a document

The editor opens a document named in its URL, on its own or embedded:

| Link | Opens |
| --- | --- |
| `https://hynding.github.io/tree-weaver/?src=<url>` | The document at `<url>` (it must allow cross-origin requests). |
| `https://hynding.github.io/tree-weaver/#doc=<base64url>` | The document packed into the link itself; nothing is uploaded anywhere. |

In the plain editor, a forest opens as a new forest and a tree joins the open forest, as with Import,
and the link is removed from the address bar so a reload doesn't add it twice.

`tree-weaver link page.tree.json` prints a `#doc=` link for a file (and `tree-weaver link <url>` a
`?src=` one), so an agent can hand a person its work to look at and refine:

```sh
npx tree-weaver link home.tree.json
# https://hynding.github.io/tree-weaver/#doc=eyJmb3JtYXQiOiJ0cmVlLXdlYXZlciIs…
```

Links over about 32,000 characters may be cut by some apps; host the file and use `?src=` instead.

## Testing

`pnpm e2e:embed` serves the built editor and a host page on two origins and checks the element, the
links and the origin rules in Chromium (run `pnpm build` first; needs Playwright's Chromium, or
`TW_CHROMIUM_PATH` pointing at a Chrome binary).
