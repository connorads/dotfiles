# Mechanical Enforcement - agent tool gates

The tier below git hooks: a gate that binds the agent's tool call rather than
the repository. What each coding harness's pre-execution hook can and cannot
do, the ask-or-deny convention, the VCS bypass surface a policy has to
enumerate, one worked example, and how to test a guard. Routed from
`SKILL.md`, Secrets & CI hardening. Wiring the git-hook tier is the `hk`
skill's; running an agent in a repository you did not write is the
`supply-chain-hardening` skill's. Verified 2026-09-22 against
code.claude.com/docs/en/hooks and /permissions plus a live probe of Claude
Code 2.1.278, `@earendil-works/pi-coding-agent` 0.85.1 (installed types and
loader), Codex CLI source at tag `rust-v0.154.0` (binary 0.155.1), opencode
1.18.30 source and `@opencode-ai/plugin` 1.18.25.

## Picks

One pure policy function, one thin adapter per harness, a parity check that
holds the copies in agreement, and tests on the policy as data including the
false-positive cases. The policy takes a command string and returns a reason or
nothing; the adapter reads the harness's payload, writes the harness's decision
and exits 0. Gate code has no build step between the file on disk and the
interpreter the harness invokes: plain `.js` or Python for a spawned command,
a `.ts` module only where the harness imports it natively, as pi and opencode
do. The gate's own source sits inside the repository's lint and typecheck
scope, because a hook tree excluded from the linter and absent from every
`tsconfig` has no drift check between the policy and the binding that
describes it.

## What each harness can do

| Harness | Event and command field | Deny channel | `ask` | Rewrite | Fails open on | Working directory and path anchor | Arms on clone |
|---|---|---|---|---|---|---|---|
| Claude Code | `PreToolUse`, matcher `Bash`; `tool_input.command` on stdin | stdout `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": …}}`, or exit 2 with the reason on stderr | Yes; precedence across hooks is `deny` > `defer` > `ask` > `allow` | `updatedInput` replaces the whole input object; pair it with `allow` or `ask` | Any exit code other than 2, and exit 0 with output that fails schema validation: the call proceeds with a `hook error` notice. Default timeout 600 s | Handlers run in the current directory, which moves with the agent; `${CLAUDE_PROJECT_DIR}` is the project root where the session started and holds still inside a worktree | Yes. Hooks in `.claude/settings.json` are "Used" before the folder is trusted, including under `claude -p` |
| pi | `tool_call` extension handler; `event.input.command` when `toolName` is `bash` | return `{ block: true, reason }` | No | Mutate `event.input` in place; later handlers see the mutation and nothing re-validates it | Never: a handler that throws is rethrown as "Extension failed, blocking execution" | A module pi's loader imports; repo-local extensions live under `.pi/extensions/`, user ones under the agent directory | Behind a prompt. A repository with `.pi/extensions/` triggers "Trust project folder?", remembered per path; with no UI and no stored decision the project extensions stay unloaded |
| Codex | `PreToolUse`; `tool_name` `Bash`, `tool_input.command` on stdin | `permissionDecision: "deny"` with a non-empty `permissionDecisionReason`, or exit 2 with non-empty stderr | No. `"ask"` is an invalid output and the call proceeds | `permissionDecision: "allow"` plus `updatedInput`; `allow` alone is invalid. When several hooks rewrite, the one that finishes last wins | Timeout (default 600 s), any exit code other than 0 and 2, exit 2 with empty stderr, stdout that looks like JSON but does not parse, and every invalid output above. An `async` handler never blocks | `$SHELL -lc <command>` in the session's working directory; no project-root variable, so anchor the path yourself | No. A project `.codex/hooks.json` is discovered but its handlers run only once its hash is trusted on that machine (`/hooks` in the TUI) or the run passes `--dangerously-bypass-hook-trust` |
| opencode | `tool.execute.before` plugin hook; `output.args.command` when `input.tool` is `bash` | Throw; the error is the tool result | No | Mutate fields of `output.args`. The same object reaches the tool, so reassigning `output.args` is dropped | No timeout around the hook; a plugin whose factory throws is dropped with a log line and the session runs without it | In-process; `PluginInput.directory` and `worktree` are the anchors | Yes. `.opencode/plugin/*.ts` and `opencode.json` `plugin` entries load on discovery, walking up from the working directory; `OPENCODE_DISABLE_PROJECT_CONFIG` is the opt-out |
| Cursor (unverified beyond its docs, not run here) | `beforeShellExecution` | `{"permission": "deny"}` or exit 2 | Yes | None on this event | `failClosed: true` on the hook definition blocks on crash, timeout, non-zero exit and empty output | Project hooks run from the project root, user hooks from the user config directory | Unknown: the docs fetched say nothing about trust |

## Ask or deny

Ask by default, deny where the gate must hold everywhere.

- **`ask` keeps the deliberate one-off alive.** `bun install --minimum-release-age=0` and `HK_SKIP_STEPS=vitest git commit` are documented escape hatches; a guard that denies them forces the agent to route around the guard, and a routed-around guard teaches nothing. Behind an `ask`, the human confirms once and the reason text says what they are confirming.
- **`deny` is for secret paths and irreversible destruction**, where the gate has to hold under every permission mode and in every headless run. Hook bypass is `ask`.
- **Headless collapses the distinction.** Probed on Claude Code 2.1.278: with `claude -p`, an `ask` was refused with its reason text under the default mode, under `--dangerously-skip-permissions` and under `--permission-mode bypassPermissions`, and a `deny` was refused under bypass. The hooks page documents the refusal only for `PreModelSwitch` ("treats `ask` as a refusal" outside an interactive `/model`) and says nothing about `PreToolUse` in `-p` mode, so the observation is the contract until the docs state one. Whether `ask` holds in an interactive bypass session is untested here.
- **Codex has no `ask`.** Its adapter maps `ask` to `deny` and carries the one-off instruction in the reason text, because the model reads the reason and the human does not see a prompt.

## Exit codes

Exit 0 always and carry the decision in the output channel. The exit code is
a second channel whose meaning differs per harness, and a non-2 non-zero exit
is fail-open on every harness above, so "exit non-zero on unreadable stdin" is
inert. The one blocking exit is 2, on Claude Code and Codex, and it needs the
reason on stderr: Codex treats exit 2 with empty stderr as a failed hook and
lets the call through. On unparseable stdin return 0 and decide nothing: there
is no command to judge, and the alternative blocks every call the moment the
harness hands the hook something unexpected. Build the JSON with a serialiser,
never string interpolation, because a reason containing a quote becomes
unparseable output, which is the one shape every harness treats as an error
rather than a decision. One script wired into two harnesses has two failure
semantics: write the header comment per harness.

## The VCS bypass surface

A guard that matches one spelling of `--no-verify` is theatre. The flag has
aliases, git has its own kill switch in two spellings, and every hook manager
has one more. Verified 2026-09-21 against git 2.55.0 and each manager's docs.

| Bypass | Spelling | Decision | Note |
|---|---|---|---|
| Skip the hook | `git commit --no-verify`, `git push --no-verify`, `git merge --no-verify` | ask | |
| Skip the hook, short | `git commit -n` | ask | `-n` is `--no-verify` on `commit` alone: on `git merge` it is `--no-stat`, on `git push` it is `--dry-run`. Match the subcommand or the guard blocks a dry run |
| Disable every hook | `git -c core.hooksPath=/dev/null <cmd>` | ask | git's own documented kill switch, under `core.hooksPath` in `git help config` |
| The environment spelling of the same | `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null` | ask | Overrides every config file; only an explicit `git -c` beats it |
| Manager kill switch | `HK=0`, `LEFTHOOK=0` or `LEFTHOOK=false`, `HUSKY=0` | ask | An environment prefix, so the guard reads the segment's `VAR=value` prefix and not only the arguments |
| Skip named steps | `HK_SKIP_STEPS=<step>`, `LEFTHOOK_EXCLUDE=<tag>`, `SKIP=<id>` for pre-commit | ask | Routinely legitimate; ask, never deny |
| Config-file skip | `lefthook-local.yml` with `skip: true` or `exclude_tags` | not reachable | A gitignored file, no command string to match. Record it as the guard's stated limit and cover it with a config check |

Two authoring rules follow. **Segment before matching**: tokenise, split on
`;`, `&&`, `||` and `|`, strip the leading `VAR=value` prefix, and inspect only
a segment whose command word is `git` or `jj`, so `git log --grep=--no-verify`
and a commit message quoting the flag are not findings. **Every row is a test
case**, and so is every false positive above.

## Worked example

A Python guard in the shape above, for Claude Code. The policy is
`bypass_reason`; everything else is the adapter.

```python
import json
import shlex
import sys

SEPARATORS = {";", "&&", "||", "|"}
KILL_SWITCHES = {"HK", "LEFTHOOK", "HUSKY"}
SKIP_VARS = {"HK_SKIP_STEPS", "LEFTHOOK_EXCLUDE", "SKIP"}


def segments(command: str) -> list[list[str]]:
    lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    lexer.commenters = ""
    out: list[list[str]] = [[]]
    for tok in lexer:  # raises ValueError on an unclosed quote: let the caller decide
        out.append([]) if tok in SEPARATORS else out[-1].append(tok)
    return [seg for seg in out if seg]


def bypass_reason(command: str) -> str | None:
    for seg in segments(command):
        env: dict[str, str] = {}
        while seg and seg[0].partition("=")[1] and seg[0].partition("=")[0].isidentifier():
            key, _, value = seg.pop(0).partition("=")
            env[key] = value
        if seg[:1] not in (["git"], ["jj"]):
            continue
        if any(env.get(k, "").lower() in {"0", "false"} for k in KILL_SWITCHES):
            return "disables the hook manager for this command"
        if SKIP_VARS & env.keys():
            return "skips named hook steps"
        if any(k.startswith("GIT_CONFIG_KEY_") and v.lower() == "core.hookspath" for k, v in env.items()):
            return "overrides core.hooksPath from the environment"
        if any(t.lower().startswith("core.hookspath=") for t in seg):
            return "overrides core.hooksPath"
        sub = next((t for t in seg[1:] if not t.startswith("-") and "=" not in t), None)
        if "--no-verify" in seg or (sub == "commit" and "-n" in seg):
            return f"runs {seg[0]} {sub} with hooks skipped"
    return None


def main() -> int:
    try:
        command = json.load(sys.stdin)["tool_input"]["command"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return 0  # nothing to judge: the harness misbehaved, not the agent
    try:
        reason = bypass_reason(command)
    except ValueError:
        reason = "skips hooks" if "--no-verify" in command else None  # unlexable: match the one unambiguous spelling
    if reason:
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": f"{reason}. Confirm to run it once.",
        }}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Wired as `python3 "${CLAUDE_PROJECT_DIR}/tools/hooks/guard-hook-bypass.py"`
under a `PreToolUse` entry with matcher `Bash`. The Codex adapter differs in
two lines: the decision is `deny` and the reason says how to run the command
once by hand. The pi adapter returns `{ block: true, reason }` from a
`tool_call` handler over the same policy ported to TypeScript, and the parity
check below is what stops the port drifting.

## Testing a guard

Test the policy function as data: one case per row of the bypass table, the
false-positive cases (`git log --grep=--no-verify`, the flag inside a commit
message, `echo --no-verify`, `git merge -n`, `git push -n`), and an unrelated
command that must come back untouched. The adapter is three lines of I/O and
is exercised by the wiring probe, not unit-tested. The wiring probe belongs
with the git-hook tier: a headless round trip that runs a harmless command,
then a negative probe that the blocked command is refused, before any change
to the hook config lands. Where one policy is copied into several harnesses,
a parity step diffs the copies: glob it on every file holding a copy and on
the checker itself, so the day one copy is edited the commit fails rather than
one harness opening.

## No install step

A git hook is armed by a `prepare` script, and `ignore-scripts` disables
that script, so a clone's declared hooks stay silent and nothing says so. An
agent-tool gate in Claude Code or opencode has no such step: the config is
read from the checkout and is live the moment the repository is cloned, so for
the population being fenced, that tier is the more reliable one. pi and Codex
put a trust decision in front of the same config, per project or per machine,
so there the gate is armed only after someone has said yes. The property that
makes the Claude Code and opencode tier reliable is the property that makes a
cloned repository's hook config executable content; the control for running
an agent in a repository you did not write is in the `supply-chain-hardening`
skill.
