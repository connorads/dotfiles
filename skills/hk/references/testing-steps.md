# Testing hk steps (`tests {}` + `hk test`)

Every hk step fails **open**: a glob that matches nothing exits 0, so a checker
that has quietly stopped detecting anything is indistinguishable from a clean
tree. A `tests {}` block on the step is what tells the two apart. `hk test` runs
them all; `Builtins.hk_test` wires that into the hook so they run whenever
`hk.pkl` is staged.

Available since hk 1.51.0.

- [The fields](#the-fields)
- [Fixture paths must be sandboxed](#fixture-paths-must-be-sandboxed)
- [Testing a whole-repo checker](#testing-a-whole-repo-checker)
- [Globs and `{{files}}`](#globs-and-files)
- [Wiring it into the hook](#wiring-it-into-the-hook)
- [Builtins bring their own tests](#builtins-bring-their-own-tests)
- [Strip the git environment](#strip-the-git-environment)

## The fields

```pkl
["my-step"] {
    glob = List("**/*.sh")
    check = "bash .hk-hooks/my-check.sh {{files}}"

    tests {
        ["a bad file fails"] {
            run = "check"                       // "check" | "fix" | "command"
            write { ["{{tmp}}/bad.sh"] = "..." } // inline fixtures
            before = "chmod +x {{tmp}}/bad.sh"   // runs after write
            files = List("{{tmp}}/bad.sh")       // what renders {{files}}
            expect {
                code = 1
                stderr = "must be executable"    // substring match
            }
        }
    }
}
```

| Field | Meaning |
|---|---|
| `run` | `check`, `fix`, or `command`. Defaults to `check` |
| `write` | Inline files to create in the sandbox, path to contents |
| `before` | Shell command run after `write`, before the step's own command |
| `after` | Shell command run after the step, before expectations are checked |
| `files` | Explicit list rendering `{{files}}`. Defaults to the `write` keys |
| `fixture` | A path copied into the sandbox instead of inline `write` |
| `env` | Extra environment variables for this test |
| `tmpdir` | Force sandbox on/off. Auto-detected from `{{tmp}}` when unset |
| `expect.code` | Expected exit code, default 0 |
| `expect.stdout` / `expect.stderr` | Substring that must appear |
| `expect.files` | Path to **full** expected contents, exact match |

## Fixture paths must be sandboxed

A bare relative fixture path with no `tmpdir = true` writes the fixture **into
the work tree and leaves it there**. Verified on 1.51.0: a test writing
`fixture-marker.txt` left that file in the repo after a green `hk test`.

Where the work tree is `$HOME` - a dotfiles repo using the git-dir/work-tree
split - that is destructive rather than untidy. `write { [".npmrc"] = "..." }`
overwrites the real `.npmrc`.

Two spellings avoid it. Prefer the first:

```pkl
write { ["{{tmp}}/file.md"] = "..." }   // {{tmp}} auto-detects the sandbox
```

```pkl
tmpdir = true                            // explicit; then a bare name is safe
write { ["file.md"] = "..." }            // this is what the builtins do
```

Tests also run in parallel, so two of them sharing one bare path race for the
same file. A `{{tmp}}` path is per-test.

## Testing a whole-repo checker

A `{{tmp}}`-scoped fixture makes hk run the step **from the sandbox directory**,
which is the only reason a cwd-relative whole-repo checker is testable at all:
the checker reads the sandbox's files rather than the real ones.

That leaves the checker itself outside the sandbox. `{{root}}` is the repo root
and keeps pointing there inside a test, so `before` copies the single source in
rather than duplicating it into the fixture:

```pkl
["quarantine-drift"] {
    check = "python3 .hk-hooks/quarantine-drift.py"   // no {{files}}

    tests {
        ["one config out of step fails"] {
            run = "check"
            write { ["{{tmp}}/.npmrc"] = "min-release-age=9\n" }
            before = "mkdir -p .hk-hooks && cp {{root}}/.hk-hooks/quarantine-drift.py .hk-hooks/"
            expect {
                code = 1
                stderr = "min-release-age"
            }
        }
    }
}
```

`{{root}}` expands in a step's own `check` too.

Prove the test discriminates: break the checker so it always passes, run
`hk test`, and confirm the matching cases go red. A test that never fails is
the same fail-open it was written to close.

## Globs and `{{files}}`

The step's `glob` does **not** decide whether a test runs - a step with a glob
matching nothing still runs its tests. But the glob **is** applied when
rendering `{{files}}`, so a fixture the glob excludes reaches the command as
nothing at all.

That combination bites when a step narrows an inherited glob. `Builtins.fix_smart_quotes`
ships tests writing `file.txt`; narrowing the step to `**/*.md` filtered that
fixture out, `{{files}}` rendered empty, and `hk util fix-smart-quotes` exited 2
on its own usage error - a failure about the harness, not the checker.

So a test pins a glob only by asserting a fixture reached the command.

## Wiring it into the hook

```pkl
["hk-test"] = (Builtins.hk_test) {}
```

Its glob is `hk.pkl` / `.config/hk.pkl`, so the suite runs whenever the config
is staged.

## Builtins bring their own tests

Adding that step activates **every** builtin's bundled tests, not just the ones
you wrote. Two classes fail on contact:

- **Tests invalidated by your own override.** Narrowing a `glob` or `types`
  breaks fixtures written for the unscoped builtin (the `fix_smart_quotes` case
  above). Replace them with equivalents scoped to your step - same coverage, now
  describing what you actually run.
- **Tests pinned to a tool version you do not have.** `Builtins.rumdl`'s fix
  cases assert an MD007 reindent that rumdl 0.2.52 no longer performs;
  `Builtins.zizmor`'s fixtures all write `uses: actions/checkout@v4`, which
  zizmor 1.29's unpinned-uses policy flags, so even the "good" fixture exits 14.
  Neither says anything about your wiring. Drop them, with the reason at the
  step:

  ```pkl
  ["zizmor"] = (Builtins.zizmor) {
      // Upstream's fixtures use an unpinned action, which the pinned zizmor
      // flags; our own workflows are SHA-pinned and the step passes on them.
      tests = new {}
  }
  ```

  `tests {}` amends the inherited mapping and clears nothing. `tests = new {}`
  replaces it.

## Strip the git environment

A test's `before` runs bare `git` with whatever git environment the hook
inherited. `Builtins.actionlint`'s tests carry `before = "git init"`.

In a dotfiles repo whose wrapper exports `GIT_DIR`/`GIT_WORK_TREE`, hk hands
that environment to every step - and `GIT_DIR` beats cwd discovery, so running
in a sandbox directory is no defence. At commit time that `git init`
re-initialised the real repo and tried to rewrite `core.filemode` in it; it
failed only because the commit in progress held the config lock.

```pkl
["hk-test"] = (Builtins.hk_test) {
    check = "env -u GIT_DIR -u GIT_WORK_TREE hk test --quiet"
}
```
