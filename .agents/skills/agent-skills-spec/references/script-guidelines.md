# Script Guidelines

Complete guide for writing spec-compliant scripts in agent skills.

## Hard Requirements

Non-negotiable. Violations cause agent hangs or failures.

### No interactive prompts

Agents run in non-interactive shells. They cannot respond to:
- `input()` / `raw_input()` (Python)
- `read` without timeout (Bash)
- `readline()` (Node.js)
- Confirmation dialogs, password prompts, TUI menus

Every input must come from CLI flags, environment variables, or stdin pipes.

### Self-documenting with `--help`

Agents discover script interfaces through `--help` output. Include:
1. One-line description
2. Usage pattern with required and optional arguments
3. Available flags with defaults
4. 2–3 usage examples
5. Exit codes

Keep `--help` concise — output enters the agent's context window.

```
Usage: scripts/process.py [OPTIONS] INPUT_FILE

Process input data and produce a summary report.

Options:
  --format FORMAT    Output format: json, csv, table (default: json)
  --output FILE      Write output to FILE instead of stdout
  --verbose          Print progress to stderr
  --dry-run          Preview changes without applying

Exit codes:
  0  Success
  1  Invalid arguments
  2  Input file not found
  3  Processing error

Examples:
  scripts/process.py data.csv
  scripts/process.py --format csv --output report.csv data.csv
```

## Interface Design

### CLI flags for all input

Use argument parsing libraries:
- **Python**: `argparse` (stdlib) or `click`
- **Bash**: `getopts` or manual flag parsing
- **Node.js**: `commander`, `yargs`, or `parseArgs`

### Reject ambiguous input

Fail with a clear error rather than guessing:

```python
if args.format not in VALID_FORMATS:
    print(f"Error: --format must be one of: {', '.join(VALID_FORMATS)}.", file=sys.stderr)
    print(f"       Received: \"{args.format}\"", file=sys.stderr)
    sys.exit(1)
```

### Use closed sets

Constrain choices where possible:

```python
parser.add_argument("--env", choices=["dev", "staging", "prod"], required=True)
```

### `--dry-run` for destructive operations

```python
if args.dry_run:
    print(json.dumps({"action": "delete", "target": args.file, "dry_run": True}))
    sys.exit(0)
```

### Safe defaults

Destructive operations require explicit confirmation:

```python
parser.add_argument("--confirm", action="store_true",
    help="Required for destructive operations")

if not args.confirm:
    print("Error: --confirm required for delete operations.", file=sys.stderr)
    sys.exit(1)
```

## Output Design

### Structured output to stdout

Prefer JSON (or CSV/TSV for tabular data):

```python
import json
result = {"name": "my-service", "status": "running"}
print(json.dumps(result))
```

### Diagnostics to stderr

Progress, warnings, debug info go to stderr:

```python
import sys
print("Processing file...", file=sys.stderr)
print('{"result": "ok"}')  # clean stdout for piping
```

### Predictable output size

Agent harnesses may truncate beyond 10–30K characters:
- Default to summary output
- Support `--offset` and `--limit` for pagination
- Support `--output FILE` for large results

## Error Handling

### Helpful error messages

Tell the agent what went wrong, what was expected, and what to try:

```
Error: --format must be one of: json, csv, table.
       Received: "xml"
```

Not: `Error: invalid input`

### Meaningful exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Invalid arguments / usage error |
| 2 | Input not found / I/O error |
| 3 | Processing error |
| 4 | Authentication / permission error |

Document in `--help`.

## Dependency Management

### Self-contained scripts

Declare dependencies inline:

**Python (PEP 723):**

```python
# /// script
# dependencies = [
#   "beautifulsoup4>=4.12,<5",
# ]
# requires-python = ">=3.11"
# ///
```

Run with `uv run scripts/extract.py`.

**Deno:**

```typescript
import * as cheerio from "npm:cheerio@1.0.0";
```

### Pin versions

Always pin for reproducibility:
- Python: `"beautifulsoup4>=4.12,<5"` (not `"beautifulsoup4"`)
- npm: `npx eslint@9.0.0` (not `npx eslint`)
- Go: `go run tool@v1.2.3` (not `go run tool@latest`)

### State prerequisites

In SKILL.md, document what each script needs:

```markdown
**Requirements:** Python 3.11+, uv
```

For runtime-level requirements, use the `compatibility` frontmatter field.

## Execution Context

### Relative paths from skill root

Reference other skill files with relative paths:

```python
import pathlib
skill_root = pathlib.Path(__file__).parent.parent
template = skill_root / "assets" / "template.json"
```

### Forward slashes only

Always use forward slashes, even on Windows:
- `scripts/helper.py` (correct)
- `scripts\helper.py` (wrong)

### SKILL.md documentation

For each script, document in SKILL.md:

```markdown
## Scripts

- **scripts/validate.sh** — Validate configuration files
- **scripts/process.py** — Process input data (run with `uv run`)
```

Make clear whether the agent should execute or read as reference.

## Idempotency

Design scripts so running them twice produces the same result:
- "Create if not exists" instead of "create and fail on duplicate"
- "Upsert" instead of "insert"
- Check current state before making changes

## Checklist

- [ ] No interactive prompts
- [ ] `--help` with usage, flags, examples, exit codes
- [ ] Structured output (JSON/CSV) to stdout
- [ ] Diagnostics to stderr
- [ ] Meaningful exit codes
- [ ] Dependencies pinned
- [ ] Self-contained (inline deps or documented requirements)
- [ ] Idempotent where possible
- [ ] `--dry-run` for destructive operations
- [ ] `--confirm` for irreversible operations
- [ ] Forward slashes in all paths
- [ ] Documented in SKILL.md with invocation example
