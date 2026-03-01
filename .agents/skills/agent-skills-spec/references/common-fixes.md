# Common Fixes

## Decision Tree

```
Is the issue in frontmatter?
├── Yes → Frontmatter Fixes below
└── No
    Is the issue in directory structure?
    ├── Yes → Structure Fixes below
    └── No
        Is the issue in SKILL.md body?
        ├── Yes → Body Fixes below
        └── No → Script Fixes below
```

---

## Frontmatter Fixes

### Non-spec frontmatter fields

**Symptom:** `skills-ref validate` reports unexpected fields.

**Action by field:**

| Field found | Fix |
|-------------|-----|
| `version` | Move to `metadata.version` |
| `author` | Move to `metadata.author` |
| `tags` | Move to `metadata.tags` |
| `references` | Remove (use directory convention) |
| `user-invocable` | Remove (non-spec) |
| `argument-hint` | Remove (non-spec) |
| Any other | Move to `metadata` or remove |

**Before:**

```yaml
---
name: my-skill
description: Does things
version: "2.0.0"
author: someone
tags:
  - foo
  - bar
references:
  - workers
  - pages
---
```

**After:**

```yaml
---
name: my-skill
description: Does things
metadata:
  version: "2.0.0"
  author: someone
  tags: "foo, bar"
---
```

Note: `metadata` values must be strings. Convert arrays to comma-delimited strings.

### `allowed-tools` as YAML array

**Before:**

```yaml
allowed-tools:
  - Bash(firecrawl *)
  - Bash(npx firecrawl *)
```

**After:**

```yaml
allowed-tools: Bash(firecrawl *) Bash(npx firecrawl *)
```

### Name/directory mismatch

Decide which is correct — directory name or frontmatter name:
- If directory name is intended: update frontmatter `name` to match
- If frontmatter name is intended: rename directory

### Invalid name characters

| Invalid | Fix | Rule |
|---------|-----|------|
| `My-Skill` | `my-skill` | Must be lowercase |
| `my_skill` | `my-skill` | Hyphens only, not underscores |
| `my skill` | `my-skill` | No spaces |
| `-my-skill` | `my-skill` | No leading hyphen |
| `my-skill-` | `my-skill` | No trailing hyphen |
| `my--skill` | `my-skill` | No consecutive hyphens |

### Vague description

**Template:**

```yaml
description: >
  [Action verb] [what it does in specific terms]. Use when [specific trigger
  conditions]. Triggers on [keywords users might say].
```

**Before (vague):**

```yaml
description: Comprehensive platform skill for development
```

**After (specific):**

```yaml
description: >
  Build and deploy on Cloudflare Workers, Pages, D1, KV, R2, and Durable Objects.
  Use for any Cloudflare development task including serverless functions, static
  sites, databases, object storage, and real-time applications.
```

### Description too long (>1024 chars)

1. Remove trigger word lists (keep 3–5 key triggers in natural language)
2. Remove cross-references to other skills (move to SKILL.md body)
3. Focus on primary capability + top 2–3 use cases
4. Remove redundant phrases

---

## Structure Fixes

### README / LICENSE / CHANGELOG present

Delete these files. Agents do not need meta-documentation.

- **README.md**: SKILL.md IS the agent instruction
- **LICENSE**: Use the `license` frontmatter field. If full terms needed: `license: Proprietary. See assets/LICENSE.txt`
- **CHANGELOG**: Remove. Version tracking belongs in git.

### Non-standard top-level markdown files

Move to `references/`:

```bash
mkdir -p references
mv PRACTICAL-TIPS.md references/
mv api_reference.md references/
```

Update references in SKILL.md to use `references/` prefix.

### Non-standard directories

Rename to spec-standard names:

| Found | Rename to |
|-------|-----------|
| `rules/` | `references/` |
| `templates/` | `assets/` |
| `examples/` | `references/` |
| `src/` | `scripts/` or remove |
| `docs/` | `references/` |

### Build artifacts

Remove: `package.json`, `tsconfig.json`, lock files, `node_modules/`, `__pycache__/`, `.git/`

### Scripts at top level

Move into `scripts/`:

```bash
mkdir -p scripts
mv *.py *.sh scripts/
```

Update references in SKILL.md.

---

## Body Fixes

### SKILL.md over 500 lines

1. Count lines: `wc -l SKILL.md`
2. Identify sections to offload (priority order):
   - Complete examples → `references/examples.md`
   - API reference tables → `references/api.md`
   - Edge cases/gotchas → `references/advanced.md`
   - Installation/setup → `references/setup.md`
   - Pattern libraries → `references/patterns.md`
3. Replace offloaded content with one-line reference:

```markdown
For detailed examples, see [references/examples.md](references/examples.md).
```

4. Verify under 500 lines after split
5. Verify all referenced files exist

### Imperative mood violations

| Before | After |
|--------|-------|
| "You should extract the text" | "Extract the text" |
| "The agent needs to validate" | "Validate the output" |
| "It is recommended to use JSON" | "Use JSON output" |
| "Make sure to check the output" | "Check the output" |
| "Don't forget to handle errors" | "Handle errors" |
| "You can use pdfplumber for..." | "Use pdfplumber for..." |

### Deeply nested references

**Symptom:** SKILL.md → references/a.md → references/b.md

**Fix:** Flatten so SKILL.md links directly to all needed reference files. If b.md is important enough to exist, SKILL.md should reference it directly.

---

## Script Fixes

### Interactive prompts

Replace TTY input with CLI flags:

**Before:**

```python
target = input("Target environment: ")
```

**After:**

```python
import argparse
parser = argparse.ArgumentParser()
parser.add_argument("--env", required=True, choices=["dev", "staging", "prod"])
args = parser.parse_args()
```

### Missing `--help`

Add argument parsing with usage documentation:

```python
parser = argparse.ArgumentParser(
    description="Process input data and produce a summary report.",
    epilog="Examples:\n  %(prog)s data.csv\n  %(prog)s --format csv data.csv",
    formatter_class=argparse.RawDescriptionHelpFormatter,
)
parser.add_argument("input", help="Input file to process")
parser.add_argument("--format", choices=["json", "csv"], default="json")
parser.add_argument("--dry-run", action="store_true", help="Preview without changes")
```

### Unstructured output

Replace free-form text with JSON:

**Before:**

```
Name: my-service
Status: running
```

**After:**

```json
{"name": "my-service", "status": "running"}
```

Diagnostics to stderr:

```python
import sys
print("Processing...", file=sys.stderr)
print('{"result": "ok"}')
```
