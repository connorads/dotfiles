# Explicit payload filters for skill trees and bundles

## Context

`skl` previews, loads, copies, and inlines a skill by showing files under the skill
directory. That raw sibling walk can contain generated/cache artefacts such as
`scripts/__pycache__`, `.pyc` files, `.DS_Store`, `.git`, `.claude`, `.rumdl_cache`,
`*.backup`, and `node_modules`. These files are usually noise for an agent and make inline
bundles larger than the useful source.

This is not the same problem Git solves. Git answers "what should this repository track?"
`skl` answers "what should an agent see as the skill payload?"

## Decision

Apply explicit payload filters before rendering trees or reading inline bundle files.

Built-in excludes:

```json
[
  "**/.DS_Store",
  "**/.git/**",
  "**/.claude/**",
  "**/.rumdl_cache/**",
  "**/__pycache__/**",
  "**/*.py[cod]",
  "**/*.backup",
  "**/node_modules/**"
]
```

Config can add excludes at two levels:

```json
{
  "exclude": ["**/.venv/**"],
  "paths": [
    {
      "path": "~/.config/skills/vendor/.agents/skills",
      "name": "vendor",
      "exclude": ["**/tmp/**"]
    }
  ]
}
```

Effective excludes are built-ins + top-level `exclude` + source-level `exclude`. Patterns
use Bun glob syntax against paths relative to the skill directory. `SKILL.md` is always
retained, even if a pattern would otherwise match it.

Add `--all` as the escape hatch for a single invocation. It disables payload excludes for
`preview`, `inline`, `load`, `load --copy`, and `load --stdin`. It does not change source
discovery.

## Considered Options

- **Use `.gitignore` automatically**: rejected for v1. Git ignore files can contain
  negation, comments, directory anchoring, inherited parent rules, and repo-specific
  tracking intent. Implementing that faithfully is a larger contract, and using it
  partially would be misleading.
- **Built-ins only**: rejected. Defaults handle common noise, but users need source-local
  control for generated assets or caches specific to a skill catalogue.
- **Broad build-dir defaults such as `dist`, `coverage`, `.venv`**: rejected for v1.
  Those names can be meaningful source payloads for some skills. Users can exclude them
  explicitly.

## Consequences

- Trees, loaded/copied pointers, and inline bundles now show the useful payload by
  default.
- Binary sniffing remains unchanged and only runs for files that survive payload filters.
- The config schema grows optional `exclude` arrays, but source discovery remains the
  same ordered `paths` model.
- `.gitignore` support is deliberately deferred until there is a concrete need and a
  faithful parser choice.
