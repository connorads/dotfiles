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
| **Catalogue** (default) | `~/skills` (public, symlinked from `.config/skills/public`) + `~/.config/skills/personal` (authored) + `vendor/.agents/skills` (vendored) | No | ~zero (pointer on demand) | hand-edit (authored); `skills add`/`update` project scope (vendor) |
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
  vendor/                  third-party "project"     · skl source 'vendor'
    .agents/skills/<name>/ real vendored files (CLI-managed, project scope)
    skills-lock.json       project lockfile (`skills update` from here refreshes in place)

~/.agents/skills/          AUTOLOAD tier (every session, every tool). Deliberately small:
  <authored-name> → symlink to ~/skills/<name> (authored; fanned out by skillsync)
  <vendored-name>/ real CLI clone (vendored; `skills add -g`, upstream-tracked)
~/.agents/.skill-lock.json TRACKED (un-ignored in ~/.gitignore): skills-CLI global lockfile —
                           records CLI-managed globals only. Authored symlinks are
                           skillsync-managed and absent here by design.
```

`skl` config (`~/.config/skl/config.json`), order = precedence — unchanged by the move
(`public` is a symlink → `~/skills`, which skl follows):

```json
{ "paths": [
  { "path": "~/.config/skills/public",                "name": "public" },
  { "path": "~/.config/skills/personal",              "name": "personal" },
  { "path": "~/.config/skills/vendor/.agents/skills", "name": "vendor" }
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

## Validated vendor sources

`skills add <repo> -l` first to resolve the exact `--skill` token (dir name vs frontmatter
name can differ — gotchas below).

| source (owner/repo) | trust |
|---|---|
| `vercel-labs/agent-skills` | trusted (official) |
| `vercel-labs/next-skills` | trusted (official) |
| `vercel-labs/skills` | trusted (the CLI repo) |
| `vercel-labs/agent-browser` | trusted (official) |
| `vercel-labs/portless` | trusted (Vercel org; same repo as the `npm:portless` CLI in mise) — `--skill portless` (named `.localhost` dev URLs: proxy setup, monorepo/worktree naming, port/proxy troubleshooting). Single `SKILL.md`, no scripts, only official URLs; pinned by `computedHash`. Repo also ships `oauth` (provider redirect-URI config for `.localhost` — vendor on demand). Doc text says `npm install -g`/"don't use npx" — counter to the never-npm rule, but it's prose only; CLI comes via mise. |
| `anthropics/skills` | trusted (official) |
| `elevenlabs/skills` | trusted (official; skills at repo root) |
| `mattpocock/skills` | trusted (bucketed paths) |
| `cloudflare/skills` | trusted (official) |
| `microsoft/playwright-cli` | trusted (official) |
| `firecrawl/cli` | trusted — `--skill firecrawl` (frontmatter name; lives at `skills/firecrawl-cli/`) |
| `heygen-com/hyperframes` | trusted (official) |
| `remotion-dev/skills` | trusted — `--skill remotion-best-practices` |
| `aaron-he-zhu/seo-geo-claude-skills` | trusted (original, 1.6K★) |
| `adithya-s-k/manim_skill` | trusted (reputable author) |
| `blader/humanizer` | re-sourced from softaworks aggregator → original author |
| `vercel-labs/open-agents` | trusted (Vercel org) — `--skill web-animation-design` (Emil Kowalski derivative; keep out of `public/`) |
| `cursor/plugins` | trusted (official Cursor) — large monorepo; `--skill thermo-nuclear-code-quality-review` (skillPath `cursor-team-kit/skills/…`) |
| `marimo-team/skills` | trusted (official) — `--skill marimo-notebook` (was vendored as `marimo`; upstream renamed) |
| `callstack/agent-device` | trusted (Callstack, 2.8k★, MIT) — `--skill agent-device` (router-only; needs `npm:agent-device ≥0.14.0` CLI, in mise). Repo also has `dogfood`. |
| `jakubkrehel/make-interfaces-feel-better` | trusted (Jakub Krehel, Founding Design Engineer @ Interfere, 1.4k★, MIT) — `--skill make-interfaces-feel-better`. Solo author, content-reviewed (5 md files, no scripts/links); implementation-detail UI polish (concrete CSS values, hit areas, `will-change`), distinct altitude from the taste/design pack. Pinned by `computedHash` (CLI 1.5.11 stores no ref). |
| `vercel-labs/emulate` | trusted (Vercel org) — `--skill emulate` (umbrella; CLI + programmatic API for local stateful API emulation). Repo has 12 skills (`apple aws github google linear microsoft next resend slack stripe vercel` + umbrella); only umbrella vendored — add per-service ones on demand. Single `SKILL.md`, no scripts; Socket/Snyk clean; pinned by `computedHash` (CLI stores no ref). Stack-specific → per-project `skills add` candidate. |
| `vercel-labs/deepsec` | trusted (Vercel org) — `--skill deepsec` (skillPath `packages/deepsec/SKILL.md`; AI vuln scanner docs-pointer). `SKILL.md` is pure docs-routing (no scripts/links; points at `node_modules/deepsec/dist/docs/` or `<clone>/docs/`). CLI via mise (`npm:deepsec = "2"`). Caveat: deepsec ships its `SKILL.md` inside its npm package dir, so `skills add` clones the **full monorepo** (~508K, 59 files: `src/`, `build.mjs`, `tsconfig`, `vitest.config.ts`, `package.json`) — kept bloat; `skills update -p` re-pulls the lot. None of it auto-runs (skills inject only `name`+`description`). |
| `leonxlnx/taste-skill` | **third-party, unvetted author** — design pack: `design-taste-frontend`, `high-end-visual-design`, `minimalist-ui`, `redesign-existing-projects`. Diff-review every refresh. |

Gotchas: `firecrawl/cli` → `--skill firecrawl-cli`; `remotion-dev/skills` → `--skill
remotion`; `vercel-labs/agent-skills` dir names are unprefixed but skill names are `vercel-*`
(CLI resolves by frontmatter name). `leonxlnx/taste-skill` internal skillPaths don't match
skill names (`taste-skill/`→design-taste-frontend, `soft-skill/`→high-end-visual-design,
`minimalist-skill/`→minimalist-ui, `redesign-skill/`→redesign-existing-projects); the CLI
resolves by frontmatter name regardless. Confirm all via `-l`.

Dropped sources: `softaworks/agent-toolkit` (aggregator; humanizer re-sourced to blader,
mermaid-diagrams + dependency-updater removed), `pproenca/dot-skills` (vhs removed, low trust),
`better-auth/skills`, `intellectronica/agent-skills`, `msmps/opentui-skill` (skills removed).

**Attribution (before any public push):** `logging-best-practices` (Boris Tane) and
`web-animation-design` (Emil Kowalski) are derivatives — keep them out of `public/`.

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
  can't refresh them; re-`skills add` if/when a source is found. List the untracked ones —
  on disk but absent from the lockfile:

  ```bash
  comm -23 <(ls ~/.config/skills/vendor/.agents/skills | sort) \
           <(jq -r '.skills|keys[]' ~/.config/skills/vendor/skills-lock.json | sort)
  ```

  Current untracked: `govuk-style` — from a **gist**
  (`gist.github.com/fofr/505e225f9bf5e839d30c12ba6bfa0be2`), so the CLI can't ingest it
  (it rewrites the URL to `github.com/fofr/505e…git`, which 404s — gists live on a
  different host). Single `SKILL.md`, no scripts; refresh by re-cloning the gist and
  diffing. GOV.UK / GDS house-style prose skill (plain English, sentence case, no bold).

- `connorads/skills` public repo is **deferred** — public skills are pre-staged at `~/skills`
  (top-level, dotfiles-tracked) so publishing is `cd ~/skills && git init` with no path churn,
  just a tracking handoff (dotfiles stops tracking its contents). Sanitise any personal refs
  first; none currently. `~/.config/skills/public` stays as a compat symlink afterwards.
