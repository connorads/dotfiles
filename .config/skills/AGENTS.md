# Skills curation

How agent skills are organised, where each kind lives, and how to add/promote/update
them. This is the **single home for curation intent** — it lives with the config, not in
`skl` (skl is generic software; its `docs/adr/` is for building skl, not my curation).

`CLAUDE.md` here is a symlink to this file (dotfiles `AGENTS.md` convention).

## The problem this solves

Every skill installed under `~/.agents/skills/` is symlinked into ~10 agent tools by
`skillsync`, and each tool injects *every* installed skill's `name`+`description` into
*every* session as fixed context. 68 skills = 68 descriptions loaded in every session,
most for skills that are rarely used and never need to auto-fire. The fix: keep the
**autoloaded** set tiny and intentional — the filesystem at `~/.agents/skills/` is the
source of truth for what is currently global — keep everything else one `skl` popup away
(~zero session cost), and make stack-specific skills installable per-project.

## Tiers — and the CLI scopes that map to them

`skl` (`~/.config/skl/`) is a **deliberate skill loader**: it scans configured source
dirs and injects a tiny pointer (name + path + tree + "read SKILL.md") into the agent's
tmux pane on demand — progressive disclosure, no autoload, ~zero session cost.

The `skills` CLI's **global** install dir is hard-coded to `~/.agents/skills` and is
**not** configurable. But its **project** scope (`skills add` *without* `-g`, run from a
dir) installs into `<cwd>/.agents/skills/<name>` with a project-local
`skills-lock.json`, and `skills update` from that dir refreshes **in place**. So the
CLI's two scopes *are* our two managed tiers:

| Tier | Where | Autoloaded? | Session cost | Managed by |
|------|-------|-------------|--------------|------------|
| **Catalogue** (default) | `~/skills` (public, symlinked from `.config/skills/public`) + `~/.config/skills/personal` (authored, public-in-dotfiles) + `~/.config/skills/private` (authored) + `vendor/<name>/.agents/skills` (vendored sets) + `vendor/.agents/skills` (unsorted CLI-vendored) + `vendor/manual/<name>` (manual bucket) | No | ~zero (pointer on demand) | hand-edit (authored); `skills add`/`update` project scope (sets + vendor) |
| **Per-project** | `<repo>/.agents/skills/<name>` | Only in that repo's sessions | one repo's worth | `skills add` (no `-g`) from the repo |
| **Autoload (global)** | `~/.agents/skills/` | Yes — every session, every tool | every session | symlink + `skillsync` (authored → `~/skills`, vendored → the vendor copy); `skills add -g` only for a non-catalogue global |

**Autoload is kept deliberately minimal** — inspect `~/.agents/skills/` for the current
set. Promote only when you catch yourself wishing something fired automatically. Either
provenance promotes by symlink + `skillsync`: authored skills link to `~/skills/<name>`,
vendored ones to their vendor-tier copy (one real clone, patches/refreshes apply once).
`skills add -g` clones a *second* copy into the dotfiles-tracked `~/.agents/skills` — use
it only for a global you deliberately keep out of the catalogue.

## Vendored shapes

Everything third-party is **vendored** and lives under the single `vendor/` root. There is
no provenance split above it — the shapes below differ only in *how they are refreshed and
promoted*, not in where they come from:

- **set** (`vendor/<name>/`) — a *cohesive* multi-skill upstream, one skills-CLI project dir
  with its **own lockfile**. `skills update -p` from the set dir refreshes it as a unit, and
  `skl install <set>/` copies the whole set into a matching-stack repo. Examples: `expo`,
  `elevenlabs`.
- **unsorted bucket** (`vendor/.agents/skills/`) — CLI-vendored *singletons* sharing one
  lockfile (`vendor/skills-lock.json`). Skills that don't belong to a cohesive upstream group.
- **manual bucket** (`vendor/manual/<name>/`) — hand-placed skills with **no upstream and no
  lockfile** (gist / tweet / distillation). Refreshed individually by re-cloning and
  re-applying; never `skills update`-able. Examples: `govuk-style`, `ponytail`, `bro`.

**Promotion unit is the deciding axis for a set.** The strongest reason a group earns set
status is that a set is the unit you `skl install <set>/` into a repo whose stack matches —
the whole cohesive group travels together as vetted bytes. Update-isolation (its own
lockfile) is a consequence, not the point.

**Threshold — when a vendored group becomes a set:** a vendored *single* stays in the
unsorted bucket. Promote a group to a set **iff** it is a cohesive multi-skill upstream you
will `skills update` / `skl install` as one unit — either a generic-name collision risk (as
elevenlabs's `agents` / `music`) or a whole stack you enter and leave as a unit (as `expo`).
The **manual** skills are a bucket regardless of count: they share only provenance (no
upstream, no lockfile, refreshed individually), so they never become a set.

## The rubric (apply to every future skill)

```text
1. Provenance → home.
     authored   → ~/.config/skills/{public|personal|private}  (edit in place)
     third-party→ ~/.config/skills/vendor                     (skills CLI, project scope)
2. Keep?  off-domain / unused / redundant → REMOVE (reinstall from upstream later).
3. Default tier = catalogue (skl), zero session cost. Everything kept lands here.
4. + Per-project (`skills add` into a repo) iff stack-specific (auto-fires only in that stack).
5. + Global autoload iff broad AND must-auto-fire AND regular. Symlink into
     ~/.agents/skills + `skillsync` (authored → ~/skills; vendored → its vendor copy).
     Current set: `ls ~/.agents/skills`.
6. Authored routing: showcase → ~/skills (future connorads/skills) ; personal → personal/ ;
     private → private/.
```

Axes to weigh: **frequency** (never/rare/regular), **breadth** (broad vs stack-specific),
**trigger mode** (auto-fire vs deliberate), **provenance** (authored/vendored),
**publishability** (showcase / personal / private).

## Learnings from using a skill

Route per the global `## Self-improvement` rule: durable domain learnings go into the
catalogue skill that owns them, *proposed with a diff*, not auto-applied. Curation-specific:
new skills are suggested, never auto-authored - tier, provenance, and publishability (rubric
above) are curation calls.

## Layout

```text
~/skills/<name>/           authored PUBLIC, real files · skl source 'public' (via symlink) · → future connorads/skills

~/.config/skills/
  AGENTS.md                this file (canonical)  ·  CLAUDE.md → symlink
  public                   → symlink to ../../skills (compat: skl/autoload/refs resolve through it)
  private                  → symlink (gitignored) to a standalone clone with its OWN git
                             history - commit in the resolved repo, not via dotfiles; its
                             root AGENTS.md documents the wiring · skl source 'private'
  personal/<name>/         authored, personal (public-in-dotfiles, not showcased) · skl source 'personal'
  vendor/                  single third-party (VENDORED) root · skl sources 'expo'/'elevenlabs'/'vendor'/'manual'
    <set>/                 vendored SET = one skills-CLI project dir per cohesive group · skl source '<set>'
      .agents/skills/<name>/  real CLI-cloned files (CLI-managed, project scope)
      skills-lock.json     the set's own lockfile (`skills update -p` from here refreshes in place)
    .agents/skills/<name>/ unsorted bucket: real CLI-cloned singletons (project scope) · skl source 'vendor'
    skills-lock.json       the unsorted bucket's lockfile (`skills update` from vendor/ refreshes in place)
    manual/<name>/         manual bucket: manually-vendored skills (no upstream, no lock) · skl source 'manual'
    patches/               local-patch definitions (skill-patch source of truth)

~/.agents/skills/          AUTOLOAD tier (every session, every tool). Deliberately small:
  <authored-name> → symlink to ~/skills/<name> (authored; fanned out by skillsync)
  <vendored-name> → symlink to ../../.config/skills/vendor/.agents/skills/<name>
                    (vendored global: ONE real clone lives in the vendor tier, so
                    refreshes + local patches apply once; currently playwright-cli)
~/.agents/.skill-lock.json TRACKED (un-ignored in ~/.gitignore): skills-CLI global lockfile —
                           records CLI-managed globals only, and every current global is
                           a symlink, so its skills map is empty. Symlinked globals
                           (authored and vendored alike) are absent here by design.
```

`skl` config (`~/.config/skl/config.json`), order = precedence (first match wins). `public`
and `private` are symlinks skl follows; a missing/uncloned source yields no skills (friendly
empty, not a throw — verified in `skl/src/shell/fs.ts`), so config may list a source before its
dir exists. Each vendored set (`vendor/<name>`) is one more source, rooted at its own
`.agents/skills` exactly like the unsorted `vendor` bucket; the sets sit *above* the `vendor`
source so a grouped skill wins over an unsorted singleton of the same name. The `manual`
source roots directly at `vendor/manual`, a plain subtree with no `.agents/` nesting, so it
never overlaps the CLI-managed sources; it stays last. All four vendored sources share the
one `vendor/` root:

```json
{ "paths": [
  { "path": "~/.config/skills/private",                         "name": "private" },
  { "path": "~/.config/skills/personal",                        "name": "personal" },
  { "path": "~/.config/skills/public",                          "name": "public" },
  { "path": "~/.config/skills/vendor/elevenlabs/.agents/skills", "name": "elevenlabs" },
  { "path": "~/.config/skills/vendor/expo/.agents/skills",       "name": "expo" },
  { "path": "~/.config/skills/vendor/.agents/skills",           "name": "vendor" },
  { "path": "~/.config/skills/vendor/manual",                   "name": "manual" }
] }
```

## How-to

### Add an authored skill

Create `<name>/SKILL.md` (+ supporting files) in the right source dir:
`~/skills/<name>/` (showcase), `~/.config/skills/personal/<name>/`, or the `private` source
(`.config/skills/private/`). No CLI, no lockfile — you edit in place; `skl <name>` finds it
immediately. The `.gitignore` un-ignore is already in place for `~/skills/**`, `personal/**`,
`vendor/**`; `private` stays ignored. New top-level files need their own un-ignore before
`dotfiles add`.

### Add / vendor a third-party skill

```bash
cd ~/.config/skills/vendor
skills add <owner/repo> -l                 # list skills in the repo, resolve exact --skill token
skills add <owner/repo> --skill <name>     # project scope → vendor/.agents/skills/<name> + lock
```

Use **fully-qualified** `owner/repo` + `--skill`, never fuzzy `skills find`. Pin to a
`ref`/commit where the upstream offers one. Re-fetching is an unvetted git clone that
bypasses npm/aube/quarantine posture — review the clone before trusting it.

### Update vendored skills

From `~/.config/skills/vendor`: `skills update -p` (project scope) refreshes **in place**
against `skills-lock.json`. No global/symlink resurrection problem.

### Install a catalogue skill/group into a project (frozen local copy)

`skl install <ref>` copies a catalogue skill — or a whole group with `skl install
<source>/` — into the current repo's `.agents/skills/`, delegating to `skills add
<local-path>`. Because the source is the local catalogue, it is a **frozen local copy**
(`sourceType: "local"` in the project's `skills-lock.json`), not an upstream-tracked pin:
the vetted bytes travel and `skills update` won't auto-change them. Use this to pin the
exact reviewed bytes into a repo. Picker: `ctrl-i`. Refuses `$HOME` / non-work-tree. This
differs from the fetch path below (`skills add <owner/repo>`), which clones upstream and
stays `skills update`-able. See `skl` ADR-0008.

### Promote to per-project

When working in a repo whose stack matches a skill, `cd <repo>` and `skills add <owner/repo>
--skill <name>` (no `-g`). It auto-fires for that repo's sessions only. Candidates:
`next-*`, `vercel-*`, `cloudflare`, `remotion-best-practices`, `claude-api`, `marimo-notebook`,
`logging-best-practices`, `web-design-guidelines`, `accessibility`, `holistic-ux`, `hk`,
`test-coverage`, `mechanical-enforcement`.

### Promote to global autoload (rare)

Reserve for broad + must-auto-fire + regular skills. Two paths by provenance, because the
deciding axis is **upstream tracking**:

**Vendored** (real upstream) → vendor it into the catalogue first (project scope, above),
then symlink the vendor copy into the autoload dir and fan out:

```bash
ln -s ../../.config/skills/vendor/.agents/skills/<name> ~/.agents/skills/<name>
skillsync
```

One real clone serves both tiers, so a `skills update -p` refresh and any
`vendor/patches/` local patch apply once and reach every tool (playwright-cli is this
shape: patched allowed-tools, globally autoloaded). A separate `skills add -g` clone is
the fallback only for a skill you deliberately do NOT want in the catalogue — it lands a
second CLI-managed copy in `~/.agents/skills/` recorded in `~/.agents/.skill-lock.json`
and refreshed with `skills update -g` (that set is currently empty).

**Authored** (you *are* upstream) → symlink the skill into `~/.agents/skills/`, then run
`skillsync` to fan out:

```bash
ln -s ../../skills/<name> ~/.agents/skills/<name>   # real files stay in ~/skills
skillsync                                           # → per-tool symlinks (resolve to ~/skills)
```

Why not `skills add -g` for authored skills? They already live in a public repo —
`connorads/dotfiles`, *this* repo, at `skills/` — so `skills add -g connorads/dotfiles
--skill <name>` would even work. But `-g` clones a **second real copy** into
`~/.agents/skills`, which dotfiles tracks, so you'd commit two copies of the same skill back
into the repo it came from (circular, and the duplication we're avoiding). `skills update`
is pointless on your own code anyway. The symlink keeps **one** real copy in `~/skills`.
`skillsync` follows symlinked entries (the `(-/)` glob) and never reads `.skill-lock.json`,
so symlinked autoloads are absent from the global lockfile by design — which is also why
`skills update -g` never clobbers them.

Caveat for a *personal* authored autoload: dotfiles are public, so its installed copy needs
gitignoring — and "personal + autoloaded everywhere" cuts against the keep-autoload-small
philosophy anyway.

## Rejected alternatives

- **Autoload manifest / allowlist file** — a curated list the agent loads at session start.
  Rejected: still pays per-session description cost for everything listed, and no agent tool
  supports a partial-load manifest. `skl` (deliberate, on-demand) gives ~zero cost instead.
- **Symlink trick** (symlink catalogue skills into `~/.agents/skills` so one set of files
  serves both tiers) — rejected *as a way to avoid autoload*: any global presence reintroduces
  autoload, which is exactly what you don't want for a catalogue-only skill. NOTE the
  distinction: deliberately symlinking an authored skill you *do* want autoloaded
  (`architecture`, `typescript`) is the supported path above — the `skills update -g` clobber
  worry doesn't apply there because authored symlinks aren't in the global lockfile, so the
  CLI never walks to them. The rejection stands only for skills you want kept *out* of autoload.
- **One-folder lockfile split** (keep all vendored skills in one dir, slice the lockfile by
  tier) — rejected: the CLI manages one lockfile per dir; splitting it by hand fights the
  tool. Project scope gives a real per-tier lockfile for free.
- **Top-level `sets/` dir separate from `vendor/`** (the original layout) — rejected: sets
  and the `vendor` bucket are *both* skills-CLI clones, so two sibling roots implied a
  provenance split that does not exist and invited the abstraction to accrete. Folded into
  one `vendor/` root holding all shapes (set / unsorted bucket / manual bucket); `skl`
  discovery is per-source-root with `dot:false`, so a set nested under `vendor/` never
  collides with the unsorted `vendor` source (its `.agents/` is dot-skipped).
- **Tracking the empty global skill-lock** (incl. committing its `lastSelectedAgents` /
  `dismissed` UI keys, or a clean filter à la `codex-config-clean` to strip them) — rejected:
  `skillsync` ignores the lockfile and the UI keys don't touch autoload or session cost, so
  versioning an always-empty, CLI-regenerated file (or building a filter for it) is machinery
  for zero value. Tracked once a global skill is promoted (it then pins provenance);
  left untracked only while autoload is genuinely empty.
- **Hard-deprecating skillsync** (CLI for everything; delete skillsync) — rejected: it's the
  active path for authored autoload. Public authored skills do live in a repo now
  (`connorads/dotfiles`), but routing them through `skills add -g` means a clone-back
  round-trip + a duplicate copy committed back into the repo they came from, and *personal*
  authored skills live in no public repo, so the CLI can't reach them at all. skillsync
  symlinks the real files in place — one copy, no round-trip.

## The constraint that forced project-scope vendoring

The `skills` CLI hard-codes its **global** install dir to `~/.agents/skills` (not
configurable — verified in the CLI source). That's why vendored skills can't simply be
`skills add -g`'d into the catalogue: global = autoload, always. The CLI's **project**
scope (install into `<cwd>/.agents/skills` + local lock, `update` in place) is the only
CLI-managed way to keep a skill `update`-able *without* autoloading it. Hence
`vendor/.agents/skills` is a project dir we treat as a catalogue source.

The CLI has **no audit/verify/scan** command and `skills.sh` is discovery-only; `skills add`
just git-clones. So vendoring is security-sensitive: use fully-qualified names, pin refs,
and diff-review clones against the prior vetted copy before trusting them.

## Caveats

- **Some vendored SKILL.mds carry local patches** (marked `LOCAL PATCH (connorads
  dotfiles)` in the file) stripping upstream directives that make agents self-install or
  refresh skills at task time — which bypasses pin-and-review vendoring. The declarative
  patch definitions in `vendor/patches/` are the **source of truth** (format spec +
  procedures in its README); `skill-patch apply|check` re-applies/verifies them, the
  update-vendored-skills flow runs apply after every refresh, and the hk
  `vendored-skill-patches` step blocks commits that stage a clobbered skill. Runtime
  guards in `.zshrc`: `HYPERFRAMES_NO_TELEMETRY=1` (PostHog off, gates the
  hyperframes-cli post-render feedback directive) and `HYPERFRAMES_SKIP_SKILLS=1` (stops
  `npx hyperframes init` refreshing installed skills at scaffold time).

- The skills CLI treats the vendor dir as a Claude Code project too: `skills update -p`
  fans every project skill into `vendor/.claude/skills/<name>` as symlinks to
  `.agents/skills/<name>`. Machine-generated, regenerated on every update, and gitignored
  (`/.config/skills/vendor/.claude/` in `~/.gitignore`) — the tracked copy is
  `.agents/skills/`. Only effect: those skills autoload for agent sessions started *inside*
  the vendor dir, which is not a working dir. The same holds for each vendored set:
  `vendor/*/.claude/` is gitignored (one wildcard covers every set) — tracked copy is
  `vendor/<name>/.agents/skills`.

- Some vendored skills have **no recorded upstream** (manually moved in) → `skills update`
  can't refresh them, and they are **absent from any `skills-lock.json` by design**. These three —
  `govuk-style`, `ponytail`, `bro` — live in the manual bucket at `vendor/manual/<name>/`
  (depth 5 from `~`), not under `.agents/skills/`, so they are **discoverable by `skills add`
  / registerable on skills.sh** (the CLI's `findSkillDirs` caps at `maxDepth = 5`, which
  `vendor/manual/<name>` sits exactly at; depth 6 under `.agents/skills/` was never reached).
  skl serves them via the `manual` source. The CLI-cloned, lock-tracked skills stay nested
  under `.agents/skills/`. List the manual bucket:

  ```bash
  find ~/.config/skills/vendor/manual -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort
  ```

  `govuk-style` — from a **gist**
  (`gist.github.com/fofr/505e225f9bf5e839d30c12ba6bfa0be2`), so `skills update` can't refresh
  it (the CLI rewrites the URL to `github.com/fofr/505e…git`, which 404s — gists live on a
  different host). Single `SKILL.md`, no scripts; refresh by re-cloning the gist and
  diffing. GOV.UK / GDS house-style prose skill (plain English, sentence case, no bold).

  `ponytail` — a hand-**distilled** lift from
  [`DietrichGebert/ponytail`](https://github.com/DietrichGebert/ponytail) (MIT, pinned at
  `c4d1925`). The "lazy senior dev" YAGNI/minimalism coding mode. Upstream is one good
  ruleset wrapped in 16 agent-tool adapters (hooks, an MCP server, per-host plugin
  manifests, benchmarks); none of that is vendored — only the knowledge. The six upstream
  `skills/` are merged into one: the core `ponytail` mode as `SKILL.md`, the `review` pass
  (with a whole-repo `audit` variant folded in) and the `debt` pass as `references/*.md`;
  upstream's separate `audit` skill is collapsed into `review.md` (it was a near-duplicate);
  the `gain` (benchmark-marketing) and `help`
  (plugin-command reference) skills are dropped. The always-on/mode-flag/`PONYTAIL_DEFAULT_MODE`
  runtime prose is trimmed (no hook engine behind it here). **No lock by design** — it's an
  adaptation, so `skills update` would clobber the merge; refresh by re-cloning upstream and
  re-applying the same distillation, diffing against this copy. `LICENSE` (MIT) is kept for
  attribution.

  `bro` — from a **tweet** by Dillon Mulroy
  (`x.com/dillon_mulroy/status/2079257150824620312`), so there's no repo/gist for `skills
  update` to refresh. Single `SKILL.md`, no scripts. Restates your last message in plain
  human language, no jargon; `disable-model-invocation: true` (deliberate `/bro` invoke only).

- `connorads/skills` public repo is **deferred** — public skills are pre-staged at `~/skills`
  (top-level, dotfiles-tracked) so publishing is `cd ~/skills && git init` with no path churn,
  just a tracking handoff (dotfiles stops tracking its contents). Sanitise any personal refs
  first; none currently. `~/.config/skills/public` stays as a compat symlink afterwards.
