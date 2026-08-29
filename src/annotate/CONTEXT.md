# Context

Working glossary and domain notes for `annotate`. Terms here are meaningful to
the tool's domain, not implementation trivia.

## `annotate` - batch corrections into one agent prompt

Reviewing a coding agent's work produces several corrections at once, but the
channel back to the agent holds one thing at a time. The clipboard has a single
slot and the next copy clobbers it, so between spotting a problem and sending it
there is room for exactly one observation - which means describing things from
memory, or sending corrections one at a time and losing the rest.

The missing structure is **a buffer with more than one slot, where each slot
carries its own comment and its own provenance.** Everything else follows from
that; the annotation UI is a detail.

## Excerpt

A passage of text lifted from a terminal surface, with its origin.

**An excerpt has no comment - that is the point.** At capture there is nothing to
say yet, and stopping to write something is the interruption the tool exists to
remove. One key, no popup, a status-line confirmation, stay in the review flow.

## Spool

The append-only collection of excerpts waiting to be sent. Flushed empty by a
send.

## Draft

The Markdown document rendered from the spool and then edited by hand. What
actually gets delivered. Survives between sessions: quitting the editor without
sending keeps it, and reopening resumes with comments intact and anything
stashed meanwhile appended below.

## Origin

Where an excerpt came from: pane, agent kind, agent name, cwd, session.
Recorded at capture, never inferred later. It is why delivery can go back to the
pane an excerpt came from rather than to whichever pane happens to be focused.

## Fingerprint

sha256, byte and line count, and the first and last 80 characters of an excerpt
as captured.

## Source

A thing excerpts can be taken from: a copy-mode selection, a pane snapshot, a
transcript message.

## Annotation

A comment attached to an excerpt, existing only inside a draft. **Never a stored
record**, and never the name for the captured unit - an annotation without a
note is not one.

## Rejected names

Naming decisions worth not relitigating:

- **Annotation** for the captured unit. At capture there is no comment, so the
  word would name something the record cannot be.
- **Stash** as a noun. Git means a whole saved state by it, so "three stashes"
  reads as three spools. The verb (`annotate stash`) is kept, because stashing
  one thing is exactly what it does.
- **Fragment.** Dev-jargon-overloaded, and silent about provenance, which is
  half of what the record is for.
- **Clipping.** "Clip" is owned by video.
- **Set.** Silent about the flush-on-send lifecycle.
- **Tray.** Implies one-at-a-time processing, which is the thing being replaced.

## Decisions

- [ADR 0001](./docs/adr/0001-capture-seam.md) - excerpts store text verbatim,
  with provenance, captured in process.
- [ADR 0002](./docs/adr/0002-no-runtime-dependencies.md) - no runtime
  dependencies; why Effect lost.

## Layout

Functional core, imperative shell. `src/cli.ts` is the only place that reads
argv, touches the store, writes to stdout, or catches.

```
src/cli.ts                     imperative shell; the only try/catch
src/core/                      pure: result ids excerpt spool draft events
                               render text args exit transcript
src/shell/                     env store editor tmux
  sources/                     selection pane transcript, behind one Source port
  destinations/                agent clipboard file, behind one Destination port
tests/                         *.integration.test.ts + fixtures/
```

`store.ts`, `editor.ts` and `env.ts` are **not** ports - one implementation
each, and the test seam is an env override (`ANNOTATE_STATE_DIR`,
`ANNOTATE_EDITOR` pointing at a stub), which is how `pin-audit.bats` already
stubs its dependencies.

## The store

One append-only JSONL event log at
`${ANNOTATE_STATE_DIR:-${XDG_STATE_HOME:-~/.local/state}/agents}/annotate.jsonl`,
matching `papercut`'s state-dir convention.

```
stashed  { excerpt }
dropped  { excerptId }
drafted  { markdown, renderedThrough }   last-write-wins
sent     { markdown, destination, excerptIds }
```

State is a pure left fold: the spool is stashed-minus-dropped-minus-sent, the
draft is the latest `drafted` since the last `sent`. `undo` **appends** a
`drafted` carrying the last `sent` markdown - it is not a rewind, so the log
stays a record of what happened.

Nothing is ever rewritten, so a lock is needed only to serialise the
read-fold-append in `stash`. Parsing is tolerant throughout: a malformed line, a
torn final line, or an event kind from a newer binary is counted and skipped,
never fatal, because the store outlives the binary.

## Exit codes

The same contract as `agent`, so a caller scripting both reads one set:

```
0  ok, including every benign no-op (empty selection, empty spool, editor quit)
1  store or IO failure
2  usage
3  source or target unresolvable
4  delivery refused - the pane is waiting on a human
5  delivery stall - accepted, but the agent never started
```

Exit 4 matters. A pane sitting at an approval or trust prompt will take a pasted
draft as its *answer* - a fresh Codex pane at "Do you trust the contents of this
directory?" would have swallowed one whole. `agent prompt` refuses in that state
and `--force` is never passed; surface it as "that pane is waiting on you",
never as something to retry.

## Surfaces

| Surface | What it does |
| --- | --- |
| `a` in copy-mode | stash the selection, provenance from the binding |
| `prefix + Alt+e` | render the spool into a draft, edit it in a float, send it |
| `prefix + Alt+Shift+E` | pick a message from a Claude pane's transcript |
| status pill | `✎ n` excerpts waiting · `◍ n` unsent draft · hidden when idle |

The draft is a **float**, the picker a **popup**. Writing comments is dwelling,
and an agent may go blocked meanwhile, which a popup would hide. The usual popup
objection - acting on "the pane I came from" - does not apply here, because the
target pane was recorded in each excerpt's `Origin` at capture.

## Two tmux facts worth not rediscovering

**`copy-pipe` format-expands its command string**, and `#{pane_id}` there
resolves to the pane the selection was made in. Both obvious alternatives are
wrong: `$TMUX_PANE` is not set for a copy-pipe child (`man tmux` passes it to
"the child process of the pane", and the server spawns this one) and in practice
leaks a stale value inherited from whatever started the server; querying
`display-message -p '#{pane_id}'` from inside the child returns the **active**
pane, which is only incidentally the source.

**`display-message` exits 0 for a pane that does not exist**, printing an empty
line. Resolution has to key on the empty `pane_id`, never on the exit code.

## Leaving the editor

Save and quit sends. Two ways not to send, because one is not enough:

- **Exit non-zero** - vim's `:w` then `:cq` - keeps the comments, delivers
  nothing.
- **An unchanged draft is never sent.** `$EDITOR` here is `micro`, which cannot
  exit non-zero on purpose, so without this rule quitting it without saving
  would fire an uncommented render at the agent.

Deliberate send-verbatim is `--no-edit`. Deleting every section cancels cleanly.

The editor is the *only* review gate, which is why `--no-edit` is an explicit
opt-out: Claude collapses a pasted draft to `[Pasted text #1 +29 lines]` in its
input box at only 29 lines, so no draft can be eyeballed at the moment of
sending. Codex does the opposite and expands the whole thing inline. Neither is
a place to review.

## Limits

Excerpts are capped at 256 KiB each and a draft is refused above 512 KiB, with a
pointer to `annotate render > review.md`. `agent prompt` passes the body as one
argv word and `ARG_MAX` counts the environment too; 64 KiB, 256 KiB and 900 KiB
payloads were all measured to pass, so the cap is a mistake-catcher with
headroom rather than a hard ceiling.

## Testing

```bash
cd ~/src/annotate && bun test        # unit + integration
bats ~/.config/zsh/tests/annotate.bats       # CLI contract + the capture key
bats ~/.config/zsh/tests/annotate-lib.bats   # the status pill vocabulary
```

tmux suites start a private server on `-L "<name>_${BATS_TEST_NUMBER}_$$"` with
`-f /dev/null` and tear down with `stop_private_server`. Never probe the live
server.
