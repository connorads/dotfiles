## Use the managed CLI

{{marker}}

Use the mise-installed `rea` command through the shell for every operation.
Do not configure, launch or repair MCP integrations. Do not run package runners,
`rea setup`, `rea update`, or `--update`. Tool versions belong to mise; skill
refreshes belong to the reviewed vendored-skills workflow.

Run `rea --help` and `rea <command> --help` to discover the installed interface.
Use `rea <command> --schema` when structured input needs an exact contract.
The guides below use MCP operation names and session terminology. Translate
operations to CLI commands using installed help, rather than assuming a direct
name conversion. For native targets use `rea analyze`, `rea search`,
`rea function`, `rea decompile`, `rea xrefs`, or `rea trace` with the target path.
Do not call MCP session lifecycle operations such as `open_binary` or `close_binary`.
Each CLI invocation is a separate process. Save complete Evidence to files and
pass saved Evidence explicitly to later commands; do not rely on session IDs.

Read [CLI recovery](references/connection-and-recovery.md) only after a launcher
or provider failure. Diagnose the specific prerequisite and continue supported
work. Native analysis still requires an existing engine. Static JavaScript
analysis requires neither an engine nor an agent integration.
