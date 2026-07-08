# Spec and packaging

The agentskills spec (agentskills.io) hard rules, plus the packaging hygiene
that keeps a skill portable. `scripts/check.sh` automates most of this;
`skills-ref validate <dir>` is the authoritative spec check when installed.

## Layout

A skill is a directory containing `SKILL.md`. The directory name must equal
the frontmatter `name`. Conventional optional subdirectories — any other
files are permitted:

```text
skill-name/
├── SKILL.md          # required: frontmatter + body
├── references/       # docs loaded on demand
├── scripts/          # executable code
└── assets/           # templates/resources used in output
```

## Frontmatter

YAML between `---` delimiters, starting at byte one of the file. The field
set is **closed** — validators reject unknown top-level keys, so `version:`,
`author:`, or `references:` at top level make the skill invalid. Custom data
goes under `metadata` (string → string; quote numbers).

| Field | Rules |
|---|---|
| `name` (required) | 1–64 chars; lowercase letters/digits + hyphens; no leading/trailing/double hyphen; equals the directory name; not "anthropic"/"claude". Gerund style reads well (`processing-pdfs`). |
| `description` (required) | 1–1024 chars, non-empty, no XML tags. See [description.md](description.md). |
| `license` (optional) | Free text or a pointer to a bundled license file. |
| `compatibility` (optional) | 1–500 chars; only for genuine environment requirements. Most skills should omit it. |
| `metadata` (optional) | String-to-string map for anything else. |
| `allowed-tools` (optional) | Space-separated pre-approved tool patterns. Experimental; agent support varies. |

## Size budgets

Soft limits with a hard rationale — the body competes with the whole
conversation for context:

- name + description ≈ 100 tokens (preloaded into every session).
- SKILL.md body: under 500 lines / ~5k tokens — a **cap, not a target**. The
  more often a skill fires, the leaner its body should be; push depth into
  references.
- Bundled files: effectively unbounded — read on demand, and executed
  scripts never enter context at all.

## Bundled-file rules

- Reference bundled files by **relative path from the skill root**
  (`scripts/check.sh`, `references/evals.md`) — never an install path or
  home-relative path. Skills load from different locations on different
  machines; a hard-coded path breaks the first step silently.
- Keep references **one level deep** from SKILL.md. Chains (SKILL.md → a.md
  → b.md) and very long files get partially read, silently losing content.
- Give any reference over ~300 lines a **table of contents** at the top, so
  a partial read still reveals the full scope.
- Every bundled file should be reachable from SKILL.md — an unreferenced
  file is never routed to by progressive disclosure. If a support directory
  is intentionally unrouted (e.g. `evals/`), say so in one line.

## Portability

- Check for required binaries before use (`command -v x`) and provide a
  portable fallback or a clear failure message. An assumed binary fails
  silently on the machine that doesn't have it.
- No machine-specific or house-convention paths in publishable skills.
- Forward slashes in paths; assume nothing about the working directory —
  scripts are invoked from the skill directory the agent resolved, not a
  fixed location.

## Hygiene

Ship only SKILL.md plus the files it routes to:

- No tool caches or build artifacts (`__pycache__/`, `.rumdl_cache/`,
  `.DS_Store`, `node_modules/`) — local state that adds nothing for a
  consuming agent.
- No eval scratch/output directories in the shipped skill.
- No dated change-history prose ("previously", "no longer since…", "recent
  changes") — state the current rule; history belongs in commit messages.
- No volatile external facts (prices, version literals, beta statuses) as
  standing prose; point at the live source and mark any snapshot as
  illustrative.

## Validation

```sh
scripts/check.sh <skill-dir>     # this skill's checker: spec basics + hygiene greps
skills-ref validate <skill-dir>  # reference validator, when installed
```

Run both before shipping; re-run after any revision loop, since hygiene
regressions arrive with edits.
