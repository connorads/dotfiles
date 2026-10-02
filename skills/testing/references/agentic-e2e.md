# Agentic E2E Tests

Agentic e2e tests mix natural-language agent steps ("add a todo", "the chart
trends upward") with ordinary locators and assertions. One question decides
every design choice:

> Which steps need judgement a locator cannot express - and what checks the
> agent's verdict without trusting the model?

## Contents

- [When an agent step earns its place](#when-an-agent-step-earns-its-place)
- [Rules](#rules)
- [Qualifying a test before CI](#qualifying-a-test-before-ci)
- [Tool notes: TesterArmy e2e](#tool-notes-testerarmy-e2e)

## When an agent step earns its place

Default to a deterministic test and add agent steps only where a locator fails.
Both styles mix freely in one test.

- **Use an agent step for:** model-generated screen text (AI chat, summaries),
  visual judgements (charts, overlap), UI whose names and layout churn faster
  than selectors can follow, exploratory bug hunts, and mobile flows where a
  Detox or Maestro setup costs more than the test.
- **Keep it deterministic for:** stable critical journeys with role or label
  locators. In the spike behind this file, the deterministic version ran in
  0.8s with no model calls. The agent version ran in 29s, used 12 model calls
  and 45.6k tokens, and was flaky on a cold cache.

Agentic steps do not replace domain tests. The layer rules in SKILL.md still
apply.

## Rules

1. **Pin every agent goal with a deterministic check straight after it.** An
   `act` reports its own success, so a locator assertion is the evidence that
   does not come from the model. In tools with a replay cache, that check is
   usually also what lets the step be recorded.
2. **Make pending state visible in the app, not in the prompt.** The agent
   judges a step from the screen right after its last action. A list that
   updates 300ms later, with no loading signal, reads as "nothing happened".
   Cold runs against a working app with that 300ms gap:

   | Variant | Passed |
   | --- | --- |
   | One goal per `act`, no app change | 0 of 5 |
   | Goal reworded as an action ("submit…") | 1 of 3 |
   | `system` prompt: "results arrive late, observe again" | 0 of 3 |
   | App sets `aria-busy` and shows "Saving…" | 3 of 3 |

   A deterministic `expect` passed every time on the same app, because it
   retries. Fix the app's pending state, which is an accessibility gain too.
   Where the app cannot change, drive that step deterministically.
3. **One goal per agent action, worded as the screen words it.** Put values in
   params, not in the instruction. Wrap per-run values (timestamps, fresh
   emails) in the tool's volatile-value marker so the cache key stays stable.
4. **Prefer a locator assertion to an agent assertion.** Judgements
   (`assert`, `waitFor`, `extract`) usually call the model on every run, cached
   or not. That cost 700 tokens and 1.8s to 4.8s per assert in the spike, and
   the verdict can vary. Keep them for checks of meaning, like generated text,
   or of pixels.
5. **Treat the replay cache as test code.** Cached entries replay actions with
   your permissions. Review them in the PR that re-records them. When CI reads
   the cache without writing it, a stale entry costs every CI run the hand-off
   wait (rule 6) until someone re-records it locally. Prefer making CI fail on
   a stale entry (TesterArmy e2e: `--strict-cache`) so a human re-records it.
6. **Self-healing changes cost, not verdicts.** After a control was renamed,
   replay waited up to 15s per stale step, then handed the step to the agent.
   That run took 61s against 29s cold. The next run re-recorded and replayed
   in 3.9s. Healing did not hide two injected bugs: a checkbox that did nothing
   and a dead submit button. Both failed with a clear reason. That is one run
   each, so treat it as encouraging, not proven.
7. **Keep secrets out of reach of other origins.** Pass credentials as opaque
   secret handles, never as literals. Check whether the tool limits
   navigation or secret fills to the app's origin. TesterArmy e2e does not.
   Avoid agent steps on pages that link to third-party sign-in forms. Shared
   preview domains (`*.vercel.app`) can count as one site for header
   injection.
8. **Never retry an agent test to green.** Retrying hides model
   nondeterminism just as it hides races. Check the runner's CI defaults:
   TesterArmy e2e retries once in CI and exits 0 for a test that only passed
   on retry. Set `retries: 0`, or treat a flaky result as a failure. The Flaky
   Tests rules in SKILL.md apply unchanged.

## Qualifying a test before CI

An agent test that passes once proves little. In the spike, a two-todo goal
passed its first run, then passed only 2 of the next 5 cold runs on unchanged
code.

1. Run the test cold N times; 5 is a cheap floor. TesterArmy e2e:
   `e2e run --repeat-each 5 --no-cache <file>`.
2. Run it warm N times: the same command without `--no-cache`, after one
   recording run.
3. Record pass rate, model calls, tokens and duration for both.
4. Admit it to a blocking gate only at N/N cold. Below that, find the cause
   (usually rule 2 or 3) instead of adding retries.

## Tool notes: TesterArmy e2e

Verified 2026-10-02 against `e2e` 0.15.1 and `@e2e-dev/web` 0.11.1. It is
Apache-2.0, runs on your installed Playwright, and lets you bring your own
model. For API detail, read the vendor's agent guide with
`pnpm exec e2e guide <topic>` rather than copying it here.

- **Quarantine trap.** The `e2e` npm name was taken over from a 2014-2016
  package. Its only stable releases are 0.1.0 (a placeholder with no CLI)
  and 0.15.x; everything between was published as canary. A minimum-release-age
  quarantine can resolve `e2e` to 0.1.0 and fail with `ERR_PNPM_DLX_NO_BIN`.
  Pin exact versions and exempt only `e2e` and `@e2e-dev/*` with pnpm's
  `minimumReleaseAgeExclude`.
- **Discovery.** Only files matching the config's `tests` glob run (default
  `tests/**/*.e2e.ts`). A path outside it prints "no test files".
- **Agent settings.** `context` and `system` are keys on `agents.<name>` in
  config, not `act` options; passing them to `act` throws `INVALID_ARGUMENT`.
  Select a named agent with `act(goal, { agent: '<name>' })`.
- **Recordable checks.** A step is recorded only after a later check passes:
  a locator or URL matcher, `locator.waitFor()`, `browser.waitForURL()`,
  `agent.assert` or `agent.waitFor`. `expect(value)` on a plain value,
  `expect.poll` and `agent.extract` do not count.
- **Pending signals.** The engine waits through `aria-busy` on the root or a
  landmark, an indeterminate `progressbar`, or a screen that is only a loading
  notice. Silent async updates are judged too early.
- **CI defaults** (`CI` set): `retries: 1`, one worker, cache read-only.
  Exit code 0 covers tests that passed only on retry. A stale step waits
  `min(actionTimeout, 15s)` before handing off, unless `--strict-cache` fails
  it with `REPLAY_STALE`.
- **ChatGPT login from an agent shell.** The browser flow may not open; use
  `e2e login openai --device` and enter the code it prints.
- **Telemetry** is on by default and honours `DO_NOT_TRACK=1`.
- **Gaps against Playwright:** no `fullyParallel`, `globalSetup`, HTML
  reporter, or `storageState` file import. See its Playwright migration page
  before moving a suite.
