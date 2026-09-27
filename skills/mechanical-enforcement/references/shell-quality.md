# Shell Quality Gates

Linter picks, correctness rules, and copy-paste hook and CI patterns for POSIX
`sh`, Bash, zsh and PowerShell. Classify files by shebang or extension first; do
not run zsh code through ShellCheck as bash.

Dialect support (verified 2026-06-26):

- ShellCheck supports Bourne-family dialects such as `sh`, `bash`, `dash`,
  `ksh`, and `busybox`; it does **not** support zsh.
- `shfmt` supports `bash`, `posix`, `mksh`, `bats`, and `zsh` dialects.
- `shfmt`/`zsh -n` are syntax/format gates, not semantic tests.

## Picks

Reach for the **Also** column only when the **Lint** tool cannot express the rule.

| Stack | Format | Lint | Also | Notes |
|---|---|---|---|---|
| Shell / POSIX `sh` | shfmt `-ln=posix` | ShellCheck `--shell=sh` | checkbashisms, multi-shell runtime tests | Use for portable `.sh`. |
| Bash | shfmt `-ln=bash` | ShellCheck `--shell=bash` | bats-core for black-box CLI tests | Bats is Bash-based, so it suits CLI contracts and Bash scripts. |
| zsh | shfmt `-ln=zsh` | - | `zsh -n`, isolated zsh runtime tests | Parser and format checks plus native tests are the whole gate. |
| PowerShell | PSScriptAnalyzer `Invoke-Formatter` | PSScriptAnalyzer `Invoke-ScriptAnalyzer -EnableExit` | the `PSUseCompatible*` rules plus a grep for the OS automatic variables (the 5.1-floor rule below); Pester for behaviour tests | Target the Windows PowerShell 5.1 floor, see [PowerShell](#powershell). |

## Correctness rules

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| POSIX scripts stay POSIX | `shellcheck --shell=sh`, `checkbashisms`, tests under target shells such as `dash`, `busybox sh` and `bash --posix` | Bashisms and portability drift | ShellCheck's `sh` dialect means POSIX `sh`, not whatever `/bin/sh` points to locally. |
| Bash scripts pass static analysis | `shellcheck --shell=bash`, `shfmt -ln=bash --diff` | Quoting, globbing, parse, and maintainability footguns | Keep ShellCheck disables narrow and documented. |
| zsh parses cleanly | `zsh -n`, `shfmt -ln=zsh --diff` | Syntax and formatting drift | - |
| Tab-separated records are split, not `read` | convention + review; no linter | Interior empty fields collapsing, so every later field silently holds its neighbour's value | zsh: `"${(@ps:\t:)rec}"`. ShellCheck has no zsh dialect and ast-grep no zsh grammar, so the only mechanical option is a text assertion - and that is a gate only on an already-clean tree. See [zsh](#zsh). |
| PowerShell stays on the 5.1 floor | `PSUseCompatibleSyntax`/`Commands`/`Types` against the bundled 5.1 profile at Error severity, plus a grep failing on `$IsWindows`/`$IsMacOS`/`$IsLinux` outside the one OS-detection file | 7-only syntax, cmdlets, types and automatic variables absent in Windows PowerShell 5.1 breaking silently on a stock Windows | The compat rules cover syntax, commands and types but **not** automatic variables, hence the grep. Back them with a dynamic 5.1 smoke, `powershell.exe -File …`, since static analysis cannot see a `$null` deref. |
| Shell tests are hermetic | Test harness owns `PATH`, temp dirs, `HOME`/`ZDOTDIR`, and shell options | Ambient-machine failures | Exact harness patterns belong to the testing skill; this skill gates the invariant. |

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

### `IFS=$'\t' read` silently drops interior empty fields

Tab is IFS *whitespace*, so `read` collapses a run of tabs into a single
separator: every interior empty field disappears and each later field shifts
left. Same result in zsh 5.9.2, GNU bash 5.3.15 and Apple bash 3.2.57 (macOS
arm64, verified 2026-09-02):

```console
$ rec=$'a\t\tc\t\t\tf\t'          # 7 fields: a, "", c, "", "", f, ""
$ IFS=$'\t' read -r f1 f2 f3 f4 f5 f6 f7 <<< "$rec"
[a][c][f][][][][]                  # 3 values - c and f shifted two places left
```

The idiom looks safe because with a **non-whitespace** IFS it is completely
correct:

```console
$ rec="a::c:::f:"; IFS=: read -r f1 f2 f3 f4 f5 f6 f7 <<< "$rec"
[a][][c][][][f][]                  # all 7, empties intact
```

So `IFS=: read` - the `/etc/passwd` idiom everyone learns - is sound, and
carrying it over to tab-separated records is not. `read -r -A arr` does not
rescue it: same collapse, `n=4`.

Fix: split with zsh's parameter-expansion flags rather than `read`.

```console
$ f=("${(@ps:\t:)rec}"); print -r -- "n=${#f}"
n=7                                # [a][][c][][][f][]
```

Both flags are required. `@` inside double quotes is what preserves empty
elements. `p` is what makes the separator an actual tab: the flag's argument is
not escape-processed, so `"${(@s:\t:)rec}"` returns **one** field - the whole
record. Plain `${(s:\t:)rec}` is the trap from the other direction, dropping
empties.

The damage is positional, not local. One empty field early shifts every field
after it, so it surfaces as a wrong value in a distant variable - never as an
error, and never at the parse site. A real instance: a tmux-pane serialiser
whose record was `pane_id  title  pid  command  path`, where an untitled pane
collapsed the line and the pid landed in the title slot, saving no command at
all. The fix taken was to stop *producing* the empty field, which left the
parse - and the other 40 sites spelling the same idiom - exposed. Fixing the
producer treats one field of one record; the parse is the thing that generalises.

Do not audit with `grep -rF "IFS=\$'\t' read"`. Three spellings a literal grep
misses, and the third hides the largest cluster in this tree: `IFS="$(printf
'\t')"`, a tab typed literally into the assignment, and `IFS=$d` where the same
file earlier set `d=$'\t'` (tmux-resurrect's `save.sh` hides thirteen sites that
way). A checker has to parse the assignment's value, not match its text.

### Fix the separator, not the split

Splitting correctly at every consumer is the wrong layer. It leaves the record
format hazardous, and it does not port: `"${(@ps:\t:)rec}"` is zsh-only, and the
POSIX equivalent is a verbose per-field `${line%%"$sep"*}` walk - more code at
every site, and a tab *inside* a field still breaks the record.

Change the separator to **US (0x1f)** instead. It is non-whitespace, so plain
`IFS=<US> read -r` preserves empty interior fields - the `/etc/passwd` behaviour
above - with no escaping and no decoder. Verified in every dialect this tree
uses: `/bin/sh` and `/bin/bash` (Apple bash 3.2.57), nix bash 5.3.15, dash and
zsh 5.9.2, and in the `while IFS=… read` loop shape over a pipe. Every other
consumer handles it too, each checked against a record with an empty interior
field: `awk -F '\037'` (awk reads the octal escape), `sort -t`, `cut -d`, fzf's
`--delimiter`, and jq's `split("\u001f")` / `join($sep)`. tmux emits the byte
verbatim from `display-message -p` and `list-panes -F`, unchanged under
`en_GB.UTF-8`, `C`, `POSIX` and a stripped locale.

Two mechanics matter.

**Never type the byte.** A raw control byte in tracked source is its own hazard:
git can classify the file binary, and a staged-diff gate then has no bytes to
scan. Spell it `$'\037'` in bash and zsh. `#!/bin/sh` files cannot - dash leaves
`$'\037'` as the literal four characters `$\037` - so they take one
`_US=$(printf '\037')` at the top, which is how those files already spelled the
tab.

**Producer and consumers change together.** That is safe because a mismatch
fails loudly - one field instead of seven - rather than shifting silently.

### Rejected: tmux's `#{qa:}`

`#{qa:}` escapes a value as a *command argument*, so it quote-wraps rather than
passing through:

| input | `#{q:}` | `#{qa:}` |
| --- | --- | --- |
| `plain` | `plain` | `plain` |
| `has space` | `has\ space` | `"has space"` |
| `a<TAB>b` | `a<TAB>b` | `a\tb` |
| *(empty)* | *(empty)* | `''` |
| `new<LF>line` | `new<LF>line` | `new\nline` |

It fixes both failure modes, but every consumer then needs shell-unquoting plus
`\t`/`\n` un-escaping - an `eval`-shaped step at every site, for a hazard no
observed bug involved. `#{q:}` is no help at all: it leaves a real tab intact.

### The gate

ShellCheck has no zsh dialect and ast-grep has no zsh grammar, so the only
option is an assertion over the tree - which is a gate only once the tree is
already clean. That is why this sat on convention plus review for so long:
landing one against the offending files would have been the ratcheting failure
this skill warns about.

`.config/tmux` is clean, so `.hk-hooks/tsv-separator-lint.py` gates it
(`hk.pkl`, `tsv-separator-lint`): per-file over `.config/tmux/**`, flagging a
tab-valued `IFS` in all four spellings including the indirect one. It parses
each assignment's value rather than matching text, and scans only shell files
so prose about the rule is not itself a finding. The checker reports 32 sites
against the pre-migration tree and none after it.

The fourteen sites the same checker finds in `.config/zsh/functions/**` (across
`wt-clean`, `tsp`, the three usage functions, `mcpz`, `rl-kill` and
`claude-session-adopt`) stay **convention-only**: none has been judged for a
nullable interior field, so a gate over them would be exactly the ratchet
against an unclean tree. Clean a subtree first, then extend the glob.

## PowerShell

Target the Windows PowerShell 5.1 floor whenever the script must run on a stock
Windows. The default shell there is `powershell.exe` 5.1, not pwsh 7, so 5.1 is
the pwsh analogue of the bash-3.2 contract. The floor rules out ternary `?:`,
`??`, `&&`/`||` and `ForEach-Object -Parallel`, plus every cmdlet and type 7 added.

- Point `PSUseCompatibleCommands` and `PSUseCompatibleTypes` at the bundled 5.1
  profile `win-8_x64_10.0.14393.0_5.1.14393.2791_x64_4.0.30319.42000_framework`,
  the full `compatibility_profiles` filename base; the short `desktop-5.1.*`
  alias does not resolve in PSScriptAnalyzer 1.25.
- `-EnableExit` is required. Without it `Invoke-ScriptAnalyzer` exits 0 even
  with findings, so the gate passes a failing script.
- Keep configuration in a `PSScriptAnalyzerSettings.psd1` so the hook and CI read
  the same rules and severities.
- Run tests under pwsh 7 with Pester 5. The compat gate enforces the 5.1 floor,
  not the test runtime.

## hk placement

Typical placement, tier 1 format, tier 2 lint gate, tier 4 behaviour tests:

```text
POSIX sh   → shfmt -ln=posix --diff ; shellcheck --shell=sh, checkbashisms ; parse and run under each target shell
Bash       → shfmt -ln=bash --diff  ; shellcheck --shell=bash ; bats-core, ShellSpec, cram, or a project shell smoke
zsh        → shfmt -ln=zsh --diff   ; zsh -n ; native zsh behaviour tests
PowerShell → PSScriptAnalyzer Invoke-Formatter ; Invoke-ScriptAnalyzer -EnableExit ; Pester
```

Keep ShellCheck suppressions local and reasoned:

```sh
# shellcheck disable=SC2086 # intentional word splitting: user-supplied flags
set -- $EXTRA_FLAGS "$@"
```
