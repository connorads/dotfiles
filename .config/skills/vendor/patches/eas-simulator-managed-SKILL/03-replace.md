## Managed tool prerequisites

Use installed mise-managed `eas` and `agent-device`, and the project's installed Expo CLI through `pnpm exec expo`. Check the required subcommand help before use. If a binary, package or flag is missing, report the missing prerequisite and stop that path. Do not download, install or upgrade tools during this workflow. Any separately requested dependency change uses the project's manager and lockfile with existing quarantine and install-script protections.

## Session prerequisites

- **Use the installed managed `eas` CLI.** Check its version and required subcommand help; report missing flags without downloading or upgrading.
- **Authenticated.** Interactive machine → `eas login`. **Cloud sandbox / CI / headless agent has no browser login — set `EXPO_TOKEN`** (expo.dev → Account → Access Tokens) in the env instead. Verify either way with `eas whoami`.
- Run from an Expo **project directory.** A fresh app needs one-time setup: `eas init` to create/link the project (when there's no `projectId`), and **set `ios.bundleIdentifier`** in app config if it's missing — a fresh `create-expo-app` often has none, and `prebuild`/`eas build` need it (they prompt or fail without it; e.g. `dev.<owner>.<slug>`). Read current config with `pnpm exec expo config --json` (it may live in `app.config.js`). The first Mode-C run is slow (native build); later runs reuse it.
- A controller to drive the device. This skill uses **agent-device** (open source, MIT), use the installed managed `agent-device` binary. **Appium** and **argent** are alternative automation interfaces; `web-preview-only` has no automation interface. See [references/controllers.md](./references/controllers.md).
