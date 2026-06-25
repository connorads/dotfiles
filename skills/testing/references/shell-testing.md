# Shell Testing

Use shell tests to prove the public contract: arguments, exit status, stdout,
stderr, files, environment effects, and integration with real command lookup.
Keep static gates (ShellCheck/shfmt/zsh parse checks) in the mechanical-
enforcement skill.

## Tool choice

| Tool | Best fit | Avoid as default when |
|---|---|---|
| `bats-core` | Bash scripts and black-box CLI tests for any Unix program | You need native zsh/POSIX test syntax or deep function-level testing outside Bash |
| `ShellSpec` | Cross-shell function/library testing; bash, ksh, zsh, dash/POSIX shells | The team wants only tiny dependencies or transcript-style examples |
| `shUnit2` | Small/legacy xUnit-style shell suites | New suites need richer assertions, fixtures, or multi-shell ergonomics |
| `cram` / transcript tests | Stable command-output examples and docs-as-tests | Output is noisy, setup is complex, or assertions need structure |
| Plain smoke scripts | Hook/CI sanity checks and bootstrap tests | They start growing their own assertion framework |

Bats is Bash Automated Testing System: Bats tests run as Bash. That is fine for
black-box testing a zsh or POSIX executable as a subprocess, but it does not make
the test body zsh-native or POSIX-native.

## Bats pattern for CLI contracts

```bash
#!/usr/bin/env bats

setup() {
  TEST_TMPDIR="$(mktemp -d)"
  export HOME="$TEST_TMPDIR/home"
  mkdir -p "$HOME"
}

teardown() {
  rm -rf "$TEST_TMPDIR"
}

@test "prints help" {
  run ./bin/tool --help

  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage:"* ]]
}
```

Use helpers such as `bats-support`, `bats-assert`, and `bats-file` when a suite
has enough assertions to justify them.

## ShellSpec pattern for shell functions

ShellSpec can run specs under a chosen shell with `--shell`, which is useful for
cross-shell or zsh-native behaviour.

```sh
# spec/my_fn_spec.sh
Describe 'my_fn'
  Include ./lib/my_fn.sh

  It 'prints a greeting'
    When call my_fn Connor
    The status should be success
    The output should equal 'Hello, Connor'
  End
End
```

Example matrix:

```sh
for shell in dash bash zsh; do
  shellspec --shell "$shell"
done
```

Choose only shells the project actually supports. A zsh project should normally
have at least one `shellspec --shell zsh` or equivalent zsh-native run. For
`bash --posix`, use a small wrapper command if the test runner only accepts a
shell path/name rather than shell arguments.

## zsh isolation

zsh tests should not inherit the developer's interactive shell state.

```sh
run_zsh() {
  local zdotdir fpath_dir
  zdotdir="$(mktemp -d)"
  fpath_dir="$PWD/.config/zsh/functions"

  ZDOTDIR="$zdotdir" zsh -f -c '
    emulate -R zsh
    setopt no_global_rcs
    fpath=("$1" $fpath)
    autoload -Uz my-fn
    my-fn "$2"
  ' zsh "$fpath_dir" "${1:---help}"
}
```

For autoloaded functions, set `fpath` explicitly and call `autoload -Uz`. For
prompt/completion tests, also isolate `HOME`, `ZDOTDIR`, completion dump files,
and any cache directories.

Inside zsh functions, prefer `emulate -L zsh` so options/local state do not leak
between calls.

## POSIX sh portability

A file labelled POSIX needs runtime coverage under real shells, not just
ShellCheck:

```sh
for shell in dash 'busybox sh' 'bash --posix'; do
  $shell ./test/posix-smoke.sh
done
```

Keep the same behavioural assertions and vary only the shell. If a shell is not
part of the support contract, do not test it just because it is installed.

Avoid bash-only constructs in POSIX-targeted code: `[[ ... ]]`, arrays,
`function name`, process substitution, `$RANDOM`, `read -e`, and bash-specific
parameter expansion.

## Faking commands with `PATH`

Prefer PATH-shadow fakes over mocking shell functions when testing command
orchestration:

```sh
fakebin="$(mktemp -d)"
cat >"$fakebin/git" <<'SH'
#!/bin/sh
printf '%s\n' "git $*" >>"$TEST_LOG"
exit 0
SH
chmod +x "$fakebin/git"

TEST_LOG="$(mktemp)" PATH="$fakebin:$PATH" ./script-under-test
```

This exercises the real command lookup and argument passing while avoiding real
network/filesystem side effects.

## Assertion quality

- Assert status, stdout, stderr, and side effects separately when they carry
  different meaning.
- Prefer named examples for bugs and edge cases.
- Keep transcript/golden outputs small; a huge shell snapshot is easy to
  rubber-stamp.
- Do not use retries to hide flaky shell tests. Fix shared temp dirs, ambient
  environment coupling, sleeps, or command lookup races.
