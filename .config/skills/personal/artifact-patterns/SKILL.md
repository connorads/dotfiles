---
name: artifact-patterns
description: >-
  Chooses how a published Claude artifact and the people using it exchange
  information with a Claude session, and builds the matching page. Use when an
  artifact is meant for other people to act on: status or progress pages,
  dashboards, review or playtest feedback, votes, triage, sign-offs, a runbook
  or spec doc teammates edit, or "how will you notice when someone comments,
  flags, marks or edits it". Not for visual page design or the runtime
  capability API, which the artifact-capabilities skill owns.
---

# Artifact patterns

> **When a person does something on the page, which Claude finds out - and
> does it find out on its own?**

Most paths are pull: the change is stored, and Claude sees it only when it
reads. Design every artifact from the answer to that question, and say the
answer to the user before building. Never promise that Claude "will notice"
an edit or a mark unless the path below is marked push.

## The paths

Artifacts change fast. Every row below is as of **2026-10-06**, Claude Code
v2.1.289, runtime contract 0.2.69. When `claude --version` or the contract
named by the `artifact-capabilities` skill is newer, check the official
sources before relying on a row, and say to the user which rows are unchecked:

- [Claude Code artifacts docs](https://code.claude.com/docs/en/artifacts):
  publish, share, comments, auto-replies, connectors, downloads, limits
- [Claude Code changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md):
  what changed since the as-of version
- The `artifact-capabilities` skill and its bundled `.d.ts` files: the
  runtime API for the contract in use

The probes behind each row are in
[references/evidence.md](references/evidence.md).

| A person… | Reaches | Push or pull |
| --- | --- | --- |
| Sends a comment to Claude (Send to Claude, `@claude`) | The terminal session that is watching | **Push** - wakes it |
| Leaves a plain comment | Nobody | Pull - `ArtifactComments` read |
| Writes `db` data (marks, rows, forms) | Nobody | Pull - `ArtifactData` list or query |
| Edits a Claude Doc | Nobody, terminal or chat panel | Pull - docs `read` with `sinceRev` |
| Clicks a `room.sendToClaudeSession` control | The claude.ai chat open beside the page | **Push**, only with that panel open; else `no_session` |
| Presses a `sample` control | Claude answers inside the page, viewer pays | n/a - no session involved |

| Claude… | Reaches | Result |
| --- | --- | --- |
| Writes a `db` document | Every open copy of the page | Live, no reload, no republish |
| Republishes | Every open copy | Live, new version |

The terminal session owns the repo; the chat panel cannot touch it. So route
anything that needs code changes through comments sent to Claude, not through
clicks.

## Pick the pattern by job

| Job | Pattern | Read |
| --- | --- | --- |
| Progress or status page | Claude writes a `live/status` doc; page subscribes | [references/recipes.md](references/recipes.md#status-strip) |
| Review, playtest, flag a problem | Comments sent to Claude; the watching session acts and resolves | [references/recipes.md](references/recipes.md#comment-feedback) |
| Votes, triage, sign-off input | Per-viewer docs under `{self}`; Claude pulls on request | [references/recipes.md](references/recipes.md#per-viewer-input) |
| Doc teammates edit as work goes | Claude Doc; tell the user Claude re-reads on request, never live | [references/recipes.md](references/recipes.md#edited-docs) |
| Ask Claude about one item | `sendToClaudeSession` to the chat panel; explanation only | [references/recipes.md](references/recipes.md#ask-about-an-item) |

When a job needs Claude to react to data or doc edits without a prompt, no
path does that. Offer a `/loop` that reads on an interval, or ask the user to
send a comment to Claude, and say which.

## Standing rules

- After an `artifact-auto-react` notice, read the thread before resolving it.
  A notice once named a posted reply that never landed.
- Ship `capabilities` in full on every republish that declares them: a
  non-empty object replaces the stored set, so a dropped name is revoked.
- A `{self}` rule needs its prefix rule to set both `read` and `write`, or
  the publish is refused.
- Do not test page controls with browser automation: clicks inside the
  artifact frame do not register. Test the data path with `ArtifactData`
  (`as_level` for lower roles) and ask the user to click.
- A `sample` prompt sees only what the page sends. Send the rows the answer
  needs, not anonymised counts, when the question is about who answered.
- `comments.openComposer({element})` anchors to the clicked control, not the
  element passed. Put the button inside the element the thread is about.

## After publishing

1. Read back once what the page stores, at the lowest role that writes it.
2. Tell the user in one line which paths push and which pull for this page.
3. Confirm the watch with `ArtifactComments` `watch` (no url) when the
   pattern relies on comments.
