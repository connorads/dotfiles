For voice selection, Whisper model rules, output format choice, and the TTS → transcript → captions chain, invoke the `media-use` skill. This skill stays focused on the dev loop.

## Remaining harness usage

Run `npx hyperframes usage --json` at the start of a video workflow and again at milestones such as after drafting and before rendering. A fresh read at handoff can serve as the start read. Use `--harness claude-code`, `--harness codex`, or `--harness grok` to select explicitly.

Known results contain `status: "known"`, `harness`, `planTier`, `session`, `weekly`, and `spend`. Each available window contains `usedPercent`, `remainingPercent`, and `resetsAt`; an unavailable window is `null`. `planTier` is the readable subscription tier when available, otherwise `null`. Claude Code reports its shared five-hour and weekly windows; a spend-metered plan (such as Enterprise) has neither and reports `spend`, the share of its billing-period spend limit already used, with `resetsAt: null`. Codex reports its shared session and weekly windows when available. Grok reports its included weekly allowance with `session: null`. Only Claude Code reports `spend`; it is `null` elsewhere. When no window is available the result is `status: "unknown"` with `reason: "no_usage_windows"`.

Unknown results contain `status: "unknown"` and a token-free `reason`. Missing, expired, unsupported, ambiguous, or unreadable logins and unavailable provider responses return unknown. Report the unknown state without guessing allowance. The command reads existing credentials without refreshing or rewriting them and emits no tokens or telemetry. Usage is a snapshot; it does not reserve allowance or estimate the next video's cost. Keep scope and workflow choices with the user.
