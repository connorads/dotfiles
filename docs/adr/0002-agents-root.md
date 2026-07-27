# 0002: `~/.agents/` is the single agents root

User-scope agent skills and user-scope agent instructions both live under
`~/.agents/`: skills at `~/.agents/skills/`, instructions at `~/.agents/AGENTS.md`.
There is no second root, and no XDG-shaped alternative alongside it.

## Context

Two artefacts wanted a home for the same thing, and picked different ones.

These dotfiles put user instructions at `~/.agents/AGENTS.md` and fanned skills out
from `~/.agents/skills/`. [`vibe-setup`](https://github.com/connorads/vibe-setup)
assembled its canonical instructions file at `~/.config/agents/AGENTS.md`, honouring
`$XDG_CONFIG_HOME`. `skillsync` also fanned skills into `~/.config/agents/skills` for
Amp. So `~/.config/agents/` existed as a half-root, and the two artefacts taught a
beginner a layout the dotfiles do not use.

XDG is the instinctive answer: `~/.config/` is where configuration belongs, and a new
top-level dot-directory in `$HOME` is the thing XDG exists to stop. But no ratified
standard names a user-level `AGENTS.md` at all. [agents.md](https://agents.md) is
repo-scoped only. The proposal for `~/.config/agents/`
([agents.md issue #91](https://github.com/openai/agents.md/issues/91)) is open,
unlabelled, and has had no maintainer response since October 2025; its own thread is
split between `~/.agents/` and an XDG path.
[agentskills.io](https://agentskills.io/specification) specifies no discovery
directory whatsoever.

So the tie-breaker is what tools actually read, which is a question of fact:

| path | tools reading it for user-scope skills |
| --- | --- |
| `~/.agents/skills/` | Codex, Amp, opencode, pi |
| `~/.config/agents/skills/` | Amp |
| `~/.agents/AGENTS.md` | none |
| `~/.config/agents/AGENTS.md` | none |

Two further facts constrain the choice. The `skills` CLI hard-codes
`~/.agents/skills` as its global install dir and is not configurable, so migrating
away from it gets silently undone on the next `skills add -g`. And
`~/.config/agents/AGENTS.md` is read by nothing: Amp reads `~/.config/amp/AGENTS.md`
and `~/.config/AGENTS.md`, neither of which is that path.

## Decision

`~/.agents/` is the single agents root. Skills live at `~/.agents/skills/`,
instructions at `~/.agents/AGENTS.md`, and `~/.config/agents/` does not exist.

`skillsync` fans out to Claude Code alone (`~/.claude/skills`), because Claude Code is
the only tool in use that does not read `~/.agents/skills` itself.

Tool support is established empirically, not from documentation. For each tool, its
own skills dir *and* `~/.claude/skills` are renamed away, leaving `~/.agents/skills`
as the only possible source, and the tool is asked what it loaded:
`codex debug prompt-input` and `opencode debug skill` both name the source path of
every skill; pi is asked directly. All four autoload skills survive that test on all
three tools.

`vibe-setup` writes its canonical file at `~/.agents/AGENTS.md` with no
`$XDG_CONFIG_HOME` branch, since `~/.agents` is not an XDG path and honouring the
variable there would be incoherent.

## Considered Options

**`~/.agents/` for both (chosen).** Native support runs 4:1 in its favour, the
`skills` CLI's hard-coded global dir already lives there, and it is a load-bearing
intermediate hop: `~/.agents/skills/playwright-cli` is the middle link for five
per-agent symlinks, so keeping it preserves every chain. Costs an XDG violation, and
bets against the direction a future standard may take.

**`~/.config/agents/` for both.** Correct by XDG, and the shape issue #91 proposes.
Rejected on facts: it would break user-scope skill discovery in Codex, opencode and pi
at once, snap those five symlink chains, and be silently reverted by the `skills` CLI.
Standards-compliance that stops the tools working is not compliance.

**Keep both roots, one mirroring the other.** Costs nothing to discovery and hedges
the standards question. Rejected because it is the status quo that caused the problem:
two roots means every future skill decision asks "which one", and a mirror that drifts
is worse than either root alone. It also cannot be *documented* honestly - there is no
one-sentence answer to where a skill goes.

**Move instructions but not skills** (`~/.config/agents/AGENTS.md`, skills stay).
Rejected: it keeps two roots for one concept, and picks the reading for the artefact
where evidence is weakest - nothing reads a user-level `AGENTS.md` at either path, so
there is no discovery argument either way, only consistency, which this option gives
up.

## Consequences

- One answer to "where does user-scope agent config live", so the dotfiles and
  `vibe-setup` teach the same layout, and a beginner's machine ends up shaped like
  this one.
- `skillsync` shrinks to a single arm. Its remaining job is Claude Code, and if Claude
  Code ever reads `~/.agents/skills`, the function has no job left.
- **We are betting against the XDG-shaped proposal.** If issue #91 is accepted as
  `~/.config/agents/`, this decision is on the wrong side of the standard and earns a
  new ADR. The bet is deliberate: native support today is worth more than a proposal
  with no maintainer response.
- A machine set up by an older `vibe-setup` reads a stale file. Its
  `~/.claude/CLAUDE.md` points at `~/.config/agents/AGENTS.md`, so the relink backs off
  from a foreign symlink and the person keeps reading the old file until they move it
  or pass `--force`. Accepted rather than shimmed: the population is tiny and the
  failure mode is a stale file, not a crash.
- `~/.codex/skills` is read by Codex too, but it is absent from Codex's published
  scope list and OpenAI's own loader marks it *"Deprecated … kept for backward
  compatibility"*, with [openai/skills#420](https://github.com/openai/skills/issues/420)
  unanswered on which dir is canonical. Treat it as in flux; prefer the documented
  path. Real content still lives there (`playwright-interactive`, and the `.system`
  skills Codex auto-installs), so it is never a dir to clear out.
- pi discovers bare root `.md` files as skills in `~/.pi/agent/skills/` but ignores
  them in `~/.agents/skills/`. Moot while every autoload entry is a directory; it stops
  being moot the moment a single-file skill is promoted.

### Parked

Migrating the skills *catalogue* out of `~/.config/skills/`. One root for the autoload
tier and for instructions is the goal here; the catalogue tier is orthogonal, is not a
discovery path any tool reads, and works.
