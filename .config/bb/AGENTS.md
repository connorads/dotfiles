# BB

This guide owns local BB configuration rules and routes to plugin documentation.
Use BB's supplied skills and `bb guide` for platform commands and agent orchestration.

```mermaid
flowchart TD
  Root[Root AGENTS.md] --> Local[BB ownership and task routes]
  Local --> Preferences[Preferences guide]
  Local --> Plugins[Local plugin workspace]
  Local --> Platform[BB skills and CLI help]
```

## Settings ownership

Check whether a local plugin manages a setting before changing it through the UI or CLI.
File-managed settings are authoritative. Change their tracked file, then verify the live setting.
Do not disable reconciliation to make a settings edit persist.

## Thread shortcuts

The Preferences plugin manages thread shortcuts from [preferences.json](./preferences.json).
Managed entries override UI and CLI edits. Other shortcuts remain unmanaged.
Read the [Preferences guide](../../src/bb-plugins/preferences/README.md) for ownership, installation and removal rules.

1. Edit [preferences.json](./preferences.json) for the requested command and platform.
2. Run `bb preferences apply` to apply the tracked file.
3. Run `bb settings keyboard list --json` to verify the live overrides.

## Local plugins

Plugin source lives in [src/bb-plugins](../../src/bb-plugins/README.md), a shared pnpm workspace.
Read its guide and the affected plugin's README before changing source.
The workspace guide owns build, test, installation and reload procedures.

[Handsfree](../../src/bb-plugins/handsfree/README.md) owns Hex voice controls for the focused BB window.

## Platform operations

Use the supplied `bb-cli` skill for settings and state inspection.
Use the matching provider or plugin skill for its subsystem.
Check live command syntax with `bb <group> --help`.
Verify changes through live settings or behaviour before reporting success.
