# AI usage tracker (custom subsystem)

The AI usage surfaces track three providers:

- Claude: [`../zsh/functions/claude-usage`](../../zsh/functions/claude-usage)
  reads Claude OAuth credentials and caches `~/.cache/claude-usage.json`.
  Multi-account: `--profile <name>` reads a `~/.claude-profiles/code/<name>`
  account (config-dir file first, then the hash-suffixed keychain service) into
  `~/.cache/claude-usage-<name>.json`, stamped with `_label`/`_profile`; `--all`
  fans the default account plus every profile out in parallel. The `prefix + a`
  popup (`ai-usage --fancy`) renders one labelled Claude group per account;
  column 1 is always the owner, so model-scoped weekly windows are
  account-labelled too, with the model folded into the window token (`7d·S`
  Sonnet, `7d·F` Fable) to stay distinguishable across accounts. Accounts are
  launched with `ccp`.
- Codex: [`../zsh/functions/codex-usage`](../../zsh/functions/codex-usage)
  reads Codex auth and caches `~/.cache/codex-usage.json`.
- Cosine: [`../zsh/functions/cosine-usage`](../../zsh/functions/cosine-usage)
  reads `${COSINE_CONFIG_FILE:-~/.cosine/auth.json}` for `team_id`, gets a
  bearer via `cosine-bearer`, and caches `~/.cache/cosine-usage.json`.

Each provider shares [`../zsh/functions/usage-cache-lib`](../../zsh/functions/usage-cache-lib):
`*.meta.json` stores backoff state and `*.lock` prevents concurrent fetches. Do
not print bearer/access tokens in diagnostics.

## Codex window classification

Codex windows are classified by their real `limit_window_seconds`, never by JSON
slot. [`../zsh/functions/codex-windows.jq`](../../zsh/functions/codex-windows.jq) is
the shared pure core: it turns a raw Codex usage object into a duration-sorted
`[{seconds, used_percent, reset_after_seconds, reset_at}]` list (shortest window
first). A window the API gives no `limit_window_seconds` for reports `seconds: 0`,
meaning unknown - the slot's usual length is never substituted, because doing so
reproduces the positional bug one layer down. **No surface may name a window a
duration the payload does not support.** Three surfaces render that list -
`codex-usage` and `usage-debug` shell out to `jq -f`, while the fancy dashboard
shells out from Python; `window_label(seconds)` gives canonical `5-hour`/`7-day`
(`5h`/`7d`) wording, `unknown`/`?` for a 0, and adapts to any other duration.
Pace/colour maths uses each window's real length, and skips a window whose
length is unknown.

`usage-debug` was the surface that never adopted the core, and read
`primary_window` positionally with a hardcoded `5h=` label for its whole life -
printing `5h=14% reset in 6d 11h` on today's weekly-only payload. That matters
more than a wrong label: it is the independent read you reach for when the
dashboard is the thing you cannot trust, so it misled during exactly the task it
exists for. Its `// 0` fallbacks fabricated `0%` for a window whose data was
simply absent, which reads as headroom. Claude stays positional there too, and
both its windows are read.

Why: OpenAI temporarily removed the 5h window (2026-07-12, Plus/Pro/Business) with
no return date, collapsing usage to a single weekly window that arrives in the
`primary_window` slot. Positional classification (primary=5h, secondary=7d)
mislabels that weekly figure as 5h. Duration classification is adaptive: it
renders only the windows that exist and stays correct whether the 5h window is
gone now or returns later, in either slot. Claude stays positional because its
`five_hour`/`seven_day` keys are named and contractually fixed, so they can't
suffer the same collapse. Spark extras (`additional_rate_limits`) apply the same
duration rule inline (low-stakes, not the failure mode), not the shared jq.

## Rows carry the reset instant, not a duration

Every dashboard row stores `reset_ts`, the absolute epoch the provider itself
supplies - Claude's `resets_at`, Codex's `reset_at` (falling back to
`reset_after_seconds` read against the cache file's mtime, which is when that
countdown was true), Cosine's `billingPeriodResetsAt`. `remaining_secs(row)` is
the only derivation, and clamping happens at each display edge rather than in the
model. So one fact drives three readings: the countdown (`↻ 4h 42m`), the
width-gated wall clock beside it (`· 21:40`, or `· Tue 09:40` on a different local
day), and "this window already ended".

That last one is a state, not a defect to gate around. A clamped duration
collapses "reset five weeks ago" into "resets imminently", which is why an
elapsed Cosine billing period suppresses the pool row and states
`Cosine  billing period ended <date>` instead. The payload's `canInference`,
`trialExhausted` and `tokenBillingEnabled` flags all read healthy on a dead
subscription, so the elapsed period is the only honest evidence.

The clock is gated on the bar width it would leave, not on a bare width
threshold: the box floors at inner 64, so a ~70-col popup keeps its full bar and
the clock appears from ~105 terminal columns up. `AI_USAGE_NOW` (epoch seconds)
pins the dashboard's now so any of this is assertable.

Codex's usage-limit-reset credits (`rate_limit_reset_credits`) render as a
`Resets` line reporting both what the account holds and what is spendable now
(`applicable_available_count`); nothing is emitted at zero. It goes through the
always-render `standing` list, not `alerts`, which is sliced to three - ranked by
severity, so a red is never dropped for a yellow. Claude's `/api/oauth/usage`
carries no reset-credit field, so this stays Codex-only.

When resets are held, `codex-usage` fetches
`GET /backend-api/wham/rate-limit-reset-credits` and stores the response in the
optional `_reset_credit_details` cache field. Every available expiry appears
beneath the count, earliest first, with resets sharing a deadline grouped on one
line. Each line shows the count, countdown and local date/time. Only the server's
`expires_at` supplies the deadline; missing dates report `Expiry unavailable`. An elapsed deadline says
`expired · refresh needed`. Details fetch failures leave usage available and
omit expiry details from the new cache, rather than retaining an old grant list.

Surfaces:

- [`../zsh/functions/agents/ai-usage`](../../zsh/functions/agents/ai-usage)
  (`aiu`, popup via `prefix + a`) renders combined usage. `--cache-only` renders
  the fancy dashboard without contacting providers; `--refresh-only` refreshes
  all providers silently, waiting for both its children and any live provider
  lock (bounded to 20 seconds). Direct `--fancy` retains refresh-then-render
  compatibility.
- [`scripts/ai-usage-popup.sh`](../scripts/ai-usage-popup.sh) renders
  `--cache-only` first, then starts a detached `--refresh-only`. A key dismisses
  within the 100 ms TTY poll interval without cancelling refresh. Natural
  completion redraws once only when a usage cache or metadata file changed;
  cleanup always restores the saved TTY state, cursor, and alternate screen.
- [`../zsh/functions/usage-debug`](../../zsh/functions/usage-debug) prints cache,
  backoff, lock, and provider usage details.

Tests: [`../zsh/tests/codex-windows.bats`](../../zsh/tests/codex-windows.bats)
(the classifier's combinatorial matrix),
[`../zsh/tests/claude-usage.bats`](../../zsh/tests/claude-usage.bats),
[`../zsh/tests/codex-usage.bats`](../../zsh/tests/codex-usage.bats),
[`../zsh/tests/cosine-usage.bats`](../../zsh/tests/cosine-usage.bats),
[`../zsh/tests/ai-usage.bats`](../../zsh/tests/ai-usage.bats),
[`../zsh/tests/ai-usage-popup.bats`](../../zsh/tests/ai-usage-popup.bats),
[`../zsh/tests/usage-debug.bats`](../../zsh/tests/usage-debug.bats).
