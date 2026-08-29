# Excerpts store text verbatim, with provenance, captured in process

An excerpt records the passage exactly as it was when the key was pressed, plus
an `Origin` (pane, agent kind, agent name, cwd, session, transcript entry) and a
`Fingerprint` (sha256, byte and line counts, first and last 80 characters).
Nothing is re-resolved at render time.

Each source is an adapter in `src/shell/sources/` behind one `Source` port.
`cli.ts` calls `openSource(request)` and never learns which it got. `annotate
stash` always takes its text on stdin, so a source that needs no logic is a
pipe and only a source with real work gets an adapter.

## Context

The store outlives the binary. The record shape is the expensive thing to change
once real excerpts exist, so the seam between "what a source produces" and "what
the spool holds" is the decision worth making deliberately.

Three shapes were designed independently before choosing.

Measured on the live tmux server, because the surfaces differ in a way that
constrains this:

```
%1   claude  alt=1  height=39  visible=39  full_scrollback=78
%417 codex   alt=0  height=39  visible=39  full_scrollback=574
```

A Claude pane runs on the alternate screen, so tmux holds no conversation
scrollback for it - the 78 lines are 39 visible plus 39 of pre-launch shell
history. A selection reaches one screenful, unrecoverable once the pane redraws.
Claude also elides on screen (`… +42 lines`), so even that screenful is lossy.
A Codex pane is `alt=0` with full scrollback. So "the screen" is not one thing,
and for one of the two agents it is a lossy render of a transcript that still
exists on disk.

## Decision

Verbatim text, `Origin` and `Fingerprint` on every excerpt from day one, and
typed in-process source adapters behind a single port.

`Origin` and `Fingerprint` are ~20 lines and nothing reads them yet. They are
kept because they are the only thing that keeps address-based resolution
addable later: a verbatim record with no provenance cannot be re-anchored to
what it came from, so leaving them out would foreclose the option permanently
for the sake of twenty lines.

`StoredOrigin` widens `Origin` by one `{ kind: "unknown"; raw: string }`
variant, so an excerpt written by a newer binary - one that knows a source this
build does not - still renders under a generic heading instead of being dropped.

**Untruncation does not need late binding.** Reading the transcript entry *at
capture time* and storing it verbatim gets the untruncated text with none of the
costs below. That is what `--source transcript` does.

## Alternatives considered

- **Separate source programs emitting a JSON envelope**, in any language, with no
  TypeScript change needed to add one. The closest call, and the best fit for the
  composable-tools culture around it. Rejected on duplication and latency: every
  source independently needs pane → pid → agent kind → session → cwd and must
  format its own heading, so the same logic gets written in sh, Python and Lua
  and drifts; headings go inconsistent *within a single draft*; and no build ever
  typechecks a source against the sink. A bun spawn plus a Python source is
  ~150 ms on a keypress. The idea survives in reduced form - `stash` takes stdin,
  so a trivial source really is just a pipe.

- **Storing an address and resolving at render time** (pane + line range, or
  transcript uuid + offsets). It produced the two best ideas in the exercise, and
  both survive elsewhere: untruncation, and citations an agent can act on.
  Rejected on five counts, any one of which is disqualifying. Capture would shell
  out to a resolver on every keypress. The excerpts you most want to quote - a
  name, a number, one wrong flag - are too short to anchor uniquely. A drag
  spanning a tool result and the prose after it has no single address. The render
  becomes non-deterministic, so you can be shown something you did not select.
  And re-reading a file at send time can paste a credential that landed *after*
  capture. Its own conclusion was to store verbatim text and keep `Origin` +
  `Fingerprint`, which is this decision.

- **A comment required at capture**, as `plannotator/herdr-annotate` does - it
  refuses to save an uncommented annotation. Rejected because it forces a modal
  interruption per capture, which is the cost the tool exists to remove: you are
  mid-review, and the whole point is that spotting a second problem should not
  wait on writing up the first. A comment is written into the draft, and an
  excerpt with no comment is simply an excerpt.

- **Snapshotting the pane inside the adapter** when `--pane` is given and nothing
  is piped in. Built, then removed: it left `stash` with no deterministic rule
  for when to read stdin, and reading a stdin that is neither a TTY nor ever
  closed blocks forever - which is exactly what a keybinding calling `stash` with
  no pipe does. `stdin` is now a thunk on the port, so a source that does not
  want it never touches it.
