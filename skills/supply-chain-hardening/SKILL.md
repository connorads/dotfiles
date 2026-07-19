---
name: supply-chain-hardening
description: >-
  Harden software supply chains across ecosystems (npm/pnpm/bun/yarn/aube,
  uv/pip, Cargo, GitHub Actions/aqua) by reasoning about what installing or
  importing a dependency actually executes, then choosing controls: release-age
  quarantine gates, install-script and load-time trigger removal, lockfile
  pinning and checksums, provenance/SLSA verification, and osv-scanner malware
  detection. Use when hardening a project or machine/global config (new or
  incremental); when converting age-gate settings/units between package
  managers; when a gate fires mid-task - a blocked install or build script, an
  age-gate or provenance refusal, a slopsquatted or unfamiliar package - and
  you must decide whether to allowlist; when adding a dependency you have not
  vetted; or when auditing a suspected compromised package. For linter rules,
  gitleaks, and zizmor use the mechanical-enforcement skill; for wiring checks
  into git hooks use the hk skill; for code-level vulnerability review of your
  own code use security-review.
---

# Supply-Chain Hardening

**Installing or importing a dependency runs someone else's code with your
privileges.** Every control in this skill exists to change what that sentence
permits: when the code runs, whether it runs at all, what it can do when it
does, and how you find out it was hostile.

This is a **content skill**, not a tool: it owns the *reasoning* — which
control, which layer, whether to allow an exception — while config files own
the *rules*. It serves three situations: hardening a project, hardening a
machine or global config, and an agent mid-task when a gate fires.

## Principles

1. **A dependency is code execution, not data.** Adding a package grants its
   publisher — and whoever compromises them — execution on your machines and
   CI. Vet accordingly, and extend the same reasoning to non-package
   dependencies: GitHub Actions, base images, MCP servers, agent skills.
2. **Removing triggers is not removing capability.** Blocking install scripts
   stops one execution path; the code still runs on import with full
   privileges. Every structural control closes a *trigger*; attackers move to
   the next one. That's why layers, not any one switch.
3. **Layer for defence-in-depth, and know each layer's limit.** Age gates
   detect nothing; scanners prevent nothing; provenance authenticates the
   pipeline, not the payload; runtime "permission" flags are seat belts, not
   boundaries. A layer whose limit you can't state is a layer you're
   over-trusting.
4. **A gate set is not a gate enforced.** Some tools' gates are advisory by
   default (aube falls back to an older version unless
   `minimumReleaseAgeStrict = true`; pnpm's *built-in* default gate is
   non-strict, though explicitly configuring the gate flips strict on).
   After configuring any gate, verify it fails closed — try to install
   something that should be refused.
5. **The agent proposes; the user decides; something boring verifies.**
   Allowlisting, bypassing, and weakening are the user's security decisions.
   Enforcement belongs in config, hooks, and CI — never in anyone's memory.
6. **Every exception is scoped, reasoned, and has an exit criterion.** An
   exception without an expiry condition is a permanent hole with a
   historical excuse. See [references/exceptions.md](references/exceptions.md).

## When to use this skill

- **New project or machine** → walk the five-layer stack below; per-tool keys
  and drop-in blocks in [references/ecosystems.md](references/ecosystems.md).
- **Hardening incrementally** → audit the existing setup against the stack;
  the usual gaps are a non-strict gate, an uncovered frozen-install path, and
  no detective layer.
- **A gate fired mid-task** → jump to "When a gate fires" below. Never bypass
  globally to keep a task moving.
- **Unfamiliar or agent-suggested package** → verify before installing (see
  "Slopsquatting").
- **Scanner hit or suspected compromise** →
  [references/incident-response.md](references/incident-response.md).
- **"Should we buy a scanner/firewall product?"** →
  [references/evaluating-dependencies.md](references/evaluating-dependencies.md).

Scope fence: if the task adds no dependency and touches no package-manager or
CI config, this skill has nothing to add — do the task without narrating
supply-chain considerations.

## Trigger vs capability

`ignore-scripts` removes a **trigger, not a capability**. Reason about which
execution triggers an ecosystem exposes, because closing one does nothing for
the others:

| Ecosystem | Install/build time | Load time |
|---|---|---|
| npm family | lifecycle scripts (blockable: npm 12+ default-off, pnpm/bun/aube block by default); git deps execute code even with scripts off | module top-level bodies and IIFEs run on `import`/`require` — not blockable, and where attackers moved when scripts got blocked |
| Python | build backends run at install | `.pth` files execute on **any interpreter startup, no import needed**; import hooks; top-level module code |
| Rust | `build.rs` and proc-macros run at **compile** time — no off-switch exists | — |

The load-time column is why "scripts are disabled, we're safe" is false, and
why the detective layer and containment exist. Runtime containment: real
boundaries are containers/VMs with no egress; Node's `--permission` is, per
its own docs, a seat belt and **not a security boundary** (known gaps:
`node:sqlite` filesystem access, no worker-thread inheritance, pre-init flag
escapes).

## The five-layer stack

| # | Layer | Control | Role | Limit |
|---|---|---|---|---|
| 1 | Quarantine | Release-age gate (per-tool keys: [references/ecosystems.md](references/ecosystems.md)) | Preventive: buys the community-catch window before you install a fresh compromise | Detects nothing; blind to old-but-bad versions; must be verified strict |
| 2 | Structural | Scripts off, git/exotic deps blocked, lockfile + checksums, trust policy | Removes install-time triggers; pins exactly what CI installs | Load-time execution untouched; lockfile pins whatever was resolved, good or bad |
| 3 | Containment | No-egress containers/VMs for untrusted installs and builds | Bounds what hostile code reaches | Only as strong as the isolation primitive; `--permission` flags are not boundaries |
| 4 | CI/CD | Default-deny egress, pinned actions, same script/gate policy as dev machines | CI is the highest-value target: it holds publish tokens | Config drift between CI and dev silently forks the policy |
| 5 | Detective | osv-scanner `MAL-*` matching, wired pre-mutation ([references/incident-response.md](references/incident-response.md)) | Catches what slipped every preventive layer | Trails advisory publication; can't parse tool-manager lockfiles |

Layer 5 is not optional garnish: malware campaigns have shipped with **valid
SLSA provenance** (a compromised pipeline signs its own malware), and the
large majority of malicious packages are pulled by registries without ever
receiving a CVE — so neither provenance nor CVE feeds substitute for `MAL-*`
matching. Provenance ≠ safety.

## Slopsquatting

Agents hallucinate plausible package names; attackers register them. Before
installing anything unfamiliar — especially a name suggested by an agent or
LLM output — verify existence, purpose match, age, downloads, and repository;
a brand-new low-download package answering exactly a niche need is the attack
shape. A strict age gate refuses brand-new names as a side effect;
low-download-threshold checks (aube) encode the same defence.

## Age-gate units: never copy a number between tools

The same 4-day policy is spelled in days (npm), minutes (pnpm, aube, Yarn),
seconds (bun), duration strings (mise, Deno, uv), and ISO-8601 (`P4D`, pip).
Copying a literal between configs silently changes the policy by orders of
magnitude. Full table and per-tool keys:
[references/ecosystems.md](references/ecosystems.md).

When one policy value is hand-spelled across several configs, enforce
agreement mechanically — a drift-guard pre-commit checker (one constant, one
file+regex+unit row per config, normalise, fail on drift). The
mechanical-enforcement skill owns that checker pattern.

## When a gate fires mid-task

The most common agent-facing situation: an install refused, a build script
blocked, a provenance or trust-policy failure. The gate firing is the system
working — the burden of proof is on the bypass.

1. **Identify which control fired** and what it's protecting against. Read
   the error, not just past it (`ERR_PNPM_IGNORED_BUILDS` = script blocking;
   "no mature version" = age gate; trust/provenance = downgrade check).
2. **Decide whether a bypass is even wanted.** Often the right move is to
   wait out the quarantine, pick an older version, or drop the dependency.
3. **Ask the user.** The security decision is theirs — never auto-bypass,
   however small the exception seems. Present the narrowest option and what
   it trades away.
4. **Allowlist narrowly**: per-package `allowBuilds`/`approve-scripts`/
   scoped exclude — never a global disable, never `ignore-scripts=false`
   globally, never removing the gate.
5. **Document scope, reason, and exit criterion in the config** where the
   exception lives — see [references/exceptions.md](references/exceptions.md)
   for the template and worked examples (publishing-bug-vs-attack, aged
   backports).

Hard lines: never `--no-verify` past a supply-chain hook; never disable a
gate globally to save a round-trip; a one-off env/flag bypass is for
human-attended one-shots only (the per-tool asymmetry — which tools even
offer one — is in [references/ecosystems.md](references/ecosystems.md)).

## Composition with neighbouring skills

- **mechanical-enforcement** owns linter-shaped controls — gitleaks, zizmor
  for GitHub Actions, cargo-deny licence/advisory bans, and the generic
  config-drift-guard checker pattern. This skill owns dependency posture:
  what to gate, what to scan, when to except.
- **hk** owns wiring: this skill says *what* to run (osv-scanner as update
  task + CI gate + hook); hk says *how* to hook it.
- **security-review** reviews your own code for vulnerabilities; this skill
  governs third-party code you adopt.

## Adding a new control or ecosystem

1. Identify which layer it belongs to (quarantine / structural / containment
   / CI / detective). If it claims two, it's probably two controls.
2. Prefer structural removal over runtime mitigation, and automated detective
   wiring over a manual task.
3. Record the tool's key, unit, and strictness default in
   [references/ecosystems.md](references/ecosystems.md) — verify each against
   the live tool, not memory; units and defaults are where the traps live.
4. Note the new tool's escape hatches and exception vehicle, and whether its
   gate applies on the frozen/lockfile install path.

## References

| When the task involves… | Read |
|---|---|
| Per-tool gate keys, units, strictness defaults, drop-in config blocks, escape-hatch table | [references/ecosystems.md](references/ecosystems.md) |
| A scanner hit, suspected compromise, wiring osv-scanner, provenance verification | [references/incident-response.md](references/incident-response.md) |
| Granting/reviewing an exception, allowlist templates, bypass acceptability | [references/exceptions.md](references/exceptions.md) |
| Choosing between local-OSS controls and commercial products; skills/MCP as dependencies | [references/evaluating-dependencies.md](references/evaluating-dependencies.md) |

`evals/` holds this skill's test prompts, fixtures, and assertions — run per
the writing-skills evals harness when revising. The compromised-lockfile
fixture is inert grading text; never install from it.
