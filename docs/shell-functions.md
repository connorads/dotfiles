# Shell functions

## Dual-mode functions (PATH commands)

Most functions in `~/.config/zsh/functions/` are **dual-mode**: they work as zsh autoload functions in interactive shells AND as regular executables callable from any shell (bash, agent subprocesses, scripts).

**Shebang = opt-in to PATH**: a `#!/usr/bin/env zsh` shebang on line 1 marks a function as dual-mode. `zfn-link` creates symlinks in `~/.local/bin/` for every file with this shebang, so agents can call them directly without `zsh -lc`.

**File structure:**

```text
#!/usr/bin/env zsh           # ← present = dual-mode (PATH command)
# <name>: <purpose>
# alias: <alias>             # if applicable
emulate -L zsh               # ← ensures consistent zsh behaviour as script
...
```

Zsh-only files drop the shebang and instead carry a `# zsh-only: <reason>`
marker directly under the header (see below).

**When to add shebang (dual-mode):** Add when the function does NOT:

- `cd` into a directory (would affect calling script, not caller's shell)
- `export` variables into the caller's environment
- `source` files into the caller's shell
- Use `print -z` (zsh command buffer injection)
- Define completions (`compdef`, `compadd`, `add-zsh-hook`, `_*` prefix)

**Zsh-only functions** (no shebang, autoload only) self-declare with a
`# zsh-only: <reason>` marker in their first lines - reasons follow the list
above (cd / export / source / print -z / completion), plus sourced libs and
launchd-managed daemons. List them with:

```bash
grep -rl '^# zsh-only:' ~/.config/zsh/functions
```

**Enforcement**: the `zsh-fn-header` hk step checks every file under
`.config/zsh/functions/` for the `# <name>: <purpose>` header and requires
shebang XOR `# zsh-only:` marker (script: `~/.hk-hooks/zsh-fn-header-check.sh`,
tests: `~/.config/zsh/tests/zsh-fn-header.bats`).

## Managing symlinks

```bash
zfn-link              # sync ~/.local/bin/ symlinks (after adding/removing shebangs)
zfn-link --dry-run    # preview changes without applying
zfn-link --verbose    # show each created/removed/unchanged symlink
```

Run `zfn-link` and commit after adding a shebang to a new function.

## Agent usage

Agents can call these commands directly - no `zsh -lc` wrapper needed:

```bash
bash -c 'ts status'       # works via ~/.local/bin/ts
bash -c 'killport 3000'   # works via ~/.local/bin/killport
```

Interactive zsh: autoload takes precedence over PATH (`whence -w killport` → `function`).

## Other conventions

- Add a top-of-function comment in `~/.config/zsh/functions/**` using `# <name>: <purpose>` (and `# alias: ...` when needed).
- For behavioural changes to shell functions/scripts, prefer adding or updating Bats tests in `~/.config/zsh/tests/`; run `mise run zsh-tests`.
- Test shell scripts by public behaviour: args, exit status, stdout/stderr, and filesystem effects; use `test_helper.bash` for isolated `HOME`/`PATH`.
- oh-my-zsh git plugin defines ~200 `g*` aliases (e.g. `gcl`, `gco`, `gca`). Run `alias <name>` before creating new `g*` functions/aliases to avoid conflicts.
- Split a tab-separated record with `"${(@ps:\t:)rec}"`, never `IFS=$'\t' read`: tab is IFS whitespace, so `read` collapses runs of tabs and every interior empty field shifts the rest left, silently. This tree is full of TSV-record shell code and 11 live sites are already wrong; mechanism, repro and audit in the `mechanical-enforcement` skill (`references/shell-quality.md`, `## zsh`).
