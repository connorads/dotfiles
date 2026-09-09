# The Claude binary is not patched for channels, and mise owns the install

## Context

Claude Code's `--channels` flag is gated on the `tengu_harbor` feature flag and on an
approved-channels allowlist (`tengu_harbor_ledger`). Both are read through
`getFeatureValueWithSource`, which with telemetry disabled returns the bundled defaults
(`false`, `[]`) instead of the cached values in `~/.claude.json`. This machine exports
`DISABLE_TELEMETRY=1` and `DO_NOT_TRACK=1`, so channels are gated off.

Two byte-level needle patches against the binary's embedded JS source flipped those two
defaults. They stopped working while continuing to report success.

### The patches are inert

From roughly 2.1.26x, Bun compiles nearly every chunk of the single-file binary to
bytecode: `// @bun @bytecode` markers go from 8 occurrences in 2.1.215 to ~1658 in
2.1.267. The embedded JS source is still present - it is what a needle finds and edits -
but it is no longer what executes. A probe copy of 2.1.267 with only the JS-source copy
of a log string changed emitted the **unmodified** text.

So `claude-channels-patch --check` reported `patched:` for weeks against a feature that
had been dead since about 2026-09-01.

### The env var is sufficient on its own

Four runs, same folder, same environment, one variable changed:

| binary | `CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF` | result |
| --- | --- | --- |
| patched 2.1.267 | unset | `skipped: channels feature is not currently available` |
| patched 2.1.267 | `1` | `Channel notifications registered` |
| **unpatched** 2.1.267 | `1` | `Channel notifications registered` |

That variable makes a no-telemetry session read `cachedGrowthBookFeatures` from
`~/.claude.json`, which already holds `tengu_harbor: true` and a ledger listing telegram.
The patches contribute nothing.

### Two installs, one of them patched

`_claude-patch-targets-lib` resolves targets only inside the mise tree, but
`~/.local/bin/claude` pointed at `~/.local/share/claude/versions/<v>` from the native
installer. `up` and the mise postinstall were therefore patching a binary that did not
run, and native self-updates reverted everything while writing no stale marker.

`autoUpdates: false` in `~/.claude.json` is ignored by design for a native install
(`installMethod === "native" && autoUpdatesProtectedForNative === true`): two versions
landed on 2026-09-09 with it set.

## Decision

`--channels` is held open by `CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF=1`, exported
in `~/.zshrc`. No binary patch is involved. The two channel needle patches, their tests,
their `up` entries and their mise postinstall steps are gone.

Because a green `--check` proved nothing, the replacement evidence is behavioural:
`claude-channels-check` reads the last `Channel notifications` line from the Telegram
plugin's own debug log and drops `~/.cache/claude-channels.stale` on a skip, which the
marker glob at the top of `~/.zshrc` prints on the next shell start. The `cyc` launcher
backgrounds it, because a check is only meaningful where `--channels` was passed.

mise owns the Claude install. `DISABLE_UPDATES` in `~/.claude/settings.json` holds the
self-updater off; the name is not namespaced, so it lives in Claude's own settings file
rather than the shell environment, where nothing else can read it. The native tree at
`~/.local/share/claude/versions` and the `~/.local/bin/claude` shim it created are
deleted. The remaining patches - computer-use, session-reaper, and the read-only
commit-note check - are reapplied by the mise postinstall.

## Alternatives considered

- **Patch the bytecode instead of the source.** The gate's value is compiled into a Bun
  bytecode chunk with no stable literal to slot, and the binary embeds a byte-offset
  source trailer, so an edit must not change length. A patch would have to be re-derived
  against each release's compiler output. The measured table above shows it buys nothing:
  the env var alone registers the channel on an unpatched binary.
- **Re-enable telemetry for channel launches.** This is what `cspy` already does, and it
  is the right tool for a one-off - it evaluates the gates live. As the standing launcher
  it trades the telemetry posture away permanently for a result the disk cache already
  holds.
- **Bridge Telegram outside Claude Code, via `agent prompt` into a pane.** Removes the
  dependency on a gated feature entirely, but re-implements the plugin's inbound half -
  bot polling, access control, attachment download, reply threading - and loses the
  `<channel source="telegram">` framing the session already understands. Not worth
  building while a single supported env var does it.
- **Keep the patches as belt-and-braces alongside the env var.** They report `patched:`
  whether or not they do anything, which is precisely the failure that cost this
  investigation. A check that cannot fail is worse than no check.
- **Set `autoUpdatesProtectedForNative: false` in `~/.claude.json`.** Claude Code rewrites
  that file constantly, so the setting is not durably ours. It stays as the fallback if
  `DISABLE_UPDATES` turns out not to hold.

## Known limits

- The fix depends on `cachedGrowthBookFeatures` in `~/.claude.json` staying populated.
  With telemetry off nothing refreshes it, so a reset of that file takes channels away.
  `cspy` is then the only way to repopulate it - which is the standing argument for
  keeping `cspy` - and `claude-channels-check` is what makes the failure visible.
- "Source patching is inert" is confirmed by direct test only for the module holding the
  channels gate. The other patch sites are shown to sit inside modules headed
  `// @bun @bytecode` - the same mechanism, not individually tested.
- The break's start date is inferred, not bracketed. Bytecode markers jump from 8 in
  2.1.215 to ~1650 in 2.1.261+, and the logs turn from `registered` (last 09-02) to
  `not currently available` (first 09-01), but the intervening versions were deleted from
  the versions directory before the boundary could be pinned.
