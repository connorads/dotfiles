# BB SDK frictions

This file lists gaps in the BB plugin SDK and app that forced a workaround or
blocked a feature. Each entry is a candidate BB feature request.

Add an entry when you find the gap, not at the end of the task. Search this
file first and extend a matching entry instead of adding a duplicate.

## Entry format

```markdown
### <Short name of the missing capability>

- Found: YYYY-MM-DD, <plugin>, SDK <version>
- Wanted: <the user-visible outcome>
- Gap: <what the SDK lacks, with the API names checked>
- Workaround: <what the plugin does instead, with file links>, or "none: blocked"
- Ask: <the smallest SDK change that removes the workaround>
- Status: open | requested <link> | fixed in <version>
```

When BB ships a fix, set the status, then delete the workaround in its own commit.

## Open

### Additive decoration on a sidebar thread row

- Found: 2026-10-18, claude-profiles, SDK 0.6.37
- Wanted: a small account initial on the Claude icon of each sidebar thread row.
- Gap: no slot adds content to a bundled thread row. `experimental_setThreadRowStatus`
  replaces the draft glyph, takes only an icon name, and competes with the drafts and
  workflows plugins. `experimental_threadList` replaces the whole list and is exclusive.
- Workaround: a content script decorates `a[data-sidebar-thread-id]` rows and their
  `[data-sidebar-thread-provider]` icon by DOM selector:
  [rows.ts](../claude-profiles/ui/badges/rows.ts). A markup change in the bundled
  thread list breaks it without an error.
- Ask: a non-exclusive row accessory slot, for example
  `app.slots.threadRowAccessory({ id, component })` with `{ thread }` props, placed on
  the provider icon or before the title.
- Status: open

### Content scripts cannot call plugin RPC or realtime

- Found: 2026-10-18, claude-profiles, SDK 0.6.37
- Wanted: a content script that reads the plugin's own server data and follows its
  realtime events.
- Gap: `useRpc` and `useRealtime` are React hooks only. `PluginContentScriptContext`
  exposes `pluginId`, `generation`, `signal` and `experimental_setThreadRowStatus`,
  with no RPC client.
- Workaround: an always-mounted `experimental_appOverlay` renders `null`, calls the RPC
  and writes a module store that the content script reads:
  [bridge.tsx](../claude-profiles/ui/badges/bridge.tsx).
- Ask: `context.rpc` and `context.realtime.subscribe` on `PluginContentScriptContext`.
- Status: open
