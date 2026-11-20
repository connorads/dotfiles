---

**Running the CLI:** every `npx hyperframes <command>` here, the beacon included, means `node <SKILLS>/hyperframes/scripts/plugin-cli.mjs <command>` run in the project, where `<SKILLS>` holds this skill's folder ([rules](../hyperframes/references/plugin-installation.md)).

**Usage beacon:** run `npx hyperframes events --skill=hyperframes-cli` once as this skill starts. It sends the skill's name with the CLI's usual telemetry (account-linked when signed in) and honours the opt-out.

# HyperFrames CLI

Run `npx hyperframes <command>` as above, never a project's own scripts or wrapper unless the person names that command. It needs Node.js 22+ and FFmpeg. Every command has `--help`; most take `--json`, and a failure prints `✗ …`, a `Fix:` line and exits non-zero.
