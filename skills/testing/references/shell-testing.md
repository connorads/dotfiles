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

## Speed and determinism

Shell suites are slow for the same reasons they are flaky: real time and real
processes. Profile before optimising — `bats -T` (per-test timing) or
`/usr/bin/time -p bats <file>` to rank the slow files — then attack the biggest
wall-clock items. Wall-clock far above CPU time (`user`+`sys`) means the suite is
*waiting*, not computing; that waiting is the target.

### Run files in parallel

`bats -j "$(nproc)"` (`sysctl -n hw.logicalcpu` on macOS) runs files concurrently —
a large win when the bottleneck is waiting. It needs an external dispatcher: GNU
`parallel` **or** `shenwei356/rush`
(`bats -j N --parallel-binary-name rush`, or `export BATS_PARALLEL_BINARY_NAME=rush`).
Trap: with neither installed, bats silently runs **0 tests and exits 1** —
assert the expected test count in CI rather than trusting the exit code. `-j` enables
across- *and* within-file parallelism; add `--no-parallelize-within-files` when only
whole files are independent.

Parallelism exposes hidden coupling, so design for it: each test must own its
resources. `$BATS_TEST_TMPDIR` is unique per test (safe to write); `$BATS_FILE_TMPDIR`
and `$BATS_SUITE_TMPDIR` are shared. Use unique server/socket names
(`tmux -L "srv-$BATS_TEST_NUMBER"`), OS-assigned ports (bind `:0`), and never a fixed
path. Re-run a parallelised suite a few times to flush ordering dependence before
trusting it.

### Remove time-coupling

The largest single-file speedups usually come from killing fixed waits — which also
removes flakiness. Look in the **code under test**, not just the tests:

- Don't spawn a shell or subprocess to compute what the current shell already knows.
  Resolving a command or alias with `zsh -ic`/`bash -ic` re-sources the whole
  interactive rc (prompt, completion, plugins, version managers) on *every* call —
  0.1–4s normally, tens of seconds when it triggers a completion-cache rebuild, and it
  hits real usage, not just tests. Resolve in-process (`whence`/`type`/`command -v`) and
  fall back to an interactive shell only for the rare word unknown in script mode.
- A poll-with-sleep loop (`for i in {1..20}; do check || sleep 0.05; done`) makes every
  fast test pay the whole loop when the awaited thing never appears. Short-circuit the
  common case — break the moment the outcome is decided (e.g. `kill -0 "$pid" || break`
  once the child is gone). One such fix took a no-op iteration from ~2.6s to ~0.3s.
- Hardcoded cooldowns, debounce windows, and retry backoff should be **injectable** via
  env with the production value as default — `: "${TOOL_DEBOUNCE_SECS:=2}"` — so tests
  drive timing with a small value instead of `sleep`-ing a fixed cushion to "wait long
  enough". A test that sleeps a magic number to outlast a hardcoded delay is both slow
  and racy.
- Reap backgrounded helpers and close their FDs before returning. A watchdog or output
  scanner left holding a pipe open blocks the parent until it dies — one test can
  silently cost tens of seconds with nothing visibly wrong.

Hardcoded environment paths are the related determinism trap: a test that hardcodes
`/home/<user>/...` either fails or hits a slow fallback on another machine. Derive
paths from the fixtures.

### Amortise expensive fixtures — after measuring

Build immutable, costly fixtures **once per file** in `setup_file()` under
`$BATS_FILE_TMPDIR`; give each test its own *mutable* copy cheaply. For git, build a
template repo once and `git clone --local` it per test: the clone hardlinks the object
store but stays self-contained (git objects are append-only, so the clone can commit or
gc without touching the template), preserving per-test isolation. Only hoist state that
is read-only for every test — the moment a test writes to it, it must live per-test
under `$BATS_TEST_TMPDIR`. Avoid `git clone --shared`/alternates: that reintroduces a
shared mutable object store. Amortisation pays only when the fixture is the bottleneck,
so profile first — hoisting a per-test `git init` can save ~20% of the fixture step yet
only ~3% of the file when the real cost is subprocess spawns.

### Tag slow tests and run a fast subset

Mark files that spin up real servers, ptys, git repos, or TTYs with
`# bats file_tags=integration` (a comment before the first test). Run the fast,
fake-only set on every save and keep the full tagged suite for pre-push and CI:

```sh
bats --filter-tags '!integration' tests/   # fast inner loop (unit/faked only)
bats tests/                                 # everything, for pre-push and CI
bats --filter-status failed tests/          # re-run only last run's failures
```

`--filter-status` needs a prior completed run (its run-logs dir must exist). `bats
<file>` and `-f <regex>` narrow further. Splitting a suite this way — fast faked unit
files versus slow real-process integration files — routinely turns a multi-minute
suite into a tens-of-seconds edit loop (one real suite: ~240s serial full → ~20s for
the faked subset, and ~70s for the full suite run in parallel).

## Assertion quality

- Assert status, stdout, stderr, and side effects separately when they carry
  different meaning.
- Prefer named examples for bugs and edge cases.
- Keep transcript/golden outputs small; a huge shell snapshot is easy to
  rubber-stamp.
- Do not use retries to hide flaky shell tests. Fix shared temp dirs, ambient
  environment coupling, sleeps, or command lookup races.
