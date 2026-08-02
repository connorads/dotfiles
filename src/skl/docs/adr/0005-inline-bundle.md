# Inline bundle: the pointer's inverse, for targets with no filesystem

`skl inline <ref>` prints a skill's **full retained content** - SKILL.md plus every
retained text file under its dir, wrapped in XML-ish delimiters:

```text
<skill name="raycast-extensions" source="public">
<file path="SKILL.md">
…verbatim contents…
</file>
<file path="references/manifest.md">
…verbatim contents…
</file>
</skill>
```

## Context

The pointer (ADR-0003, CONTEXT.md) is deliberately *not* the SKILL.md content: it
injects a name + absolute path + tree + "Read SKILL.md at `<path>`", and the agent
reads the file itself. That is the right default — tiny context, progressive
disclosure — and it works **because the agent shares the filesystem** (a tmux pane
running Claude Code).

It breaks the moment the target has no filesystem: a claude.ai / ChatGPT chat, a
web textarea, a prompt pasted into an issue. "Read SKILL.md at /Users/…" points at
a path the reader cannot open. To use a skill there, the content has to travel with
the paste.

## Decision

Add `inline` as a sibling of `preview` — same shape (resolve one ref), different
payload. It reuses the discovery that already powers the pointer's tree:
`DiscoveredSkill.files` is the retained payload file list, so "inline everything" is
*read each retained file, concatenate*, no new discovery.

- **Everything retained and text, by default.** A web paste can't lazy-load a reference
  later, so leaving retained references out would defeat the purpose. Generated/cache
  artefacts are filtered before reading; binaries (images) that survive the payload
  filters are skipped via a NUL-byte sniff and noted on stderr; the bundle on stdout
  stays pasteable.
- **XML-ish `<file>` tags, not ``` fences.** Skill files are themselves full of
  fenced code blocks; nesting them inside more fences breaks rendering. Tags nest
  cleanly and Claude parses them well. (Same reasoning the Anthropic docs give for
  XML-tag structure in prompts.)
- **stdout = bundle, stderr = notes.** Skipped-binary lines go to stderr so the
  command composes (`skl inline x | pbcopy`) without polluting the payload.

Split across the layers as everywhere else: `renderBundle` is pure
(`core/bundle.ts`, unit-tested); reading + binary-sniff is the shell
(`readSkillFiles` in `shell/fs.ts`); `cli.ts` wires them.

## Consequences

- A new verb that **inverts** the pointer's founding principle ("not the content").
  That is intentional and scoped to the no-filesystem case — the pointer stays the
  default for the tmux flow; `inline` is opt-in for paste targets.
- Bundles can be large (the raycast-extensions skill is ~55 KB across 8 files). That
  is inherent to inlining — the alternative is the reader can't see the references.
  No truncation: a silently clipped skill is worse than a big paste.
- A naive escape risk: if a skill file contained a literal `</file>` line it could
  confuse a parser. No catalogue file does, and the consumer is an LLM (robust to
  it), so we do not escape — revisit only if a real collision appears.
- Primary consumer is the Raycast extension's "Copy Inlined Skill" action (the
  reason inlining exists is pasting outside tmux), but the CLI verb stands alone and
  works from the terminal (`skl inline <ref> | pbcopy`).
