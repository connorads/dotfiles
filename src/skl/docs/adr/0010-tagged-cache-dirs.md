# Exclude self-declared cache directories from payloads

## Context

ADR-0006 filters payload noise with a list of glob patterns, and cache directories are
named in that list one at a time. Enumeration by name is the defect: a cache only
disappears once someone notices it and edits the list. `.rumdl_cache` is the evidence —
it was in the built-ins while `.pytest_cache` and `.ruff_cache` were not, so `skl preview
personal/summon` listed two test-runner droppings as skill payload.

The cost is not only tree noise. The same filter feeds inline bundles, so an unlisted
cache pastes files like `.pytest_cache/v/cache/nodeids` into a web chat as skill content.

This is not a Git problem. pytest and ruff each write a self-ignoring `.gitignore` inside
their own cache, so the caches are already invisible to Git and the work-tree is clean.
`skl` answers a different question — "what is the skill payload?" — and has to answer it
itself.

## Decision

Exclude any directory containing a `CACHEDIR.TAG` file, along with its whole subtree.

`CACHEDIR.TAG` is the Cache Directory Tagging Spec marker: the tool that wrote the
directory declares it regenerable. That is a self-declaration, not a guess at a name, so
the rule needs no edit when the next tool arrives. All five cache directories in the
catalogue carry the tag, `.rumdl_cache` included, so the generic rule subsumes the
hand-enumerated case and `**/.rumdl_cache/**` leaves the built-in list. The list gains
nothing.

Detection is a pure string operation over the sibling path list, which already includes
dotfiles: find paths ending `/CACHEDIR.TAG`, drop that prefix. It lives in the core next
to `filterPayloadFiles`, with no filesystem read.

Only a *nested* tag marks a directory. A tag at the skill root would yield an empty
prefix and erase the whole skill, so there it excludes nothing but itself. The root
`SKILL.md` bypass still wins, and `--all` still restores everything.

## Considered Options

- **Keep enumerating cache directory names**: rejected. The list rots silently — a cache
  is payload until a human notices it in a tree, and by then it has already been inlined
  into a paste.
- **Verify the `Signature: 8a477f597d28d172789f06886806bc55` first line, per the spec**:
  rejected. It requires reading file contents, which pushes the rule out of the pure core
  into the shell. Name-matching a file called `CACHEDIR.TAG` is sufficient for a display
  filter, and the failure mode of a stray unsigned tag is a hidden directory the author
  chose to name that way.
- **Broad name-based defaults such as `.venv`, `dist`, `coverage`**: still rejected, as in
  ADR-0006. Those names can be meaningful payload. A tag is the writing tool's own
  statement, so a skill with a genuinely meaningful `.venv` is untouched.
- **Point the cache dirs elsewhere upstream** (`-p no:cacheprovider`, `RUFF_CACHE_DIR`):
  rejected. It only binds the runners we control; a maintainer running `pytest` by hand in
  a skill directory recreates the cache, and every third-party skill stays exposed.

## Consequences

- Caches from tools nobody has thought about yet are excluded the first time they appear,
  with no change to `skl`.
- The built-in glob list shrinks and stops accreting cache names.
- A tool that writes a cache without the tag is not covered; it needs an explicit config
  exclude, as any other unwanted directory does.
- Skill authors gain a deliberate opt-out: dropping a `CACHEDIR.TAG` into a directory
  hides it from payloads without touching config.
