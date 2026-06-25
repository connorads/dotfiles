# Shell Quality Gates

Use these as copy-paste starting points for hooks and CI. Classify files by
shebang/extension first; do not run zsh code through ShellCheck as bash.

Validated facts to preserve:

- ShellCheck supports Bourne-family dialects such as `sh`, `bash`, `dash`,
  `ksh`, and `busybox`; it does **not** support zsh.
- `shfmt` supports `bash`, `posix`, `mksh`, `bats`, and `zsh` dialects.
- `shfmt`/`zsh -n` are syntax/format gates, not semantic tests.

## POSIX `sh`

```sh
# Format / parse with POSIX syntax.
find scripts -type f -name '*.sh' -exec shfmt -ln=posix -d {} +

# Static analysis for POSIX sh, independent of the local /bin/sh.
find scripts -type f -name '*.sh' -exec shellcheck --shell=sh {} +

# Extra bashism detector for scripts intended to stay portable.
find scripts -type f -name '*.sh' -exec checkbashisms --force {} +
```

Behaviour still needs runtime coverage under the shells you claim to support:

```sh
for shell in dash 'busybox sh' 'bash --posix'; do
  $shell ./scripts/example.sh --help >/dev/null
done
```

## Bash

```sh
find scripts -type f -name '*.bash' -exec shfmt -ln=bash -d {} +
find scripts -type f -name '*.bash' -exec shellcheck --shell=bash {} +

# Bats files have their own shfmt dialect.
find test -type f -name '*.bats' -exec shfmt -ln=bats -d {} +
```

Bats is usually a behavioural test step, not a lint step:

```sh
bats test
```

## zsh

```sh
# Format with zsh syntax support.
find .config/zsh/functions -type f -exec shfmt -ln=zsh -d {} +

# Parse every zsh file/function in a clean zsh parser pass.
find .config/zsh/functions -type f -exec zsh -n {} +
```

For files that source other files or depend on `fpath`, add a behaviour smoke in
the testing layer rather than weakening the parse gate:

```sh
ZDOTDIR=$(mktemp -d) zsh -f -c 'fpath=(./.config/zsh/functions $fpath); autoload -Uz my-fn; my-fn --help >/dev/null'
```

## hk placement

Typical placement:

```text
tier 1 (format/check) → shfmt -d for the relevant dialect
tier 2 (lint/gate)   → shellcheck/checkbashisms for POSIX/bash; zsh -n for zsh
tier 4 (test)        → bats, ShellSpec, cram, or project-specific shell smoke tests
```

Keep ShellCheck suppressions local and reasoned:

```sh
# shellcheck disable=SC2086 # intentional word splitting: user-supplied flags
set -- $EXTRA_FLAGS "$@"
```
