# Working in the raea app

When the raea app launches you, its feed is where you and the person work together: you post what you make, they
look, play and leave notes, and the workspace's standing decisions live in controllers. Every tool here is PAGE (it
needs the person's feed open) and is listed in full in [reference/feed.md](reference/feed.md); this file says when
to reach for each. Headless, with no app, SKILL.md's steps 5 and 6 say what to do instead.

## When you need to...

| ...then | Use |
|---|---|
| know what to make, as the project stands now | `feed_brief` (the brief.ts, current); in a workspace chat, `workspace_read` for its projects and agents |
| say what you'd make next and let the person choose before you spend the time | `feed_propose`: a planned item they accept, or don't |
| show what you made | `feed_post`: a render, a still, audio or a game; a new version names the item it `replaces` and says in `changed` what changed |
| read what's in the feed and the notes left on it | `feed_items` |
| mark which items are deliverables, and for where | `item_tags` (key:value tags such as `platform:tiktok` become the project's Table columns; `export` makes it a deliverable), or `export`/`tags` on `feed_post` ([delivery.md](delivery.md)) |
| read the workspace's standing decisions (delivery specs, who reviews what) | `controllers_read`, before you start |
| have the person decide something that should hold for every piece from now on | `controller_post` with the fields and a line on why; a decision about one piece is a note on it, not a controller |
| add a standing decision the person asked for, change one field, or retire one | `controller_write`, `controller_set`, `controller_remove`, only when the person asks |
| work on what the person has open in the composition editor ("this", "here", "the selected one") | `editor_selection` first, then `editor_edit`: their undo takes it back, and it saves with their changes |
| plan in the open before making: a shot list, a structure, options side by side | `whiteboard_write` (say what's on it and how it's grouped; the feed lays it out), `whiteboard_read` for what the person drew back |
| show and tune a ComfyUI workflow the person can see | `flow_board` puts it on a board, `flow_write` changes its settings, `flow_run` runs it through `raea gen` (it spends: [gen.md](gen.md)) |
| start a new project for a client, a game or a show | `channel_create` from one sentence, when the person asks for one |

## What the person may have set for you

The person sets, per agent, which of these tools it may use and whether it asks before acting. A tool refused because
it's off for you is the person's choice: say what you would have done with it and go on without it, rather than
trying another way round.
