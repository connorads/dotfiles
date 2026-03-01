---
name: agent-skills-spec
description: >
  Validate, audit, and fix agent skills for agentskills.io spec compliance.
  Use when creating a new skill structure, auditing an existing skill against
  the specification, fixing common spec deviations, or reviewing frontmatter,
  directory layout, progressive disclosure, or script interfaces. Triggers on
  "validate skill", "audit skill", "spec compliance", "fix skill structure",
  "skill frontmatter", "SKILL.md format", or "agent skills spec".
---

# Agent Skills Spec

Structural compliance for the [agentskills.io](https://agentskills.io) specification. For content quality and expertise transfer, use skill-creator-v2 instead.

## Mental Model

A skill is a **progressive disclosure pipeline**. Each layer has strict constraints:

```
Layer 1: METADATA (~100 tokens)                    ← always loaded
  name + description in YAML frontmatter
  Must be precise enough for activation decisions

Layer 2: INSTRUCTIONS (<5000 tokens recommended)   ← loaded on activation
  SKILL.md body, <500 lines
  Core workflows, decision frameworks, essential examples

Layer 3: RESOURCES (on demand)                      ← loaded when referenced
  references/*.md, scripts/*, assets/*
  Deep knowledge, executable code, templates
```

Every spec rule serves this pipeline. Name/description enable discovery. Body enables execution. Resources enable depth without cost.

## Create Workflow

Create a new spec-compliant skill:

1. **Name**: Choose lowercase kebab-case, 1–64 chars
2. **Directory**: `mkdir -p skill-name/references`
3. **Frontmatter**: Write valid YAML with `name` + `description`
4. **Body**: Core instructions in imperative mood, <500 lines
5. **Split**: Move detailed content into `references/`
6. **Scripts**: Add to `scripts/` if needed (see [script guidelines](references/script-guidelines.md))
7. **Validate**: Run `skills-ref validate ./skill-name` or walk through [validation checklist](references/validation-checklist.md)

Minimal valid skill:

```yaml
---
name: my-skill
description: >
  Extract text from PDFs and fill forms. Use when working with PDF files
  or when the user mentions PDFs, forms, or document extraction.
---

# My Skill

[Instructions here]
```

## Audit Workflow

Audit an existing skill for spec compliance:

1. Check frontmatter against hard rules (required fields, character limits, naming)
2. Check for disallowed frontmatter fields (see below)
3. Verify directory structure (only `scripts/`, `references/`, `assets/` allowed)
4. Scan for non-standard top-level files (README, LICENSE, CHANGELOG)
5. Count SKILL.md body lines (<500)
6. Assess description quality (specific triggers? capability + when?)
7. Assess progressive disclosure (too much in SKILL.md?)
8. Check script interfaces if `scripts/` exists
9. Report findings with severity + fix recommendations

For the full checklist: see [references/validation-checklist.md](references/validation-checklist.md)

## Fix Workflow

Remediate common issues. For the complete decision tree with before/after examples: see [references/common-fixes.md](references/common-fixes.md)

Quick reference:

| Issue | Severity | Fix |
|-------|----------|-----|
| Non-spec frontmatter fields | Error | Move to `metadata` or remove |
| Name/directory mismatch | Error | Rename to match |
| `allowed-tools` as YAML array | Error | Convert to space-delimited string |
| Interactive prompts in scripts | Error | Replace with CLI flags/stdin |
| SKILL.md >500 lines | Warning | Split into `references/` |
| README/LICENSE/CHANGELOG present | Warning | Remove (AI meta-docs) |
| Non-standard directories (`rules/`, `templates/`) | Warning | Rename to `references/`/`assets/` |
| Vague description | Warning | Add specific triggers and "Use when..." |
| Scripts without `--help` | Info | Add usage documentation |

## Frontmatter Rules

### Required fields

| Field | Constraints |
|-------|-------------|
| `name` | 1–64 chars. Lowercase alphanumeric + hyphens only. No leading/trailing/consecutive hyphens. Must match parent directory name (after NFKC normalisation). |
| `description` | 1–1024 chars. Non-empty. Describe what the skill does AND when to use it. Include specific trigger keywords. |

### Optional fields

| Field | Constraints |
|-------|-------------|
| `license` | String. License name or reference to bundled file. |
| `compatibility` | 1–500 chars. Environment requirements only. Most skills don't need this. |
| `metadata` | Key-value map (string → string). For client-specific properties. |
| `allowed-tools` | Space-delimited string (**not** YAML array). Experimental. e.g. `Bash(git:*) Read` |

### Disallowed fields

Any field not in `{name, description, license, compatibility, metadata, allowed-tools}` is a validation error. Common offenders:

| Found | Fix |
|-------|-----|
| `version` | Move to `metadata.version` |
| `author` | Move to `metadata.author` |
| `tags` | Move to `metadata.tags` |
| `references` | Remove (use directory convention) |
| `user-invocable` | Remove (non-spec) |
| `argument-hint` | Remove (non-spec) |

## Directory Structure

```
skill-name/                   # Must match frontmatter name
├── SKILL.md                  # Required
├── scripts/                  # Optional: executable code
├── references/               # Optional: on-demand documentation
└── assets/                   # Optional: static resources
```

**Should not exist at top level:**
- `README.md`, `LICENSE`, `CHANGELOG.md` — AI meta-docs
- `package.json`, `tsconfig.json`, lock files — build artifacts
- Bare `.md` files other than `SKILL.md` — move to `references/`

**Non-standard directories** (rename):
- `rules/` → `references/`
- `templates/` → `assets/`
- `examples/` → `references/`
- `src/`, `docs/`, `test/` → remove or restructure

## Progressive Disclosure

Keep SKILL.md body under 500 lines. When approaching this limit, offload to `references/`:

| Content type | Move to |
|-------------|---------|
| Detailed examples | `references/examples.md` |
| API reference tables | `references/api.md` |
| Edge cases/gotchas | `references/advanced.md` |
| Installation/setup | `references/setup.md` |
| Pattern libraries | `references/patterns.md` |

Replace offloaded content with a one-line reference:

```markdown
For detailed examples, see [references/examples.md](references/examples.md).
```

Keep references one level deep from SKILL.md. Avoid chains (A → B → C).

## Description Quality

A description is effective when an agent can answer from it alone:
1. "What does this skill do?" (capability)
2. "Should I activate it for this task?" (trigger)

| Quality | Pattern | Example |
|---------|---------|---------|
| Poor | Vague noun phrase | "Helps with documents" |
| Fair | Capability only | "Processes PDF files" |
| Good | Capability + trigger | "Extract text from PDFs. Use when working with PDF files." |
| Excellent | Capability + specific triggers + scope | "Extract text and tables from PDFs, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction." |

## Validation

With `skills-ref` installed:

```bash
skills-ref validate ./my-skill        # structural validation
skills-ref read-properties ./my-skill  # dump parsed frontmatter
```

Install if needed:

```bash
uv tool install skills-ref   # or: pip install skills-ref
```

Without the tool, walk through [references/validation-checklist.md](references/validation-checklist.md) manually.

## Script Rules (Summary)

Full guide: [references/script-guidelines.md](references/script-guidelines.md)

Non-negotiable:
- **No interactive prompts** — agents cannot respond to TTY input
- **Support `--help`** — agents discover script interfaces through help output
- **Structured output** (JSON/CSV) to stdout, diagnostics to stderr
- **Meaningful exit codes** — document in `--help`
- **Pin dependency versions** — reproducibility across environments
- **`--dry-run`** for destructive operations

## References

- [Validation checklist](references/validation-checklist.md) — exhaustive audit checklist
- [Common fixes](references/common-fixes.md) — decision tree + fix recipes
- [Script guidelines](references/script-guidelines.md) — spec-compliant script design
- [agentskills.io specification](https://agentskills.io/specification) — canonical spec
