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
| **Catalogue** (default) | `~/skills` (public, symlinked from `.config/skills/public`) + `~/.config/skills/personal` (authored) + `vendor/.agents/skills` (CLI-vendored) + `vendor/<name>` (manually-vendored) | No | ~zero (pointer on demand) | hand-edit (authored); `skills add`/`update` project scope (vendor) |
| **Per-project** | `<repo>/.agents/skills/<name>` | Only in that repo's sessions | one repo's worth | `skills add` (no `-g`) from the repo |
| **Autoload (global)** | `~/.agents/skills/` | Yes — every session, every tool | every session | `skills add -g` (vendored) · symlink + `skillsync` (authored) |

**Autoload is kept deliberately minimal** — inspect `~/.agents/skills/` for the current
set. Promote only when you catch yourself wishing something fired automatically. Vendored →
`skills add -g <x>`; authored → symlink into `~/.agents/skills` then `skillsync` (`skills
add -g` clones a *second* copy into the dotfiles-tracked `~/.agents/skills`; the symlink
keeps one real copy in `~/skills`).

## The rubric (apply to every future skill)

```text
1. Provenance → home.
     authored   → ~/.config/skills/{public|personal}  (plain dirs, you edit in place)
     third-party→ ~/.config/skills/vendor             (skills CLI, project scope)
2. Keep?  off-domain / unused / redundant → REMOVE (reinstall from upstream later).
3. Default tier = catalogue (skl), zero session cost. Everything kept lands here.
4. + Per-project (`skills add` into a repo) iff stack-specific (auto-fires only in that stack).
5. + Global autoload iff broad AND must-auto-fire AND regular. Vendored: `skills add -g`.
     Authored: symlink into ~/.agents/skills + `skillsync`. Current set: `ls ~/.agents/skills`.
6. Authored publishable? ~/skills (future connorads/skills) : personal/ (never public).
```

Axes to weigh: **frequency** (never/rare/regular), **breadth** (broad vs stack-specific),
**trigger mode** (auto-fire vs deliberate), **provenance** (authored/vendored),
**publishability** (public/personal).

## Layout

```text
~/skills/<name>/           authored PUBLIC, real files · skl source 'public' (via symlink) · → future connorads/skills

~/.config/skills/
  AGENTS.md                this file (canonical)  ·  CLAUDE.md → symlink
  public                   → symlink to ../../skills (compat: skl/autoload/refs resolve through it)
  personal/<name>/         authored, personal       · skl source 'personal'
  vendor/                  third-party "project"     · skl sources 'vendor' + 'vendored'
    <name>/                manually-vendored skills at depth 4 (skills.sh-registerable) · skl source 'vendored'
    .agents/skills/<name>/ real CLI-cloned files (CLI-managed, project scope) · skl source 'vendor'
    skills-lock.json       project lockfile (`skills update` from here refreshes in place)

~/.agents/skills/          AUTOLOAD tier (every session, every tool). Deliberately small:
  <authored-name> → symlink to ~/skills/<name> (authored; fanned out by skillsync)
  <vendored-name>/ real CLI clone (vendored; `skills add -g`, upstream-tracked)
~/.agents/.skill-lock.json TRACKED (un-ignored in ~/.gitignore): skills-CLI global lockfile —
                           records CLI-managed globals only. Authored symlinks are
                           skillsync-managed and absent here by design.
```

`skl` config (`~/.config/skl/config.json`), order = precedence (`public` is a symlink
→ `~/skills`, which skl follows). The `vendored` source roots at `vendor/` so its non-dot
Glob serves the depth-4 manually-vendored skills while naturally skipping the `.agents/`
nested CLI clones (no overlap with `vendor`):

```json
{ "paths": [
  { "path": "~/.config/skills/public",                "name": "public" },
  { "path": "~/.config/skills/personal",              "name": "personal" },
  { "path": "~/.config/skills/vendor/.agents/skills", "name": "vendor" },
  { "path": "~/.config/skills/vendor",                "name": "vendored" }
] }
```

## How-to

### Add an authored skill

Create `<name>/SKILL.md` (+ supporting files): public skills in `~/skills/<name>/` (their
real home, symlinked from `.config/skills/public`), personal in
`~/.config/skills/personal/<name>/`. Public iff shareable with no personal refs; personal
otherwise. No CLI, no lockfile — you edit in place. `skl <name>` finds it immediately.
The `.gitignore` un-ignore is already in place for `~/skills/**`, `personal/**`, `vendor/**`;
new top-level files need their own un-ignore before `dotfiles add`.

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

### Promote to per-project

When working in a repo whose stack matches a skill, `cd <repo>` and `skills add <owner/repo>
--skill <name>` (no `-g`). It auto-fires for that repo's sessions only. Candidates:
`next-*`, `vercel-*`, `cloudflare`, `remotion-best-practices`, `claude-api`, `marimo-notebook`,
`logging-best-practices`, `web-design-guidelines`, `accessibility`, `holistic-ux`, `hk`,
`test-coverage`, `mechanical-enforcement`.

### Promote to global autoload (rare)

Reserve for broad + must-auto-fire + regular skills. Two paths by provenance, because the
deciding axis is **upstream tracking**:

**Vendored** (real upstream) → `skills add -g <owner/repo> --skill <name>`. Lands a clone in
`~/.agents/skills/`, the CLI fans it into every selected tool (more than `skillsync`'s list:
cline, zed, warp, deepagents, …) and `skills update -g` pulls upstream fixes.
`~/.agents/.skill-lock.json` records the CLI-managed set (currently `playwright-cli`).

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
so authored autoloads are absent from the global lockfile by design — which is also why
`skills update -g` (playwright) never clobbers them.

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

- Some vendored skills have **no recorded upstream** (manually moved in) → `skills update`
  can't refresh them, and they are **absent from `skills-lock.json` by design**. These two —
  `govuk-style`, `ponytail` — live one level up at `vendor/<name>/` (depth 4), not under
  `.agents/skills/`, so they are **discoverable by `skills add` / registerable on skills.sh**
  (the CLI's `findSkillDirs` caps at `maxDepth = 5`; depth 6 under `.agents/skills/` was never
  reached). skl serves them via the `vendored` source. The CLI-cloned, lock-tracked skills
  stay nested under `.agents/skills/`. List the manually-vendored (un-locked) ones:

  ```bash
  comm -23 <(find ~/.config/skills/vendor -mindepth 1 -maxdepth 1 -type d ! -name .agents -exec basename {} \; | sort) \
           <(jq -r '.skills|keys[]' ~/.config/skills/vendor/skills-lock.json | sort)
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

- `connorads/skills` public repo is **deferred** — public skills are pre-staged at `~/skills`
  (top-level, dotfiles-tracked) so publishing is `cd ~/skills && git init` with no path churn,
  just a tracking handoff (dotfiles stops tracking its contents). Sanitise any personal refs
  first; none currently. `~/.config/skills/public` stays as a compat symlink afterwards.
