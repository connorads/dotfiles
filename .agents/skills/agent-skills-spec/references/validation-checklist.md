# Validation Checklist

Walk through each section in order. Report all failures before suggesting fixes.

## 1. Directory Structure

- [ ] Directory exists and contains `SKILL.md`
- [ ] No non-standard top-level files (see list below)
- [ ] No non-standard subdirectories (only `scripts/`, `references/`, `assets/`)
- [ ] No build artifacts (`node_modules/`, `__pycache__/`, `.git/`, `dist/`)

### Disallowed top-level files

Any of these present = finding (Warning):

README.md, README, LICENSE, LICENSE.md, LICENSE.txt, CHANGELOG.md, CHANGELOG,
AGENTS.md, package.json, tsconfig.json, pnpm-lock.yaml, package-lock.json,
yarn.lock, bun.lockb, Makefile, Dockerfile, .eslintrc*, .prettierrc*,
metadata.json, _meta.json, nori.json, skills-lock.json

### Non-standard directories

Any directory other than `scripts/`, `references/`, `assets/` = finding (Warning):

`rules/`, `templates/`, `examples/`, `src/`, `test/`, `tests/`, `docs/`,
`lib/`, `dist/`, `.github/`

### Bare markdown files

Any `.md` file at top level other than `SKILL.md` should be in `references/`.

## 2. SKILL.md Format

- [ ] File starts with `---` (YAML frontmatter delimiter)
- [ ] Frontmatter closed with second `---`
- [ ] YAML parses without errors
- [ ] Frontmatter is a YAML mapping (not list or scalar)

## 3. Required Frontmatter: `name`

- [ ] Present and non-empty string
- [ ] 1–64 characters after NFKC normalisation
- [ ] All lowercase
- [ ] Only: Unicode lowercase letters, digits, hyphens
- [ ] Does not start with hyphen
- [ ] Does not end with hyphen
- [ ] No consecutive hyphens (`--`)
- [ ] No underscores, spaces, dots, or other punctuation
- [ ] Matches parent directory name exactly

## 4. Required Frontmatter: `description`

- [ ] Present and non-empty string
- [ ] 1–1024 characters
- [ ] Describes what the skill does (capability)
- [ ] Describes when to use it (trigger conditions)
- [ ] Includes specific keywords for task matching
- [ ] Does not contain XML tags

## 5. Optional Frontmatter Fields

### `allowed-tools` (if present)

- [ ] Is a space-delimited **string** (not YAML array)
- [ ] Format: `ToolName(pattern) ToolName` or just `ToolName`

### `compatibility` (if present)

- [ ] Is a string, 1–500 characters
- [ ] Describes environment requirements only

### `metadata` (if present)

- [ ] Is a YAML mapping (key-value pairs)
- [ ] Keys and values are strings

### `license` (if present)

- [ ] Is a string (license name or filename reference)

## 6. Disallowed Frontmatter Fields

Any field not in `{name, description, license, compatibility, metadata, allowed-tools}` = Error.

Check for these common offenders:

- [ ] No `references` field
- [ ] No `user-invocable` field
- [ ] No `argument-hint` field
- [ ] No `version` at top level (use `metadata.version`)
- [ ] No `author` at top level (use `metadata.author`)
- [ ] No `tags` at top level (use `metadata.tags`)

## 7. Body Content

- [ ] Under 500 lines
- [ ] Imperative mood ("Extract text" not "You should extract text")
- [ ] File references use relative paths (forward slashes)
- [ ] Referenced files actually exist
- [ ] References one level deep (no A → B → C chains)
- [ ] No "you should", "make sure to", "don't forget" phrasing

## 8. Scripts (if `scripts/` exists)

- [ ] No interactive prompts (TTY input hangs agents)
- [ ] Each script supports `--help`
- [ ] `--help` includes: description, flags, examples, exit codes
- [ ] Structured output (JSON/CSV) to stdout
- [ ] Diagnostics/progress to stderr
- [ ] Meaningful exit codes (different codes for different failures)
- [ ] Idempotent where possible
- [ ] `--dry-run` for destructive operations
- [ ] Dependencies pinned to versions
- [ ] SKILL.md documents each script with invocation example

## 9. Progressive Disclosure

- [ ] SKILL.md focuses on core workflow and decision frameworks
- [ ] Detailed reference material in `references/`, not SKILL.md body
- [ ] Scripts in `scripts/`, not inline in SKILL.md
- [ ] Templates/schemas in `assets/` if applicable
- [ ] Agent handles the common case without loading all files

## Severity Levels

| Severity | Meaning | Examples |
|----------|---------|---------|
| Error | Fails spec validation, breaks tooling | Missing name, invalid chars, unknown fields, YAML array for allowed-tools |
| Warning | Spec-compliant but degrades quality | >500 lines, vague description, README present, non-standard dirs |
| Info | Improvement opportunity | Missing --help, could benefit from references/ split |
