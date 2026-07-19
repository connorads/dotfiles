# Applied to agent docs, skills, ADRs & knowledge bases

The principles in [principles.md](principles.md), translated to the artifacts you
actually write: `AGENTS.md` / `CLAUDE.md`, `SKILL.md`, ADRs, and knowledge-base
notes. The recurring theme: agent instruction files are loaded into *every*
session, so the cost of a stale or low-salience fact is paid constantly, and the
damage from one wrong fact is amplified - a single caught error teaches the agent
to distrust the whole file.

---

## AGENTS.md / CLAUDE.md

An instruction file is an **architecture codex aimed at an agent landing cold**
(themes 4.4, 6.1). Optimise it as a field of stigmergic markers: terse, callable
names, pointers to the right place - not narrative.

- **Lead each section with one sticky maxim** (theme 4.4). Put the prohibition or
  rule as a one-liner ("never stage with `git add -A`"); relegate nuance below.
  The agent must retain the rule across a long context; stickiness beats nuance.
- **Document only the delta from defaults** (theme 2.1). A capable model already
  knows how git, your language, and common tools work. Every sentence that
  restates general knowledge is dead weight loaded every session. Keep only *your*
  deltas: the non-obvious convention, the project-specific gotcha, the local
  wrapper.
- **Separate the stable spine from volatile specifics** (theme 3.2/3.3). Keep
  philosophy and conventions as evergreen prose; push exact version pins, port
  numbers, and tool names down into config/lockfiles and *link to them*. Never
  let the stable file point *down* into machine-local or churny state - that
  inverts the safe reference direction.
- **Enforce, don't narrate** (theme 5.1). A prohibition that a hook, lint rule, or
  settings denial can enforce should be enforced; then the rule's config is the
  doc. Do not *also* paraphrase the hook config in prose - the two will drift.
- **Co-locate per-subsystem instructions** (theme 3.1). A subsystem with its own
  vocabulary gets its own `AGENTS.md` beside the code; the root file stays a
  landscape/index that links down. This keeps each file one-message and lets the
  knowledge move with its subsystem.
- **Rule of Two for additions** (theme 2.2). Add an instruction the *second* time
  you correct the agent on the same thing - not speculatively. Periodically
  delete rules that have never fired.
- **Reconcile the hand-maintained tables** (theme 1.1/7.1). Command lists,
  file-path tables, and config registries are the classic rot sites. Either
  generate them from source, or add a check that asserts every named command
  resolves and every referenced path exists. Hand-maintained enumerations drift
  silently and are exactly what a cold agent catches first.

---

## Skills (SKILL.md + references/)

A skill is **progressive disclosure made concrete** (themes 2.3, 6.3): a thin,
always-loaded `SKILL.md` plus `references/` loaded only on demand.

- **One skill, one job** (theme 6.3). Scope each skill to a single message. If it
  needs many caveats, that is "shameful documentation" (theme 8.2) - simplify the
  underlying workflow before documenting around it.
- **Pass the two-minute test on SKILL.md** (theme 8.3). If the front matter plus
  body cannot be grasped in two minutes, move depth into `references/`.
- **Greppable triggers** (theme 6.5). Write the `description` with the distinctive
  terms and phrases a future you would search for, so the loader surfaces the
  right skill.
- **Cite canonical sources; write only your delta** (theme 2.4). Lead with the
  pattern name + a link (a man page, an RFC, a sibling skill, the source book) and
  add only the project-specific 1%. A precise name carries its constraints for
  free and compresses the prose.
- **Point at exemplars** (theme 6.2). Name the best real implementation as "do it
  like this" rather than restating the rules abstractly.
- **Check the skill's own pointers** (theme 5.4). A `SKILL.md` that tells the agent
  to run `scripts/foo` is itself a doc with zero accuracy mechanism unless
  something asserts `scripts/foo` exists. Link-check the skill's internal
  references and the scripts it names.

---

## ADRs & decision records

ADRs are the canonical home for **why-knowledge** (theme 4), and they are
**accounts from the past** (theme 1.4) - so they need *no* ongoing accuracy
mechanism. This is liberating: write them well once, date them, and stop
maintaining them.

- **Lead with the problem, then the decision, then the rejected alternatives**
  (theme 4.1/4.2). If you cannot list two or three credible alternatives, the
  decision was not deliberate - that is itself a finding.
- **Append-only; supersede, don't edit** (theme 1.4). A superseded ADR keeps its
  body and gains a "Superseded by NNN" header. The dated trail of *when and why a
  posture changed* is the value; editing it away destroys that.
- **State each assumption the decision depends on**, and concrete "when to
  revisit" triggers - so a future reader knows when the decision has expired.
- **Pin one template and one parseable status line** (theme 6.5). Inconsistent
  headings (`## Status` vs `**Status:**`) break the natural grep. A generated
  index (number, title, status, date, supersedes), derived by scanning the files,
  is the single source - never a hand-kept table beside the ADRs.
- **Don't trap evergreen procedure inside a dated decision** (theme 3.1/2.4). If an
  ADR also contains a repeatable how-to, the *decision* stays in the ADR (dated)
  and the *procedure* moves to a skill or co-located guide the ADR links down to.
- **Use the right grain.** System-wide -> ADR. Local -> an annotation or a commit
  message (theme 4.3). Don't promote a local rationale to an ADR, or bury a
  system-wide one in a commit.

---

## Knowledge bases (wikis, vaults, note systems)

A KB is mostly **dated accounts** (theme 1.4) plus a thin layer of evergreen
synthesis - and the single highest-value thing most KBs lack is an **accuracy
mechanism on their own integrity** (theme 1.1).

- **Separate dated from evergreen** (theme 1.4). Sources, captures, and logs are
  dated and need no upkeep. Only current-state syntheses and the operating manual
  earn "keep it current" energy. Spend maintenance only where it is owed.
- **Single-source the catalogue** (theme 1.3/7.1). Catalogue a source *through*
  the note that links it; an index line is for orphans only, removed once a note
  adopts it. Better still, generate index descriptions from a `summary:`
  frontmatter field rather than hand-typing them - hand-typed descriptions are a
  large block of untrusted facts.
- **Lint the vault** (theme 1.1/5.4). Assert no broken wikilinks, required
  frontmatter present, and full catalogue coverage - wired into a pre-commit
  hook. This *is* the accuracy mechanism the method demands, and almost no KB has
  it.
- **A living glossary from tags** (theme 7.2). Free-form tags fragment a corpus
  (`ai-coding` vs `agentic-coding`). Generate a tag-frequency report and keep a
  small canonical/synonym map so clustering and search stay sharp.
- **Bound the dated files** (theme 2.5). An unbounded append-only log eventually
  dominates the working set. Split by period (year/quarter) once it crosses a
  size threshold; the greppable dated header makes the split mechanical.
- **Stable vault path by convention** (theme 3.5). Resolve the vault by an
  env var / marker-file walk, not a hardcoded path repeated across scripts.

---

## The cross-cutting wins (what most setups miss)

Ranked by leverage for an AGENTS.md + skills + ADRs + KB workflow:

1. **Reconciliation / drift checks** (theme 1.1/5.4) - turn hand-maintained tables
   and pointers into pre-commit/CI assertions. The single biggest fix.
2. **The cold-agent astonishment pass** (theme 8.1) - a fresh session is a free
   newcomer; use it as a doc probe. The cheapest high-signal audit there is.
3. **Salience** (theme 2.1) - cut everything a capable agent already knows; you
   pay for it every session.
4. **Evergreen/volatile separation** (theme 3.2) - stop interleaving version pins
   and ports into evergreen prose.
5. **Rule of Two** (theme 2.2) - the only trigger for new rules; delete the ones
   that never fire.

Runnable recipes for all five are in [rituals.md](rituals.md).
