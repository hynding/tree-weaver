# Live collaboration

**Share** (in the toolbar) turns the open forest into a room and gives you a link. Everyone who opens
the link edits the same forest in real time:

- the toolbar shows who is here, and what each person has selected is outlined on your canvas in
  their colour (when they are on the same tree);
- changes merge per branch and per field: one person can restyle a card for tablet while another
  rewrites its text, and both changes stay. Each style property, attribute, class rule and token
  is a field of its own, so two people editing different ones of the same branch or kit both keep
  their edit. When two people change the same field, or move the same
  branch, at the same moment, the last change wins. A branch someone added inside a branch someone
  else deleted moves to the end of the tree instead of being lost;
- **Undo** takes back only your own changes. Other people's changes show in the **History** tab
  tagged *Collaborator*;
- each person keeps a copy of the forest in their own browser, so it stays theirs after the session.
  Reloading the link rejoins the room, even if nobody else is online, and catches up when they are.

**Stop sharing** leaves the room. The forest stays open and saved; others keep their copies.

## How it works without a server

Tree Weaver is a static site, so there is no Tree Weaver server to relay edits. Instead:

1. The forest is a [Yjs](https://yjs.dev) document (`@tree-weaver/collab`): every branch and leaf
   is its own entry with its parent and a sort key, rather than living inside its parent's list of
   children. That is what lets concurrent edits merge without duplicating or losing branches.
2. Browsers in a room connect to each other directly over WebRTC (`y-webrtc`). Tabs of one browser
   also sync over a BroadcastChannel.
3. A small **signaling server** only introduces browsers to each other. Everything sent through it
   and between browsers is encrypted with the room key, and the key is in the link's `#collab=`
   fragment, which browsers never send to any server.

The link is the only thing that grants access: anyone who has it can join and edit. Stop sharing
and share again to get a new room (and a new link).

### Trade-offs

| | Peer-to-peer (this) | A hosted sync server |
| --- | --- | --- |
| Hosting | None beyond the static site and a public (or your own) signaling server | A server to run, scale and secure |
| Privacy | End-to-end encrypted; no server stores the forest | The server sees and stores documents |
| Someone offline | The forest syncs only while at least one person who has it is online | The server always has the latest copy |
| Strict networks | Some corporate networks block direct connections; add a TURN server (`TW_COLLAB_ICE`) | Works anywhere HTTPS does |
| Room size | Best for small groups (each browser connects to each other one) | Scales further |

The public default signaling server (`wss://y-webrtc-eu.fly.dev`, run by the Yjs project) is fine for
trying it out. For a team, run your own: `npx y-webrtc-signaling` (from the `y-webrtc` package, set
`PORT`) behind TLS, and point the build at it with `TW_COLLAB_SIGNALING=wss://signal.example.com`.
`TW_DISABLE_COLLAB=true` turns the feature off.

## In code

`@tree-weaver/collab` works with any Yjs provider (WebSocket, WebRTC, IndexedDB…):

```ts
import { writeForest, readForest, Y } from '@tree-weaver/collab';

const doc = new Y.Doc();
writeForest(doc, null, forest);           // load a forest
writeForest(doc, forest, edited);         // write only what changed
doc.on('update', () => render(readForest(doc)));
```

## Testing

`pnpm e2e:collab` serves the built editor, starts a local signaling server and drives two separate
browsers: sharing, joining by link, edits both ways, undo of only your own change, presence, and
rejoining after a reload (run `pnpm build` first; `TW_CHROMIUM_PATH` points at another Chrome).
