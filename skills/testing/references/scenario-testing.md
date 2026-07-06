# Scenario Testing

Scenario tests prove that a named user or business journey works through the
real application composition. They sit above application/use-case tests and
below broad production-like end-to-end checks. The value is confidence that the
parts agree: routing, auth, parsing, persistence, UI state, background effects,
and operator controls.

They are expensive enough to keep sparse. Use them to sample the journeys that
would embarrass the product if broken; push branchy matrices and edge cases down
to pure domain or application tests.

## When to use

Reach for scenario tests when a behaviour only becomes meaningful across several
boundaries:

- login, access, code entry, or permission gates
- lifecycle transitions such as draft -> submitted -> reopened -> locked
- persistence across reloads, sessions, devices, or workers
- i18n/locale negotiation where server render, client render, and stored state
  must agree
- admin/operator actions that change what a user can do
- idempotency, resumability, retries, and save-as-you-go behaviour
- one smoke path for a hostile or rate-limited entry point

Do not use scenario tests to compensate for untested domain logic. If a rule has
many combinations, test the rule directly and include one representative journey
that proves the rule is wired into the composed app.

## Composition boundary

A scenario test should run the real application as a user or operator would see
it:

- real router, middleware, auth/session handling, serializers, validators, and
  UI hydration
- real owned persistence where it is cheap and deterministic
- real public or operator APIs for setup and postcondition checks where those
  APIs are part of the system contract
- faked third-party systems: email providers, payment gateways, remote auth,
  analytics, LLMs, and other services you do not own

Fake at the boundary. Stubbing your own modules inside a scenario test removes
the composition risk the test is meant to cover.

Playwright-style browser request interception only catches requests made by the
browser page. Server-side requests need a server-side fake, an application port,
or a local test service.

## Setup and cleanup

Treat backend state as part of test isolation. Browser contexts isolate cookies
and local storage, but they do not isolate shared databases, queues, flags, or
third-party fake state.

- Create fresh, uniquely named data per test.
- Prefer setup through app-owned surfaces: admin APIs, public APIs, CLIs, or
  supported import commands. Use direct storage writes only when no reasonable
  product/API seam exists.
- Clean up created records in fixture teardown, even when the test fails.
- Restore global settings in teardown; record the original value before changing
  it.
- Skip with an explicit prerequisite message when local secrets or services are
  absent, so contributors know how to enable the suite.
- Avoid exhausting hostile paths. Exercise a rate-limited or bot-protected path
  once, then use a cheaper authenticated shortcut for the remaining scenarios.

Parallel execution is the default goal. If the system has unavoidable global
state, isolate by namespace/test id where practical. Run serially only for the
global part, document the reason, and keep that suite small.

## Assertions and selectors

Assert on what the user or operator can observe, plus authoritative server state
when the scenario specifically promises persistence or reporting.

- Use role, label, text, and accessible name locators before test ids or CSS.
- Add accessible scopes to repeated UI regions. A named `role="group"` or
  `role="region"` often makes both the UI and the test clearer.
- Use web-first assertions that wait for a visible, enabled, checked, saved, or
  locked state. Avoid sleeps.
- Wait for hydration by observing enabled controls or other user-visible ready
  states before typing.
- Prefer concise helpers for repeated actions. Keep assertions in the scenario
  body when they explain the story.

## Suite shape

A good scenario suite usually has a small, named list of journeys:

- entry/access unlocks the protected experience
- segment or permission visibility is correct
- partial progress persists
- complete submission locks or finalises the workflow
- operator/admin action reopens or changes user capability
- global closed/disabled state blocks writes
- one locale or device smoke if those are business-critical

Keep the command separate from fast unit/lint/a11y checks unless the suite is
tiny. It is often better as an explicit CI job, pre-deploy check, or nightly
suite than as a default pre-commit hook.

## Anti-patterns

- Broadly enumerating domain combinations through the browser.
- Reusing seeded/shared data that can be changed by another test or developer.
- Direct database writes that bypass the very setup contract the scenario is
  supposed to validate.
- Stubbing owned modules while claiming composition coverage.
- CSS/XPath selectors tied to layout rather than user meaning.
- Whole-test retries to hide races. Poll for known asynchronous outcomes instead
  and fix the source of nondeterminism.
- Testing external websites or providers you do not control.
