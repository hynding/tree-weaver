# @tree-weaver/collab

Live collaboration for [Tree Weaver](https://github.com/hynding/tree-weaver) forests: a forest as a
[Yjs](https://yjs.dev) document that merges concurrent edits per branch and per field.

```ts
import { writeForest, readForest, Y } from '@tree-weaver/collab';

const doc = new Y.Doc();
writeForest(doc, null, forest);   // load a forest (merges with what the document holds)
writeForest(doc, forest, edited); // write only what changed
const merged = readForest(doc);   // the same forest on every peer
```

Use it with any Yjs provider. See [docs/collaboration.md](https://github.com/hynding/tree-weaver/blob/main/docs/collaboration.md).
