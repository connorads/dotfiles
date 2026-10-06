# Recipes

Snippets proven on one test page (runtime contract 0.2.69). The API
reference is the artifact-capabilities skill; these show only the wiring
each pattern needs. Every page renders without the capability first and
lights up when `claude.use()` resolves.

```js
const use = (n) => (window.claude?.use ? window.claude.use(n).catch(() => null) : Promise.resolve(null));
```

## Status strip

Claude writes one document; every open page updates in place.

Rules: `{"path": "live", "read": "view", "write": "admin"}`

Page:

```js
const db = await use("db");
db?.doc("live/status").onSnapshot((s) => {
  const d = s.exists ? s.data() : null;
  if (d?.text) render(d.text, d.at);
}, () => {});
```

Claude, each update: `ArtifactData` `set` on collection `live`, doc `status`,
`{text, at}`, passing `if_version` from the previous write.

## Comment feedback

Reviewers send a comment to Claude; the publishing session is woken.

- Publishing starts the watch. Confirm it with `ArtifactComments` `watch`
  and no url.
- A page "Discuss" button: declare `{"comments": {"composer_only": true}}`
  and call `comments.openComposer({element})` from the click. It anchors to
  the clicked button, so place the button inside the item it concerns.
- Tell the user the sender must be someone who can edit, and must use Send
  to Claude or `@claude`. Plain comments wake nobody.
- In default permission mode the session asks before reading and replying;
  in plan mode it waits. Only modes that let it post act alone.

## Per-viewer input

Each viewer writes only their own document; everyone reads all.

Rules, in order:

```json
[
  {"path": "items", "read": "view", "write": "admin"},
  {"path": "votes", "read": "view", "write": "owner"},
  {"path": "votes/{self}", "write": "interact"}
]
```

Declare `user` too. Page writes `db.doc("votes/" + await user.id()).set({...})`.
Gate inputs on `user.can("data.write")`; if a well-formed `set` rejects
`invalid_argument`, render read-only. Viewers at Viewer or Commenter level
cannot write at all - share at Contributor for input pages.

Claude seeds `items` with one `ArtifactData` `batch` after publishing, then
reads `votes` with `list` when the user asks.

## Edited docs

For text people edit together, use a Claude Doc, not a custom page. Edits
are pull only. To see what changed since a known revision:
docs `read` on the tab body with `{"kind": "view", "sinceRev": <rev>}` -
changed blocks come back with their text runs. Keep the last `rev` you read
as the bookmark. The chat panel beside a doc cannot see history and can
misattribute who edited what.

## Ask about an item

`room.sendToClaudeSession(data, {deliver: "send"})` hands JSON to the chat
open beside the page. Show the control only when
`room.canSendToClaudeSession()` returns `available` or
`available_if_summoned`; it returns `no_session` until the viewer opens
Chat from the artifact header. Strip invisible format characters from text
fields; the payload is capped at 4 KiB. The chat cannot change the repo.
