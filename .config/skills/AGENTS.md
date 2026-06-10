# Skills curation

How agent skills are organised, where each kind lives, and how to add/promote/update
them. This is the **single home for curation intent** — it lives with the config, not in
`skl` (skl is generic software; its `docs/adr/` is for building skl, not my curation).

`CLAUDE.md` here is a symlink to this file (dotfiles `AGENTS.md` convention).

## The problem this solves

Every skill installed under `~/.agents/skills/` is symlinked into ~10 agent tools by
`skillsync`, and each tool injects *every* installed skill's `name`+`description` into
*every* session as fixed context. 68 skills = 68 descriptions loaded in every session,
most for skills that are rarely used and never need to auto-fire. The fix: make the
**autoloaded** set tiny (ideally empty), keep everything one `skl` popup away (~zero
session cost), and make stack-specific skills installable per-project.

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
| **Catalogue** (default) | `~/.config/skills/{public,private}` (authored) + `vendor/.agents/skills` (vendored) | No | ~zero (pointer on demand) | hand-edit (authored); `skills add`/`update` project scope (vendor) |
| **Per-project** | `<repo>/.agents/skills/<name>` | Only in that repo's sessions | one repo's worth | `skills add` (no `-g`) from the repo |
| **Autoload (global)** | `~/.agents/skills/` | Yes — every session, every tool | every session | `skills add -g` / `skills remove -g` |

**Autoload starts empty by design.** Promote 1–2 skills later only if you catch yourself
wishing something fired automatically. `skills add -g <x>` is the one-step promotion.

## The rubric (apply to every future skill)

```
1. Provenance → home.
     authored   → ~/.config/skills/{public|private}   (plain dirs, you edit in place)
     third-party→ ~/.config/skills/vendor             (skills CLI, project scope)
2. Keep?  off-domain / unused / redundant → REMOVE (reinstall from upstream later).
3. Default tier = catalogue (skl), zero session cost. Everything kept lands here.
4. + Per-project (`skills add` into a repo) iff stack-specific (auto-fires only in that stack).
5. + Global autoload (`skills add -g`) iff broad AND must-auto-fire AND regular. Default: NONE.
6. Authored publishable? public/ (future connorads/skills) : private/ (personal, never public).
```

Axes to weigh: **frequency** (never/rare/regular), **breadth** (broad vs stack-specific),
**trigger mode** (auto-fire vs deliberate), **provenance** (authored/vendored),
**publishability** (public/private).

## Layout

```
~/.config/skills/
  AGENTS.md                this file (canonical)  ·  CLAUDE.md → symlink
  public/<name>/           authored, shareable      · skl source 'mine'  · → future connorads/skills
  private/<name>/          authored, personal       · skl source 'private'
  vendor/                  third-party "project"     · skl source 'vendor'
    .agents/skills/<name>/ real vendored files (CLI-managed, project scope)
    skills-lock.json       project lockfile (`skills update` from here refreshes in place)

~/.agents/skills/          GLOBAL CLI dir = AUTOLOAD tier (skillsync source). Empty → autoload none.
~/.agents/.skill-lock.json UNTRACKED (gitignored): skills-CLI global lockfile. Nothing to
                           version while autoload is empty; re-track (restore the !-line in
                           ~/.gitignore) once you `skills add -g` a real global skill — it
                           then pins that install's provenance. NOT machine-local state.
```

`skl` config (`~/.config/skl/config.json`), order = precedence:

```json
{ "paths": [
  { "path": "~/.config/skills/public",                "name": "mine" },
  { "path": "~/.config/skills/private",               "name": "private" },
  { "path": "~/.config/skills/vendor/.agents/skills", "name": "vendor" }
] }
```

## How-to

### Add an authored skill
Create `~/.config/skills/{public|private}/<name>/SKILL.md` (+ supporting files). Public iff
shareable with no personal refs; private otherwise. No CLI, no lockfile — you edit in place.
`skl <name>` finds it immediately. Remember the `.gitignore` un-ignore is already in place
for `public/**`, `private/**`, `vendor/**`; new top-level files need their own un-ignore
before `dotfiles add`.

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
`next-*`, `vercel-*`, `cloudflare`, `remotion-best-practices`, `claude-api`, `marimo`,
`logging-best-practices`, `web-design-guidelines`, `accessibility`, `holistic-ux`, `hk`,
`test-coverage`, `mechanical-enforcement`.

### Promote to global autoload (rare)
`skills add -g <owner/repo> --skill <name>` → lands in `~/.agents/skills/`, `skillsync`
symlinks it into every tool, it autoloads everywhere. Reserve for broad + must-auto-fire +
regular skills. Currently: **none**.

## Validated vendor sources

`skills add <repo> -l` first to resolve the exact `--skill` token (dir name vs frontmatter
name can differ — gotchas below).

| source (owner/repo) | trust |
|---|---|
| `vercel-labs/agent-skills` | trusted (official) |
| `vercel-labs/next-skills` | trusted (official) |
| `vercel-labs/skills` | trusted (the CLI repo) |
| `vercel-labs/agent-browser` | trusted (official) |
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

Gotchas: `firecrawl/cli` → `--skill firecrawl-cli`; `remotion-dev/skills` → `--skill
remotion`; `vercel-labs/agent-skills` dir names are unprefixed but skill names are `vercel-*`
(CLI resolves by frontmatter name). Confirm all via `-l`.

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
  serves both tiers) — rejected: `skills update -g` walks the global dir and would resurrect
  / overwrite symlinked entries, and any global presence reintroduces autoload. The two CLI
  scopes give a clean split with no symlink fragility.
- **One-folder lockfile split** (keep all vendored skills in one dir, slice the lockfile by
  tier) — rejected: the CLI manages one lockfile per dir; splitting it by hand fights the
  tool. Project scope gives a real per-tier lockfile for free.

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
- `connorads/skills` public repo is **deferred** — when ready, push `~/.config/skills/public/`
  as-is (sanitise any personal refs first; none currently in `public/`).
