# Claude session capture reads the pid marker

## Context

A resurrect restore relaunches each Claude pane on its own conversation. The
flags come from the saved argv and the account from `CLAUDE_CONFIG_DIR`. The
session id is the one fact only Claude holds, so the save hook has to learn it
from Claude.

Claude writes `<config_dir>/sessions/<pid>.json` for each interactive process.
It carries `sessionId`, `cwd` and a `tmux` field naming the pane. It is an
internal file, not a documented interface. Branch, hibernate, teleport and
session adopt read the same marker. Teleport's picker runs with no pane, so the
marker is the only source it can use.

Claude's `SessionStart` hook is documented. Its payload carries `session_id`
and `source` (`startup`, `resume`, `clear`, `compact`, `fork`). `/clear` fires
`SessionEnd` for the old id and then `SessionStart` for the new one, in order,
from the same process.

## Decision

The save hook finds the pane's foreground Claude pid from its tty and reads
that pid's marker. It records no id when the marker is absent, and the carry
rule in `resurrect-save-sessions.sh` keeps any earlier id for that pane. The
account is read from the live process environment for every Claude pane, with
or without an id.

A `claude -p` run inside an interactive Claude's pane fires the same hooks with
the parent's `TMUX_PANE`. Claude sets `CLAUDE_CODE_ENTRYPOINT=sdk-cli` for print
mode even when `cli` is inherited, so the pane hooks act only on `cli` or unset.
The pid-marker read needs no such guard: a nested process is never the pane's
foreground process.

Measured on 2026-09-27: 29 of 33 live Claude panes resolved an id from the
marker. The other four are covered by the carry rule or restore as
`--continue` under their recorded account.

## Alternatives considered

- **The hook publishes `@claude_session_id` as a pane option, and the save hook
  reads it.** This mirrors how Codex publishes its thread. It removed about 17
  lines from the save hook, but branch, hibernate and teleport would still read
  the marker. That leaves two sources of truth for one fact. It also needs a
  nested-process guard, because the hook of a nested Claude fires on the
  parent's pane.
- **Read every marker and match its `tmux` field to the live panes.** This
  drops the tty-to-pid step. A nested `claude -p` writes its own marker with
  the parent's pane in `tmux`, so it needs the same guard. It also depends on a
  newer undocumented field.
- **herdr's model.** A long-running server owns a socket. Per-agent hook
  scripts push session ids to it, and it resumes each pane with bare
  `claude --resume <id>`. That needs a server these dotfiles do not run, and the
  resume drops launch flags and the account.
- **An `lsof` fallback on the open transcript.** Removed. The default-account
  filter never matched, and for a profile account it could pick a subagent's
  `agent-*.jsonl` and record that as the session id.
- **Assign the id at launch with `--session-id`.** `/clear`, fork and an
  in-session `/resume` change the id without telling the launcher, so the
  record would name the wrong conversation.

## Consequences

The sandbox support for the marker stays: the reaper patch, `claude-session-adopt`
and `claude-session-resolve.py`. A sandboxed Claude's reaper can delete other
processes' markers, and those panes then fall back as above.
