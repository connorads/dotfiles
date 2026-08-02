# Skill identity is `(source, name)` with precedence + qualification

`skl` loads skills from multiple configured **source** roots, where the same skill
`name` can appear in more than one source. A skill's identity is the pair
`(source, name)`. The CLI resolves a **bare** `skl <name>` by config order (PATH
semantics — first source wins) and prints the resolved source; a **qualified**
`skl <source>/<name>` is exact. The popup tags every row with its source so collisions
are visible and picked deliberately.

## Considered options

- **Silent dedup by name**: rejected — sources are *meaningful* (curated repo vs test
  fixture vs experimental), so hiding a copy is dishonest and risks loading a stale one.
- **Error on any bare-name clash**: rejected as the default — too much friction during
  testing, when a fixture root deliberately overlaps the real repo. Qualification remains
  available as the escape hatch.
- **Always require `source/name`**: rejected — kills the convenient bare-name fast path
  for the common (non-colliding) case.

## Consequences

- This grammar is baked into both the config schema (ordered `paths` with optional
  `name` labels) and the CLI reference parser, so it is moderately costly to change later.
- Bare-name precedence is a familiar mental model (`which`, shell command resolution).
  Printing the resolved source on every load keeps it transparent (visibility of system
  status), so precedence is convenient without being silently surprising.
