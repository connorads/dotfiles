---
description: Scaffold a new Agent Skill (SKILL.md + optional resources)
argument-hint: <skill-name> [project|personal] [notes...]
---

Create a new OpenCode Agent Skill directory and a `SKILL.md` file based on the user's notes.

Follow the Agent Skills specification:
- Skill is a directory with at minimum `SKILL.md`
- Optional support dirs: `scripts/`, `references/`, `assets/`
- `SKILL.md` must have YAML frontmatter + Markdown body

## Arguments

- `$1`: `skill-name` (required)
- `$2`: scope (optional): `project` or `personal` (default: `project`)
- Remaining `$ARGUMENTS` after `$2`: optional notes blob describing the skill

## Spec compliance (must follow)

### Skill directory
- The parent directory name must match the `name` field exactly.

### `name` rules
The skill name MUST:
- Be 1–64 characters
- Use lowercase letters (`a-z`), numbers (`0-9`), and hyphens (`-`) only
- Not start or end with `-`
- Not contain consecutive hyphens (`--`)

### `description` rules
The description MUST:
- Be 1–1024 characters
- Describe what the skill does AND when to use it (include trigger keywords)

### Optional frontmatter fields
If provided by the user or clearly implied by notes, include:
- `license` (string)
- `compatibility` (1–500 chars, only if meaningful)
- `metadata` (key/value map)
- `allowed-tools` (space-delimited tool list; experimental)

## Behavior

1. If `$1` is missing, ask for a skill name and stop.
2. Validate `$1` using the full `name` rules above.
   - If invalid, propose a normalized name:
     - lowercase
     - spaces/underscores -> `-`
     - remove invalid characters
     - collapse multiple hyphens to a single `-`
     - trim leading/trailing hyphens
   - Ask the user to confirm the proposed name before proceeding.
3. Determine target folder:
   - `project`: `.claude/skills/$1/`
   - `personal`: `~/.claude/skills/$1/`
4. If the target folder already exists (or `SKILL.md` exists), ask whether to:
   - overwrite
   - update in-place
   - or cancel
   Then stop and wait for the answer.
5. If no notes were provided (beyond name/scope), ask the user to paste their notes and stop.
   Ask specifically for:
   - What the skill does
   - When to use it (trigger phrases/keywords)
   - Step-by-step instructions
   - 1–2 examples
   - Whether they want any of: `scripts/`, `references/`, `assets/`
   - Any optional frontmatter: `license`, `compatibility`, `allowed-tools`, `metadata` (author/version)
6. Create the skill directory.
7. Create optional support directories if requested OR if the notes mention any scripts/references/assets:
   - `scripts/`
   - `references/`
   - `assets/`
8. Write `SKILL.md`.
   - If the pasted notes already look like a complete `SKILL.md` (starts with `---` and includes `name:` and `description:`), use it as-is BUT ensure:
     - `name` matches `$1`
     - directory name matches
     - `description` is non-empty and <= 1024 chars
     If there is a mismatch, ask the user how to resolve it (do not guess).
   - Otherwise generate `SKILL.md` with:
     - Frontmatter: `name: $1`, `description: ...`, plus optional fields if provided
     - Body sections:
       - `# <Human readable title>`
       - `## Instructions`
       - `## Examples`
       - `## References` (only if you create `references/`)
       - `## Scripts` (only if you create `scripts/`)

## Progressive disclosure (recommended)

- Keep `SKILL.md` concise (preferably under 500 lines).
- If notes are long or contain deep reference material, split it into:
  - `references/REFERENCE.md` (detailed docs)
  - `assets/` for templates/schemas
  - `scripts/` for runnable helpers
- In `SKILL.md`, link to these files with relative paths, e.g.:
  - `[Reference](references/REFERENCE.md)`
  - `scripts/my_script.py`

Keep the skill focused and specific; do not invent capabilities not present in the notes.