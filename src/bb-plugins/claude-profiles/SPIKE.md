# Profile switch proof

The disposable BB thread is `thr_7jfrxpcc7x`, in project `proj_f2ej636mt5`.
BB is 0.45.0 and Claude Code is 2.1.293.

The first turn used the work directory and stored a phrase in conversation
history without writing a separate memory file. After releasing the runtime,
changing only `CLAUDE_CONFIG_DIR` to client failed with:

```text
No conversation found with session ID: 68fe2a7c-6970-42b4-a246-77aa535bd3ba
```

This disproves directory-only native continuation. A session must be available
in the target directory before Claude can resume it. Copying only this disposable
session's transcript made the next turn succeed. Claude recalled the phrase and
reported the client directory. Credentials and settings stayed separate.

An account-status command from the model's sandbox reported no login even though
the provider completed model requests. It does not establish the provider's
account identity. Do not use sandboxed nested CLI authentication as that proof.

The separate quota protocol spike succeeded for all three named profile
directories without sending a model prompt or directly reading tokens.

## Installed plugin verification

Verified 2026-10-10 against BB 0.45.0 and Claude Code 2.1.293:

- Passed: native phrase recall after switching client to work through the plugin.
- Passed: profile switching is refused during an active turn.
- Passed: discovery lists Default, work, personal and client.
- Passed: work and client return quota windows; personal returns unavailable.
- Passed: BB discovers both `provider-usage.v1` RPC methods and accepts a live measurement.
- Passed: 17 core tests and two SDK app-harness tests, TypeScript checks and BB builds.
- Passed: staged secret scans, whitespace checks and offline local Markdown links.
- Skipped: home `dhk` project-specific gates match no files in this standalone repository.
- Skipped: desktop visual confirmation. Account controls are covered by the SDK app harness.

The temporary proof plugin is removed and the disposable thread is archived.
The installed `claude-profiles` plugin is enabled and running. The built-in
Account Pooler and Provider Usage panel remain disabled.

## Composer picker verification

Verified 2026-10-12 against BB 0.46.0 and SDK 0.6.15:

- Passed: on a new thread's first send, `message.dispatch` ran with the thread
  `pending` and its host resolved. The provider env contribution ran 29 ms later
  and read the value that hook stored. A disposable spike plugin proved the order.
- Passed: a remembered `stretch` choice started a new thread with
  `CLAUDE_CONFIG_DIR` set to the stretch profile, and the turn completed.
- Failed, then fixed: switching that thread to Default contributed an empty
  `CLAUDE_CONFIG_DIR`. Claude resolved it against the working directory, created
  `sessions/` and `seed-admin/` there and reported `No conversation found`.
  Default now contributes nothing. The retried turn recalled the earlier word
  with `CLAUDE_CONFIG_DIR` unset.
- Passed: 21 core tests, 9 SDK app-harness tests, TypeScript checks and BB builds.
- Skipped: desktop visual confirmation. Screen capture is unavailable to the agent.

`ComposerSubmitOptions.experimental_data` reaches dispatch hooks only through
plugin-initiated `composer.submit`, not a plain Enter. So the new-thread choice
is remembered rather than bound to one draft.

## Fallback guard verification

Verified 2026-10-12 against BB 0.46.0 and SDK 0.6.37:

- Passed: with the plugin disabled, a send to a `stretch` thread launched Claude
  without `CLAUDE_CONFIG_DIR` and printed `dir=unset`. This reproduces the
  silent fallback BB allows when a contributor is missing.
- Passed: after re-enabling, the next send was refused with the guard notice.
  Sending again relaunched with the stretch directory and recalled the earlier word.
- Passed: a later send to the healthy thread proceeded without a refusal.
- Passed: 28 core tests, including fake-host wiring tests, and 9 app tests.
