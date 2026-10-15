# CLI and task recovery

<!-- LOCAL PATCH (connorads dotfiles): REA recovery checks the managed CLI and task prerequisites without configuring MCP. -->

Read this guide only after an observed command or provider failure.
Keep the supplied target and question in view. Continue supported work after repair.

Check the launcher environment when the command fails:

```bash
command -v rea
command -v node
node --version
rea --version
mise which rea
```

Use `mise exec -- rea <command>` if a child shell lacks the activated PATH.
If the configured version is missing, report that prerequisite. Do not download
another version with a package runner or change tool configuration during analysis.
Do not configure MCP, run setup, self-update, or replace the vendored skill.

For native analysis, inspect `rea providers --json` and the failed operation's
provider diagnostics. Use `rea doctor --provider ghidra --json` for a selected
Ghidra engine, or substitute `hopper` or `ida`. Install no unrelated engine to
repair a launcher failure. Preserve host permissions and target-execution boundaries.

On macOS, REA compiles a Swift process-ownership helper during JavaScript analysis.
A compiler-cache permission failure can come from the host sandbox. Preserve
the sandbox and use its approval flow for the same command when needed.
Do not treat that failure as a missing analysis engine.

Static JavaScript and ordinary ZIP inventory need neither Hopper nor Ghidra.
Native decompilation, Android inspection and firmware extraction have separate
prerequisites. Use available static evidence and report missing evidence explicitly.

Save complete JavaScript Evidence before reading a small view:

```bash
rea analyze-javascript-application /absolute/path/to/app --json > app-evidence.json
jq -c '{source: {kind: "inline", evidence: .}, view: {kind: "summary"}}' app-evidence.json > app-view.json
rea inspect-analysis-view app-view.json
```

Use caller-selected output paths in the authorised workspace. CLI output can be
large. Read summaries and focused pages rather than the complete JSON in context.
Preserve source identity, limitations and unknowns. See the
[JavaScript recipes](javascript-applications.md) for focused follow-up views.
