---
title: Quarantine everything
description: A 4-day cooling-off period on every package manager, trust policies that fail on provenance downgrades, and install scripts blocked by default - the floor that makes unattended agents defensible.
---

## The itch

My most-typed command starts an AI agent with its permission prompts switched
off. That's a deliberate trade, and it only works because of what's underneath
it: agents install packages while I'm not watching, and every install is
arbitrary code chosen by a dependency graph rather than by me.

The npm worm waves of the last few years - Shai-Hulud and friends - spread
through freshly published versions, mostly executing via `postinstall`
scripts. "Freshly published" is the tell. Compromised releases are almost
always caught by the community within hours or days of going live; the danger
window is the gap between publish and detection. The default behaviour of
every package manager is to install straight into that window.

## What I do

Three preventive layers and one detective layer, all in global config, so
safety doesn't depend on per-project diligence - or on mine.

### A cooling-off period, everywhere

Nothing installs unless it has been public for four days. By then, a
compromised release has usually been yanked, flagged, or written up.

| Tool         | Setting               | Value                |
| ------------ | --------------------- | -------------------- |
| npm          | `min-release-age`     | `4` (days)           |
| pnpm         | `minimumReleaseAge`   | `5760` (minutes)     |
| aube         | `minimumReleaseAge`   | `5760` (minutes)     |
| bun          | `minimumReleaseAge`   | `345600` (seconds)   |
| uv           | `exclude-newer`       | `"4 days"`           |
| pip          | `uploaded-prior-to`   | `P4D`                |
| Yarn         | `npmMinimalAgeGate`   | `4d`                 |
| mise         | `minimum_release_age` | `"4d"`               |

One policy, eight spellings and three different time units - and Deno makes
nine for free, because it reads npm's key from `.npmrc`. The inconsistency
is a real footgun, so a pre-commit drift-guard parses every spelling (plus
pnpm's legacy fallback file), normalises each to days, and blocks any commit
where they disagree - agents can no longer "fix" one file to match another.
The coverage is the point: there is no package manager on my machines that
installs day-zero releases by default.

It's a default, not a cage. Every tool has an explicit escape hatch for the
urgent one-off (`mise upgrade --bump --before 0d`, `bun install
--minimum-release-age=0`, and so on) - the friction is the security control,
so bypassing it is a decision you make out loud.

### Install scripts blocked

The quarantine slows a compromised package down; blocking lifecycle scripts
takes away its favourite trigger. `ignore-scripts=true` (npm) and
`ignoreScripts: true` (pnpm) are set globally, npm's `allow-git=none` blocks
git dependencies (which can execute code even with scripts disabled), and
aube runs nothing unless a package is explicitly approved. When a native
module genuinely needs its build script, it gets allow-listed narrowly, per
package, per project - never globally re-enabled.

### Trust that can only go up

Age gates don't help when an attacker compromises a package you already use.
So pnpm and aube run a `no-downgrade` trust policy: if a package that used to
ship with provenance suddenly doesn't - the classic signature of a hijacked
publish flow - the install fails. mise verifies GitHub attestations and SLSA
provenance at install time, and a committed lockfile pins exact versions and
checksums across the three platforms I run, so every machine installs the
identical vetted artifact rather than re-resolving for itself.

### A detective layer, because prevention is time-based

Everything above buys time; none of it proves a package is clean. The 2026
worm wave shipped packages with *valid* SLSA provenance. So `mise run
supply-audit` scans a project's lockfiles against the OSV malware and
vulnerability database via osv-scanner - the layer that catches what already
slipped through. The same sweep also runs automatically on every routine
update: before anything is bumped, every tracked lockfile is scanned, a
malware advisory aborts the update with the tree still clean, and ordinary
CVEs are reported without blocking - detection on the default path, not just
when I remember to ask for it.

### The honest exemption

The agent CLIs themselves - claude, codex, amp - are exempt from the
quarantine and run at `latest`. That's the most asymmetric trust decision in
the whole setup: the most privileged binaries are the least gated. It's
deliberate. A vendor's signed release pipeline is a different trust class
from npm's long tail, agent capability improves week to week, and a four-day
lag on the tool doing most of the work is a real cost against a small
marginal risk. I'd rather state that trade plainly than pretend the policy
has no exceptions.

## Why it compounds

The quarantine turns "is this package safe?" from a per-install judgement
call - one I'd get wrong eventually, and agents would get wrong sooner - into
a standing default that costs nothing after setup. That's the same shape as
everything else on this site: encode the decision once, stop spending
attention on it.

It's also what the agent workflow stands on. Running agents without
permission prompts is only defensible because the thing those prompts mostly
guarded against - unvetted code execution via the package registry - is
handled below them, by configuration that doesn't care whether a human or a
model typed the install command. Make the fast path safe, and you never have
to choose between the two.

## Steal this

You don't need eight config files. Two lines in `~/.npmrc` cover npm (and
Deno):

```ini
min-release-age=4
ignore-scripts=true
```

And for pnpm 11, two lines in its global `config.yaml`:

```yaml
minimumReleaseAge: 5760 # 4 days, in minutes
ignoreScripts: true
```

That's the bulk of the protection: no day-zero installs, no lifecycle-script
execution. When a project genuinely needs a build script, allow-list that one
package rather than turning the setting off - the moment of friction is the
control working.
