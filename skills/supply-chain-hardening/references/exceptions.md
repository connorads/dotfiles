# Exception discipline

Every gate accumulates exceptions — native modules that need build scripts,
publishers whose CI broke provenance, fast-moving tools exempted from the
quarantine. Exceptions are where hardened setups rot: each one is a hole cut
deliberately, and unmanaged holes outlive their reasons. The per-tool
exception vehicles (which key, which file) are in
[ecosystems.md](ecosystems.md); this file is the discipline for using them.

## The exception template

Every exception gets all four, recorded next to the config entry (a comment
in the config file is the right place — it travels with the exception):

1. **Scope** — one package (and version range where the vehicle supports
   it), one gate. Never a global disable, never a whole-scope glob unless the
   scope is genuinely one publisher.
2. **Reason** — the specific upstream condition, with a link (issue,
   advisory, changelog). "It broke the build" is not a reason; "native module
   needs node-gyp at install; build script reviewed at vX.Y" is.
3. **Exit criterion** — the observable condition under which the exception
   is removed ("upstream restores provenance", "cargo age gate stabilises",
   "we drop this dependency").
4. **A report-only recheck.** Every escape hatch exists because of a
   *temporary* upstream condition, and nothing else will notice when the
   condition clears. Give each a periodic automated recheck that FLAGs —
   never blocks — when the exception looks removable (e.g. a script that
   re-queries provenance for each `trustPolicyExclude` entry, or re-checks
   whether a pinned prerelease now has a stable release). Without this,
   exceptions silently age into permanence.

## Worked class 1: publishing bug, not attack

**Shape:** a package's provenance/trust evidence disappears on a new version
— same publisher, same signing key, but a CI refactor stopped attaching
provenance (commonly: the root package keeps it, platform-specific sibling
packages lose it). A `no-downgrade` trust policy correctly refuses.

**Judgement:** verify it's the same publisher and signing identity, find the
upstream change that explains the loss (CI config change, release-flow
migration), and check the diff of the published artifact if feasible. If it
holds up: scoped trust-policy exclude for exactly the affected packages, the
upstream link in the comment, exit criterion "remove when provenance
returns", recheck = re-query provenance periodically.

**Not this class:** provenance loss *plus* publisher change, new maintainer,
or unexplained artifact changes — that is the takeover signature the policy
exists for. Refuse and investigate.

## Worked class 2: aged backport vs live takeover

**Shape:** a trust check flags a years-old version published without
provenance — typically a backport to an old major line, published before the
ecosystem had provenance at all or via an older release flow.

**Judgement:** account age. A real takeover is a live incident in its first
days; a version that has sat unmodified for a year with millions of installs
is not an active attack. An age-based carve-out
(pnpm `trustPolicyIgnoreAfter`-style: skip the downgrade check for versions
older than a window) removes the whole false-positive class while keeping
fresh publishes fully gated. Set the window to complement the age gate so no
version falls between them: everything younger than the window gets the
trust check, everything younger than the quarantine gets the age gate.

## When is a one-off bypass acceptable?

Some tools offer ephemeral bypasses (env var, CLI flag), others force a
tracked config edit — the per-tool table is in
[ecosystems.md](ecosystems.md#gate-evasion-and-escape-hatch-asymmetries).

- **One-off bypass** (env/flag): acceptable for a genuinely one-shot,
  human-attended operation — an urgent patch install you will re-gate
  immediately, a scanner offline during an incident drill. The command line
  is the audit trail; nothing persists.
- **Tracked config exception**: required for anything CI or another machine
  will repeat. If the bypass will happen twice, it must be a config entry
  with the four-part template above.
- **Never**: disabling a gate globally to make one package install, or
  bypassing via an untracked local config that makes machines diverge.

Agents: the bypass decision is the user's, every time. Propose the narrowest
vehicle with the template filled in; don't apply it unprompted.
