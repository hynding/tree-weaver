# @tree-weaver/embed

Embed the [Tree Weaver](https://github.com/hynding/tree-weaver) layout editor in any page with a
`<tree-weaver-editor>` element.

```html
<script type="module" src="https://hynding.github.io/tree-weaver/embed.js"></script>
<tree-weaver-editor src="/layouts/home.tree.json" style="height: 80vh"></tree-weaver-editor>
```

```js
import '@tree-weaver/embed';

const editor = document.querySelector('tree-weaver-editor');
editor.addEventListener('change', (e) => save(e.detail.forest));
await editor.load(myTree);
const json = await editor.getDocument({ format: 'json' });
```

Methods: `load`, `getDocument`, `getForest`, `setDisplay`, `selectTree`; events `ready`, `change`,
`error`. The editor runs in an iframe and keeps documents in memory only; it answers just the page
that embeds it. No dependencies.

Full guide, including the `postMessage` protocol for plain iframes: [docs/embed.md](https://github.com/hynding/tree-weaver/blob/main/docs/embed.md).
