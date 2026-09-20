# Testing hk steps (`tests {}` + `hk test`)

Use step tests to prove a checker rejects a bad fixture and accepts a good one.
A green hook with no matching files does not prove the checker ran. Tests are
available from hk 1.51.0; the behaviour below is verified on 2026-09-20 against hk 2.0.1.

- [The fields](#the-fields)
- [Fixture paths must be sandboxed](#fixture-paths-must-be-sandboxed)
- [Testing a whole-repo checker](#testing-a-whole-repo-checker)
- [Globs and explicit files](#globs-and-explicit-files)
- [Wiring and test discovery](#wiring-and-test-discovery)
- [Inherited builtin tests](#inherited-builtin-tests)
- [Strip the Git environment](#strip-the-git-environment)
- [Sources](#sources)

## The fields

```pkl
["my-step"] {
    glob = List("**/*.sh")
    check = "bash .hk-hooks/my-check.sh {{files}}"

    tests {
        ["a bad file fails"] {
            run = "check"
            write { ["{{tmp}}/bad.sh"] = "..." }
            before = "mkdir -p .hk-hooks && cp '{{root}}/.hk-hooks/my-check.sh' .hk-hooks/"
            expect {
                code = 1
                stderr = "must be executable"
            }
        }
    }
}
```

| Field | Meaning |
|---|---|
| `run` | `check` or `fix`. Defaults to `check`; `command` is invalid |
| `write` | Paths and inline contents to create before the command |
| `before` | Shell command after `write`, before the step command |
| `after` | Shell command after the step, before expectations |
| `files` | Explicit arguments for `{{files}}`; bypasses step filters in v2.0.1. Omit to filter the `write` keys |
| `fixture` | Directory copied into the test's working directory; set `tmpdir = true` |
| `env` | Extra environment variables for this test |
| `tmpdir` | Force sandbox on/off; otherwise inferred from `{{tmp}}` paths in the selected file list |
| `expect.code` | Expected exit code, default 0 |
| `expect.stdout` / `expect.stderr` | Substring that must appear |
| `expect.files` | Paths and full expected contents, exact match |

## Fixture paths must be sandboxed

Prefer `write { ["{{tmp}}/file.md"] = "..." }`. Without `tmpdir = true`
or a `{{tmp}}` path in `files` (or the `write` keys when `files` is omitted),
hk runs from the repo root. A bare `write` path can overwrite a real file and
remain after the test. Parallel tests can also race on that path.

For fixtures with bare relative paths, set `tmpdir = true` explicitly:

```pkl
tmpdir = true
write { ["file.md"] = "..." }
```

A sandbox changes the working directory; it does not restrict filesystem
access or sanitise inherited environment variables. Avoid absolute write
paths outside `{{tmp}}`.

## Testing a whole-repo checker

A sandboxed test runs its command from the sandbox. `{{root}}` still names the
real repo root, so copy the checker into the sandbox before running it:

```pkl
["quarantine-drift"] {
    check = "python3 .hk-hooks/quarantine-drift.py"
    tests {
        ["one config out of step fails"] {
            write { ["{{tmp}}/.npmrc"] = "min-release-age=9\n" }
            before = "mkdir -p .hk-hooks && cp '{{root}}/.hk-hooks/quarantine-drift.py' .hk-hooks/"
            expect {
                code = 1
                stderr = "min-release-age"
            }
        }
    }
}
```

Prove the test discriminates in a disposable copy: make the checker always
pass, run the test, and confirm the bad-fixture case fails.

## Globs and explicit files

In v2.0.1, omitted `files` means hk filters the `write` keys using the step's
filters. If every written file is excluded, hk fails the test before running
the command with a diagnostic naming the filters. An explicit `files` list
bypasses that filtering, so it cannot prove the step's glob matches a fixture.

When narrowing a builtin's glob or types, replace incompatible inherited
fixtures with matching ones. For example, `fix_smart_quotes` fixtures named
`file.txt` do not exercise a step narrowed to Markdown. Keep `files` omitted
when the test needs to cover file selection.

## Wiring and test discovery

```pkl
["hk-test"] = (Builtins.hk_test) {}
```

The builtin matches `hk.pkl` and `.config/hk.pkl`. Before trusting it, run:

```bash
hk test --list
hk test --step my-step
```

Check that every intended case appears. In v2.0.1, `hk test` skips steps nested
inside `Group`; keep tested steps at hook level and use `depends` for ordering.
Identical step/test pairs shared across hooks are deduplicated.

## Inherited builtin tests

`hk test` includes the configured builtins' tests. Overrides to globs, types or
commands can invalidate their fixtures; test them before copying a workaround.
`tests {}` amends the inherited mapping. `tests = new {}` clears it.

If a tool-version mismatch makes an inherited case invalid, prefer replacing
the test mapping with cases for the configured tool. If clearing it is
necessary, record the exact failing case and tool version beside the override.
There is no per-case skip field in v2.0.1.

Version-specific examples:

- hk 1.56.1's zizmor fixtures use an unpinned checkout action. hk 2.0.1's
  fixtures SHA-pin it, so that old reason for clearing the tests does not apply.
- hk 2.0.1's rumdl fixture `fix bad file violations remain` still expects a
  headingless document to fail after fixes. Check that expectation against the
  installed rumdl before retaining or replacing the case.

## Strip the Git environment

A test's `before` inherits Git variables. Even inside a sandbox, `git init`
can target the real repo when `GIT_DIR` or `GIT_WORK_TREE` is set. For a
repo wrapper that exports those variables, sanitise the nested test process.

For v2, amend the builtin command to preserve its declared `effect = "write"`:

```pkl
["hk-test"] = (Builtins.hk_test) {
    check {
        command = "env -u GIT_DIR -u GIT_WORK_TREE hk test --quiet"
    }
}
```

For v1 maintenance, inspect the tagged builtin's command type too: hk 1.56.1's
`hk_test` also declares a `CommandSpec`. Replacing that object with a plain
string loses its effect metadata. Confirm the override with
`hk check --plan --json --step hk-test hk.pkl`.

## Sources

- [v2.0.1 test schema](https://github.com/jdx/hk/blob/v2.0.1/pkl/Config.pkl)
- [Test execution and filtering](https://github.com/jdx/hk/blob/v2.0.1/src/test_runner.rs)
- [Test discovery](https://github.com/jdx/hk/blob/v2.0.1/src/cli/test.rs)
- [Sandbox tests](https://github.com/jdx/hk/blob/v2.0.1/test/hk_test_tmpdir.bats)
- [Zizmor fixtures](https://github.com/jdx/hk/blob/v2.0.1/pkl/builtins/zizmor.pkl)
- [Rumdl fixtures](https://github.com/jdx/hk/blob/v2.0.1/pkl/builtins/rumdl.pkl)
