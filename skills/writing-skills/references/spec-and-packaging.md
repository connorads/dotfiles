# Spec and packaging

The portable Agent Skills spec (agentskills.io) hard rules, plus the packaging
hygiene that keeps a skill portable. `scripts/check.sh` automates most of
this; `skills-ref validate <dir>` is the authoritative portable-spec check
when installed.

## Layout

A skill is a directory containing `SKILL.md`. The directory name must equal
the frontmatter `name`. Conventional optional subdirectories - any other
files are permitted:

```text
skill-name/
├── SKILL.md          # required: frontmatter + body
├── references/       # docs loaded on demand
├── scripts/          # executable code
└── assets/           # templates/resources used in output
```

## Frontmatter

YAML between `---` delimiters, starting at byte one of the file. For portable
skills, the field set is **closed**: unknown top-level keys such as `version:`,
`author:`, or `references:` make the skill invalid. Custom data goes under
`metadata` (string → string; quote numbers).

| Field | Rules |
|---|---|
| `name` (required) | 1-64 chars; lowercase letters/digits + hyphens; no leading/trailing/double hyphen; equals the directory name. Anthropic's platform (claude.ai, API upload) also reserves "anthropic" and "claude". Gerund style reads well (`processing-pdfs`). |
| `description` (required) | 1-1024 chars, non-empty. No XML tags is an Anthropic platform rule, not the spec's; `scripts/check.sh` enforces it so a skill stays uploadable. See [description.md](description.md). |
| `license` (optional) | Free text or a pointer to a bundled license file. |
| `compatibility` (optional) | 1-500 chars; only for genuine environment requirements. Most skills should omit it. |
| `metadata` (optional) | String-to-string map for anything else. |
| `allowed-tools` (optional) | Space-separated pre-approved tool patterns. Experimental; agent support varies. |
| `disable-model-invocation` (client extension) | `true` keeps the skill out of the model's listing, so only the user invokes it. Claude Code and Cursor honour it; opencode ignores it; claude.ai upload and `skills-ref validate` reject it. `scripts/check.sh` accepts it. |

## Client compatibility

Some clients extend the portable spec with their own top-level fields, and the
exact set churns per release - so treat each client's live docs as the source
of truth (e.g. code.claude.com/docs/en/skills) rather than snapshotting a list
that rots here. Extension fields can be valid for their target client but
reduce portability. This skill's checker accepts the portable field set plus
`disable-model-invocation`; document any client-specific target before
accepting other extension fields.

## Claude Code mechanics

Numbers checked 2026-09-25 against code.claude.com/docs/en/skills; re-check
there before leaning on one.

- **Description cap.** The skill listing truncates `description` plus
  `when_to_use` at 1,536 characters (`skillListingMaxDescChars`). The docs'
  rule follows from it: put the key use case first.
- **Listing budget.** All descriptions share 1% of the context window
  (`skillListingBudgetFraction`, or `SLASH_COMMAND_TOOL_CHAR_BUDGET`). On
  overflow the least-invoked skills' descriptions are shortened first, so a
  rarely used skill loses the trigger words that would get it used. Front-load
  them. `disable-model-invocation: true` takes a skill out of the listing.
- **Compaction.** After auto-compaction only the latest invocation of each
  skill is re-attached: its first 5,000 tokens, within 25,000 tokens across
  all skills, most recent first. A standing rule that must survive a long
  session belongs in the body's first 5,000 tokens.
- **Claude Code-only features.** `` !`cmd` `` context injection,
  `$ARGUMENTS`, `${CLAUDE_SKILL_DIR}` and extension fields are not in the
  portable spec, so no other client is obliged to honour them. Keep them out
  of a skill meant to travel.

## Size budgets

Soft limits with a hard rationale - the body competes with the whole
conversation for context:

- name + description ≈ 100 tokens (preloaded into every session; Claude
  Code's caps are under Claude Code mechanics above).
- SKILL.md body: under 500 lines / ~5k tokens - a **cap, not a target**. The
  more often a skill fires, the leaner its body should be; push depth into
  references.
- Bundled files: effectively unbounded - read on demand, and executed
  scripts never enter context at all.

## Bundled-file rules

- Reference bundled files by **relative path from the skill root**
  (`scripts/check.sh`, `references/evals.md`) - never an install path or
  home-relative path. Skills load from different locations on different
  machines; a hard-coded path breaks the first step silently.
- Keep references **one level deep** from SKILL.md. Chains (SKILL.md → a.md
  → b.md) and very long files get partially read, silently losing content.
- Give any reference over 300 lines a **table of contents** at the top, so
  a partial read still reveals the full scope. 300 is Anthropic's
  skill-creator threshold and the one `scripts/check.sh` warns at;
  Anthropic's platform best-practices page says 100.
- Every bundled file should be reachable from SKILL.md - an unreferenced
  file is never routed to by progressive disclosure. If a support directory
  is intentionally unrouted (e.g. `evals/`), say so in one line.

## Portability

- Check for required binaries before use (`command -v x`) and provide a
  portable fallback or a clear failure message. An assumed binary fails
  silently on the machine that doesn't have it.
- No machine-specific or house-convention paths in publishable skills.
- Forward slashes in paths; assume nothing about the working directory -
  scripts are invoked from the skill directory the agent resolved, not a
  fixed location.
- Name capabilities, not client tool names. A hard-coded tool name
  (`AskUserQuestion`) fails silently on clients that lack it: the model
  improvises instead of erroring, so the step is skipped with no signal.
  Name the capability with known tool names as examples ("the runtime's
  structured-question tool - e.g. `AskUserQuestion` (Claude Code),
  `request_user_input` (Codex)"), give a prose fallback, and forbid the
  silent path explicitly ("never skip the question and assume an answer").

## Hygiene

Ship only SKILL.md plus the files it routes to:

- No tool caches or build artifacts (`__pycache__/`, `.rumdl_cache/`,
  `.DS_Store`, `node_modules/`) - local state that adds nothing for a
  consuming agent.
- No eval scratch/output directories in the shipped skill.
- No history prose (release notes, "recently") and no undated snapshots
  (prices, version literals, verification banners). The rule and its fixes are
  SKILL.md's timeless-present bullet; `scripts/check.sh` greps the phrasing.

## Validation

```sh
scripts/check.sh <skill-dir>     # this skill's checker: spec basics + hygiene greps
skills-ref validate <skill-dir>  # reference validator, when installed
```

Run both before shipping; re-run after any revision loop, since hygiene
regressions arrive with edits.
