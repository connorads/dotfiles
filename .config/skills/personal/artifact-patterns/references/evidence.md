# Evidence

The probes behind the path tables, run 2026-10-06 on Claude Code v2.1.289,
runtime contract 0.2.69, bypassPermissions mode, one owner account. Re-run the
relevant probe after a version bump before trusting a row.

| Claim | Probe | Seen |
| --- | --- | --- |
| Comments sent to Claude push | Owner sent a comment from the page | `artifact-auto-react` notice; reply within about a minute |
| Auto-replies can silently fail | Second sent comment | Notice named a reply id; thread showed "awaiting reply" minutes later |
| `db` writes by people are pull | Owner marked two cards | Nothing reached the session until `ArtifactData list` |
| Claude `db` writes are live | Session set `live/status` twice | Open page changed with no reload |
| Rules hold | `as_level: interact` write to an admin-only path | Refused as "not found" |
| Claude Doc edits are pull | Owner changed a number twice | No notice to the terminal; `sinceRev` read showed the change |
| Chat panel is pull for docs | Asked the panel "what did I just change?" | Read on request; no history; misattributed an edit |
| Card hand-off needs the panel | `canSendToClaudeSession()` before and after opening Chat | `no_session`, then `available`; delivered `to: "pane"` |
| Publishing session is not a room peer | `room.onPeers` | People counted; no `kind: "agent"` peer (server flag) |
| `sample` consent wording | Pressed a summarise control | Dialog titled "This artifact uses connectors" |
| Composer anchor | Thread opened from a card's button | Anchored to the button element |
| Automation cannot click in the frame | Claude in Chrome clicks on page controls | No effect; header controls worked |

Not yet probed: default and plan permission modes, `--resume` restoring
watches, `/loop` polling, self-publishing pages under concurrent edits, and
the `mcp`, `assets`, `files` and `downloads` capabilities.

The runtime contract says a watching Claude session is told the moment a
live-doc edit lands. That did not hold for a Claude Doc in either the
terminal or the chat panel; treat it as unproven for every page kind until a
probe shows a notice arriving.
