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

## PowerShell

Target the Windows PowerShell 5.1 floor whenever the script must run on a stock
Windows. The default shell there is `powershell.exe` 5.1, not pwsh 7, so 5.1 is
the pwsh analogue of the bash-3.2 contract. The floor rules out ternary `?:`,
`??`, `&&`/`||` and `ForEach-Object -Parallel`, plus every cmdlet and type 7 added.

- Point `PSUseCompatibleCommands` and `PSUseCompatibleTypes` at the bundled 5.1
  profile `win-8_x64_10.0.14393.0_5.1.14393.2791_x64_4.0.30319.42000_framework`,
  the full `compatibility_profiles` filename base; the short `desktop-5.1.*`
  alias does not resolve in PSScriptAnalyzer 1.25.
- `-EnableExit` is load-bearing. Without it `Invoke-ScriptAnalyzer` exits 0 even
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
