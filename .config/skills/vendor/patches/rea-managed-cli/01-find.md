## Connect only when needed

Installing this skill supplies instructions; it does not register the REA MCP
server, install analysis engines, or add tools to an already-running agent.

If REA tools are available and their registration is not known to be stale,
proceed directly to the target. Do not run diagnostics or setup before every
investigation. Use the connected server's actual tool list and input schemas;
a skill installed from repository main may describe capabilities absent from
an older npm release. Keep complete inline Evidence when that server does not
advertise retained references.

If tools are absent, a call is blocked by the client, or a required provider is
unavailable, read [connection and recovery](references/connection-and-recovery.md).
Diagnose the observed blocker, continue useful supported work, and resume the
original task after repair. Client approval, shell PATH, registration and engine
availability have different remedies; avoid repeating setup for all of them.
If the host times out without a REA result, do not repeat the unchanged call or
assume work stopped. Read the recovery guide's deadline distinction before retrying.
If the MCP connection drops, retry that call once only when it is safe to
repeat or known not to have started. If it may already have changed the
target, or it fails again, tell the user and ask them to restart the MCP
client. If REA could not start its connection, retry once, then tell the user
and ask them to restart the MCP client. Do not retry a startup failure that
returns the same unchanged result. Run `rea doctor` when REA could not start
or tools stay missing after that restart. For `cleanup_incomplete`, a retryable
capacity limit, or `configuration_invalid`, follow the recovery guide's ladder
before asking for a restart. Read that guide before a second repair attempt.

1. Diagnose without changing REA or client configuration. `npx` may download
   the package and write to npm's cache. For Codex, run
   `npx -y rea-agents@latest doctor --client codex --json`. Substitute the current
   supported client: `claude_code`, `claude_desktop`, `codex`, `cursor`,
   `gemini_cli`, `windsurf`, `devin`, `opencode`, `antigravity`, `copilot_cli`,
   `commandcode`, `vscode`, `grok_build`, `omp`, or `grok_bot`. `grok_bot` has no local
   file registration: doctor reports the Grok Bot chat step, and setup does not
   write `mcp.json`. If the client is unknown, use `doctor --json` and
   inspect its registration results before choosing a setup scope.
2. Distinguish the reason. Missing, malformed, or stale registration needs a
   scoped configuration repair. An aligned registration with no tools in the
   active session needs a restart/reconnection; doctor cannot prove that the
   current agent has connected. A missing provider affects only tasks requiring
   that provider: static JavaScript inspection needs neither Hopper nor Ghidra,
   and Android inspection has separate bring-your-own JADX/Java prerequisites.
3. For a configuration repair, prepare the read-only plan:
   `npx -y rea-agents@latest setup --client codex --dry-run --json`.
   Use the current client's ID, show its exact proposed paths, backups, and
   changes, and obtain approval before setup writes configuration or installs
   Hopper. Setup normally installs the matching bundled skill too; include that
   replacement in the reviewed plan. After approval, apply the same scope with
   `npx -y rea-agents@latest setup --client codex --yes`. Add `--install-hopper`
   only if that separate installation was needed and explicitly approved.
4. Restart/reconnect the affected agent. Verify that REA tools actually appear
   in the session, then resume the original investigation. If they remain
   absent, inspect the client's MCP launch error rather than repeating setup.

REA setup never installs or upgrades Node.js, npm, Homebrew, Java, Ghidra, IDA,
JADX, Kuna, Binwalk, or Unblob. Use existing prerequisites; do not install unrelated
software to repair MCP registration. For an unsupported client, use manual stdio
registration with a version-pinned `rea-agents` package or continue through the CLI.

A concrete CLI fallback for an operator-supplied JavaScript tree or ASAR is:

```bash
npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json
```

No MCP registration or native engine is required. Read the returned Evidence,
graph, limitations, and unknowns with the same care as an MCP result; the CLI
returns the Evidence record directly. This fallback does not establish that
MCP is configured. Native CLI tasks still require their selected engine.
Prefer an existing `rea` CLI. When none is installed and REA package acquisition
is within the authorized scope, use `npx -y rea-agents@latest` in its place.
Configuration repair starts with a read-only setup plan; show paths, backups and
skill replacement before applying authorized changes. Preserve existing approval
and target-execution boundaries.
