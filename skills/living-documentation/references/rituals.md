# Rituals - runnable recipes

Concrete procedures for the highest-leverage principles. Mechanism names
(pre-commit hook, CI check, fresh agent session) are illustrative - swap in
whatever your project already uses.

---

## 1. Doc-vs-reality reconciliation (theme 1.1 / 5.4)

**Problem it solves:** hand-maintained enumerations - command tables, file-path
lists, config registries, "supported X" lists - drift silently, and the first
stale fact a reader catches poisons trust in the whole document.

**Recipe:**

1. Find every hand-maintained enumeration in the doc (command names, paths,
   slugs, ports, version pins, skill/script pointers).
2. For each, pick the authoritative source it should agree with (the binary on
   `PATH`, the file on disk, the slug in the source tree, the lockfile, the
   config).
3. Write the cheapest check that asserts agreement:
   - **Existence:** every referenced path exists; every named command resolves.
   - **Equality:** the doc's list equals the discovered set (e.g. doc collection
     list == source slugs; index rows == file headers).
4. Wire it into a **pre-commit hook** (fail closed) for things that must never
   ship stale, or a **CI check** / manual task for the rest.
5. Lock it in *while the facts are currently correct* - before they rot.

**Prefer generation over reconciliation** only where a structured source already
exists (a `summary:` frontmatter field, a `# name: purpose` function header). If
generation needs new fields, reconcile now and promote to generation later.

**Hard gate vs warn:** prefer a hard pre-commit gate. Warnings get ignored,
which defeats the entire "no mechanism, no trust" point.

---

## 2. The cold-agent astonishment pass (theme 8.1)

**Problem it solves:** you cannot see your own docs with fresh eyes, and you have
an effectively infinite supply of newcomers - fresh agent sessions - that you are
probably not using as a doc-quality probe.

**Recipe:**

1. Start a **fresh session** with no prior context (a clean agent, or a subagent
   given only the repo).
2. Give it one realistic, end-to-end task that exercises the docs (not a task you
   have hand-held before).
3. Instruct it to **log every point of confusion or surprise** as it goes -
   anything ambiguous, missing, contradictory, or that turned out wrong.
4. Each logged surprise is a precise pointer to a missing or wrong doc entry.
   That log *is* your doc backlog.
5. Run it after any significant doc change. Candour is highest on the first pass;
   re-running on the same task teaches you less.

Start as a **manual habit**; automate (a scheduled cold run) only once it has
proven its worth - don't over-invest in doc tooling (theme 8.5).

---

## 3. Rule of Two (theme 2.2)

**The only trigger for a new rule.** Do not write an instruction speculatively.

- First time you correct an agent (or yourself) on something: just correct it.
- **Second** time the same correction recurs: now write the rule - in the nearest
  durable place (AGENTS.md note, a hook, a type, a skill).
- Prefer enforcing it (theme 5) over stating it. If a lint rule or hook can catch
  it, encode that instead of prose.
- Periodically **delete rules that never fire**. An instruction nobody has needed
  is speculative bloat paid for every session.

---

## 4. Salience pass (theme 2.1)

A pruning ritual for any instruction file or skill.

For each sentence ask: **would a competent reader/agent already know this?**

- Restates how a well-known tool, language, or standard works -> **cut**.
- Boilerplate a capable model writes correctly unprompted -> **cut**.
- A non-obvious local convention, a project gotcha, a delta from the default ->
  **keep**.
- Knowledge that exists authoritatively elsewhere -> **replace with a link**
  (theme 2.4).

Goal: every remaining line carries non-recoverable knowledge.

---

## 5. Evergreen / volatile classification (theme 3.2 / 3.3)

Before writing a fact, classify it:

- **Evergreen** (stable for years: philosophy, conventions, the *why*) -> safe as
  prose.
- **Volatile** (version pins, ports, tool names, counts, current state) -> do not
  hand-write in prose. Generate it, or link down to the config/lockfile/CLI that
  owns it.

Never interleave the two in one paragraph - the volatile half forces upkeep on
the evergreen half. Check reference direction: stable prose may link *down* to
volatile sources, never the reverse.

---

## 6. The two-minute test (theme 8.3)

A quality gate for any doc or skill.

- Try to explain the thing aloud in under two minutes.
- **Can you?** Write that explanation down - it is the doc.
- **Can't you?** The thing is too complex. Simplify the design first; the doc
  follows. For a skill specifically: if `SKILL.md` fails the test, the overflow
  belongs in `references/`.

---

## 7. Biodegradable docs (theme 2.5)

For anything describing a temporary state (a migration, a "remove after X", a
work-in-progress note):

- **Anchor it to the artefact that will be removed**, not to the survivor, so it
  is deleted in the same change that removes the thing.
- Or keep it in scratch / a draft area that is expected to be cleared - never let
  it accrete as an orphaned TODO in a durable instruction file.
- Add a check that flags stale temporary drafts (e.g. a draft older than a day) so
  abandoned notes surface instead of lingering as quiet lies.

---

## 8. Naming the mechanism (theme 1.1) - the one-question audit

The fastest review of any durable doc. For each non-obvious fact, ask:

> **"What keeps this true?"**

- A single source / auto-propagation / a reconciliation test -> fine.
- "I will remember to update it" -> it is rot-in-waiting. Apply recipe 1, or
  delete the fact, or convert it to a dated account (theme 1.4) that needs no
  upkeep.
