# Incident response and the detective layer

What to do when a scanner goes red or you suspect a compromised dependency,
and how to wire detection so it fires without anyone remembering to run it.

## Suspected-compromise checklist

A `MAL-*` advisory (or credible report) against an installed version means
*treat the machine and its secrets as exposed*, not "schedule an upgrade".
Work the list in order:

1. **Stop the bleeding.** Don't run installs, builds, or tests in the
   affected tree — each is another execution opportunity. Pause CI jobs that
   install from the affected lockfile.
2. **Identify the version window.** From the advisory, establish which
   versions are affected and when they were published. Check the lockfile
   history (`git log -p` on the lockfile) for when the bad version entered
   and which machines/CI runs installed since.
3. **Assume execution if installed.** If an affected version was installed
   anywhere, assume its code ran (install script, import, or build). Valid
   provenance/signatures are **not** an all-clear — compromised-CI campaigns
   ship malware with valid SLSA provenance, because provenance proves where
   an artifact was built, not that it is benign.
4. **Rotate exposed secrets from a clean machine.** Tokens, SSH keys, cloud
   credentials, npm/PyPI publish tokens reachable from any machine that
   installed the package. Publish tokens first — they are how worms
   propagate.
5. **Pin or roll back.** Pin to the last known-good version (exact, not a
   range), regenerate the lockfile on a clean machine, and verify the scanner
   comes back green before unfreezing CI.
6. **Close the entry hole.** Ask which layer should have caught it: gate not
   strict? lockfile not verified in CI? scripts allowed? Fix that layer, and
   record the incident where the config lives.

Do not weaken the gate to make the deadline: a MAL hit the day before a
release is exactly the situation the gate exists for.

## Wiring the scanner: two placement rules

The detective layer only works if it runs without anyone deciding to run it.

**1. Scan before mutation, in the routine update path.** Wire
`osv-scanner scan source -r .` (v2 syntax; `source` is the default
subcommand) into whatever orchestrates routine updates — dependency-bump
scripts, the update task, CI on lockfile changes — *before any mutation*, so
a `MAL-*` match aborts with the tree still clean. An on-demand audit task
only detects when someone remembers; make it a pre-push hook or CI gate too
(the hk skill owns hook wiring).

**2. Split severities so the gate survives contact with reality.**

- **Block only on `MAL-*`** (matching id *or alias* — malware advisories are
  cross-referenced under GHSA ids too).
- **Report CVEs without blocking.** A dev-dependency CVE table is red on day
  one in any real project, and a red-by-default gate trains people to bypass
  it. CVEs get triaged separately.
- **Warn, don't fail, on scanner error or offline.** A detective control must
  not brick updates; a network blip is not a compromise.
- **Keep an explicit escape flag** (`--no-audit` shape) so the bypass is
  visible in the command line, not achieved by deleting the check.

## Scanner coverage

- osv-scanner matches lockfiles for npm/pnpm/bun, Cargo, uv/pip, Go, and
  more against the OSV database, including the `MAL-*` malicious-package
  advisories an age gate can't see. `MAL-*` entries are included by default.
- It **cannot parse tool-manager lockfiles** (mise.lock, flake.lock) — tool
  bumps stay covered by the preventive layer only (quarantine, attestations,
  checksums). Know which of your lockfiles the sweep actually reads.
- Native `npm audit` / `pnpm audit` / `bun audit` are GHSA-only — no `MAL-*`
  malware advisories. They are a fallback when osv-scanner is unavailable,
  not a substitute.
- uv's `UV_MALWARE_CHECK=1` (see [ecosystems.md](ecosystems.md)) is the same
  OSV `MAL-*` check enforced at install time for PyPI — it covers the
  `uv sync --frozen` path the resolution-time gate misses.

## Provenance and attestation checks

Verify provenance where the ecosystem supports it (npm provenance
statements, GitHub artifact attestations, SLSA) — it raises the cost of
impersonation and detects publisher-pipeline changes. Two rules:

- **Provenance ≠ safety.** It authenticates the build pipeline; a compromised
  pipeline signs its own malware. Treat it as one layer, never as clearance.
- **Re-verify on lockfile hits.** Some tools skip provenance verification
  when the lockfile already carries a checksum; enable re-verification at
  install time if the tool offers it, otherwise provenance only ever fires on
  first resolution.
