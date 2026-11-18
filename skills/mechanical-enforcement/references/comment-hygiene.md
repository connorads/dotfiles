# Mechanical Enforcement - Comment and doc content

Every other concern in this catalogue checks code. This one checks the prose
*attached* to code: comments, and the docs that stand in for them.

## Contents

- [The pick](#the-pick)
- [Drop-in](#drop-in)
- [Calibrate the token list against the corpus, always](#calibrate-the-token-list-against-the-corpus-always)
- [windbag - the reference implementation, and why it is a watch](#windbag---the-reference-implementation-and-why-it-is-a-watch)
- [Block by default - landmines `no-comments`, not adopted for now](#block-by-default---landmines-no-comments-not-adopted-for-now)
- [Rejected](#rejected)
- [Tier](#tier)

Two failure modes, both cheap to encode and both invisible to every mainstream
linter:

- **Change narration.** A comment describing the edit that produced the code
  ("was missing (SCA-533)", "used to silently no-op") rather than the constraint
  that makes the current code correct. Correct when written, a lie at the next
  edit, and a duplicate of the commit message.
- **Hedging.** `should work`, `not sure why`, `probably fine`. A record that
  nobody verified, phrased so it reads as fact forever. (Code spans, because
  Vale skips those and not quotes - see the calibration section.)

Agent-written code raises the base rate of both sharply: a model narrating its
own diff in a comment is the default behaviour unless told otherwise, and it has
no commit message to put the narration in at the moment it writes the line.

The rule to enforce: **a comment or doc states the standing constraint in
timeless present tense; the history goes in the commit message.**

## The pick

| Rule | Encode with | Prevents |
|---|---|---|
| Comments and docs carry the standing rule, not the change | Vale `existence` style, `level: error`, scoped to prose and source comments | A comment that documents a fixed bug instead of the invariant, and rots at the next edit |
| No hedging in comments or docs | Vale `existence` style, same scope | `should work` surviving as documentation of a thing nobody checked |
| Ticket IDs stay out of comments | Same, with the tracker prefix as the pattern | `# SCA-533` pinning a comment to an issue tracker the next reader cannot open |

Vale is the vehicle because it is the only prose linter that **extracts comments
from source files**. Verified on Vale 3.19: a phrase in a Python comment is
flagged, and the same phrase in a string literal is not.

**The extraction is keyed to a fixed extension list, and everything else falls
back to linting the whole file as plain text - silently.** Probed on 3.19 by
putting the phrase in code rather than a comment and checking whether the rule
still fired:

| Comments extracted | Whole file linted as prose |
|---|---|
| `.py` `.rb` `.rs` `.go` `.lua` `.js` `.jsx` `.ts` `.tsx` | `.mjs` `.cjs` `.mts` `.cts` `.sh` `.zsh` `.nix` `.tf` `.sql` `.toml` `.yml` `.kdl` `.pkl` |

The split is not guessable and the failure is quiet: a `.tf` or `.sql` scope
*appears* to work, because a phrase in a comment is flagged - but so is every
string literal and identifier. The ESM extensions land on the wrong side of a
boundary their non-ESM twins are on the right side of. Probe each extension
before scoping to it; do not infer from a sibling.

One more trap: a file with malformed frontmatter is a hard error (`E201`), not a
skip, and when Vale is handed a batch, one erroring file aborts the **whole
batch**. Test fixtures with deliberately-broken frontmatter need excluding, or a
sweep reports clean on files it never read.

### Scoping to comments without dragging the whole style along

A prose style adopted for markdown has usually never run against code comments,
so pointing an existing `BasedOnStyles` at source files lands the *other* rules
red as well. Measured here: the two rules above found nothing across 264 source
files, while the house em-dash rule found 110 - a backlog, not a gate.

Enable rules individually for the source scope instead, leaving the prose scope
untouched:

```ini
[*.md]
BasedOnStyles = Connorads

[*.{py,ts,tsx,js,jsx,rs,go,rb,lua}]
BasedOnStyles = Vale
Connorads.ChangeNarration = YES
Connorads.Hedging = YES
```

## Drop-in

```yaml
# styles/<Style>/ChangeNarration.yml
extends: existence
message: "'%s' narrates a change. The standing rule belongs here, the history in the commit message."
level: error          # without this, MinAlertLevel = error makes the rule inert
ignorecase: true
tokens:
  - previously was
  - previously did
  - before this fix
  - before this change
  - before this commit
  - before this PR
  - root-caused
  - root caused
  - the bug was
  - was broken
  - now correctly
  - (is|are|was|were|has|have|had) now
  - now (uses?|holds?|lives?|is|are|reads?|runs?|sits?|belongs?)
```

```yaml
# styles/<Style>/Hedging.yml
extends: existence
message: "'%s' hedges. State what was verified, or state the open question."
level: error
ignorecase: true
tokens:
  - should work
  - hopefully
  - probably fine
  - probably works
  - not sure why
  - not sure if
  - not sure this
  - as far as I can tell
  - afaik
  - seems to work
  - should be fine
  - should fix
  - not 100% sure
  - not entirely sure
  - might not work
  - for some reason
  - no idea why
  - in theory
```

Both are ratchets: adopted at zero findings so the backlog can never start.
Vale's extension points default to `level: warning`, so a style run under
`MinAlertLevel = error` treats a rule missing that line as a silent no-op -
which means a fixture test asserting each rule *fires* is not optional.

## Calibrate the token list against the corpus, always

The lists above are the surviving half of a 46-phrase set. Measured against 323
gated markdown files, the **full** set produced 36 findings across 12 tokens, of
which roughly two were genuine - a false-positive rate near 94%, which is
rejection territory by the standard this catalogue applies to any other linter.

The failure is systematic, not incidental. A corpus that documents tools and
failure modes uses the vocabulary of failure as its **subject**:

| Finding | Why it is not narration |
|---|---|
| "the hook silently skips until it is trusted" | present-tense runtime behaviour |
| "warns when the patch stops matching" | runtime predicate |
| "delete rules that have never fired" | a standing rule |
| "fails install if a package previously had provenance" | what the tool checks |
| "I believe / I think" inside a rule banning the phrase | quotation |

One token, `no longer`, was 19 of the 36 on its own - including five copies of
the very sentence that bans it and quotes it to do so. Vale skips code spans and
fenced blocks but **not quoted prose**, so a style guide that names the phrases
it forbids trips its own rule.

So the procedure, not the list, is the transferable part:

1. Build the full candidate set as a throwaway style.
2. Sweep the exact scope the gate will use, one file per invocation.
3. Read **every** finding. Do not sample.
4. Drop every token that fired unless the finding was genuine.
5. Ship what is left, at `error`, with the dropped tokens named in a comment and
   the reason recorded.

Expect the ambiguous half to be dropped. The tokens with real yield in *code
comments* on *added lines* are the same ones with catastrophic precision in
mature prose, because the ambiguity is between "this changed" and "this
predicate is false".

The productive `now` shapes are the verb-adjacent ones: an auxiliary followed
by `now` (`is now exact`, 11 hits all genuine over 429 gated files) and `now`
followed by a state verb (`now uses aube`, 12 hits with 4 genuine). Bare or
sentence-final `now` and `currently` are essay prose or subject vocabulary at
0-10% precision, and `does` stays out of the verb alternation because `what the
model now does` names a subject, not a change. Switch the rule off by
`.vale.ini` section for two scopes: ADRs, where `is now testable` is relative
to the decision date and never rots, and first-person essay, where `there are
now two panes` is narrative. Put a rule's own quoted examples in code spans,
because Vale skips code spans but not quotes.

## windbag - the reference implementation, and why it is a watch

[windbag](https://github.com/scale-venture-partners/windbag) (MIT) is the only
tool built for this concern. Rust, tree-sitter, nine languages, six rules:
ticket IDs, change narration, hedging (all `error`), plus cross-file references,
a comment-to-code line-count ratio, and an "obvious comment" check that fires
only when the comment's words echo identifiers in the code below it. Fully
deterministic - no network, no model, `git` is the only subprocess. It ships a
pre-commit hook and a `--json` reporter.

Two capabilities nothing else has:

- **Comment-to-code relation.** The ratio and identifier-echo rules read the
  comment against the AST node it is attached to. No prose linter can express
  this, and an AST matcher cannot compute it.
- **Diff scoping.** `--staged` and `--new-only` intersect findings with the
  lines a diff actually *adds*, so touching a file does not re-litigate its old
  comments. That is a ratchet built into the tool, which is the hard part of
  adopting any threshold gate (`ratcheting.md`).

**Verdict, 2026-09-10: watch, do not adopt as a gate.** Five weeks old, v0.1.0,
16 commits, single-vendor, no releases, no tags, **no CI**, and published to no
registry - install is a `cargo install --git` clone, which defeats a release-age
quarantine and lockfile posture. Its 27 integration tests read well and its rule
calibration is documented honestly in commit messages, so the objection is
distribution and age, not craft. Three fail-open behaviours to check if it is
adopted anyway: a missing config path silently yields defaults rather than
erroring, a tree-sitter parse failure returns zero violations, and exit 1 means
both "violations found" and "the tool crashed". Its default ticket pattern
`\b[A-Z]{2,10}-\d{2,6}\b` must be narrowed to the tracker prefix or it matches
part numbers and enum constants.

Adopt it where the *code comments* are the problem and a Rust toolchain is
already present; pin a hashed source revision rather than resolving at build
time. Where the drift is in **docs**, it is blind: markdown is scanned for
`<!-- -->` comments only, and body prose is out of scope by design.

## Block by default - landmines `no-comments`, not adopted for now

The Vale rules above block known bad phrases. A block-by-default rule inverts
that: every comment fails unless it matches a short allowlist.
[landmines](https://github.com/interfere-inc/landmines) (MIT, oxlint
`jsPlugins`) ships one as `landmines-style/no-comments`. It allows tool
directives, licence headers, TSDoc on exported API (path-scoped by
`publicApi`), and single-line `// WARNING:` comments. Its message: "express
meaning in code and rationale in the PR".

The case for it is agent behaviour, not style. Agents copy the patterns they
read, so one comment explaining a temporary workaround becomes the
justification for the next workaround. GrokBot's Dune framework bans comments
for exactly that reason, and Lauren Tan recommends deleting most comments. A phrase list also cannot keep up with new narration phrasings, and
an allowlist does not have to. Treat this as a live position with serious
advocates. The measurements below test it once. They do not settle it.

**Measured, 2026-11-18, oxlint 1.93.0.** Five agent-heavy TypeScript repos,
written under a "document the why, history in the commit" rule with the Vale
gate above:

| | Count |
|---|---|
| Findings | 10,865 (6,428 blocks of consecutive `//` lines) |
| Sampled blocks, 40 per repo, one model-classified pass | 200 |
| Standing why: constraint, external quirk, ordering or concurrency invariant | 114 (57%) |
| Non-exported interface docs | 24 (12%) |
| Restates the code, or a section and step label | 44 (22%) |
| Narration, hedging, TODO, commented-out code | 0 |

Read that as: the rule deletes about two good comments for each bad one. The
phrase gate had already removed the classes it targets. Of the 114 whys, 50
need two or more lines, and most state a rule rather than a hazard ("ISO-8601
UTC strings sort lexicographically, so string max is latest"). A one-line
`WARNING:` prefix misdescribes those, so in practice they move to the PR.

Three facts make "rationale in the PR" weaker than it sounds:

- A squash merge points `git blame` at the merge commit for every line. The
  per-commit rationale is gone, and only the PR body survives.
- The PR body lives on a hosted service, not in the clone. It does not survive
  a repo move, and an agent reading the file never sees it.
- No team has published results from enforcing near-zero comments (searched
  2026-11-18).

Rule bugs seen in the sweep: `// @vitest-environment jsdom` is reported (4 of
200 samples), and a generated-file banner is reported. Exclude both by path or
patch the directive list before gating.

### Does the comment license the workaround? One test

**Tested, 2026-11-18, headless Claude Code, `CLAUDE.md` disabled.** Three
fixture repos each have a bug in a shared helper: a slug function drops
accented letters, a chunk function drops the final partial group, and an
amount parser fails on thousands separators. The task adds a feature that hits
the bug. Hidden tests score whether the agent fixed the helper or routed around
it. Four arms, 10 runs per scenario per arm:

| Arm | Existing caller of the helper | Sonnet 5.5, helper fixed | Haiku 5.5, helper fixed |
|---|---|---|---|
| A | Workaround with an explanatory comment | 12/30 | 0/30 |
| B | Same workaround, no comment | 14/30 | 0/30 |
| C | No workaround | 30/30 | 0/30 |
| D | C, and the test command fails on any comment | 30/30 | 1/30 |

In this test:

- **Workarounds spread, and the code carried them.** Existing workaround code
  cut Sonnet's fix rate from 30/30 to 26/60 (Fisher p < 0.001).
- **The comment rode along. It did not show as the cause.** A against B is
  12/30 against 14/30 (p = 0.8). The per-scenario effect changed direction: 2/10
  against 7/10 for slugs, 10/10 against 7/10 for chunks. A comment that names
  the helper's defect points the agent at the helper, for good or bad.
- **Copied workarounds copy their comment.** 16 of Sonnet's 18 workarounds in
  arm A carried the original comment word for word.
- **The ban removed the label, not the workaround.** Haiku routed around the
  helper in 29/30 runs under the comment ban, and wrote no comment saying so.
  Without the ban, it explained its workaround in 28/30 runs. Here the ban hid
  the debt instead of removing it.

The working rule this supports: delete a workaround comment by fixing the
root cause. Deleting the comment and leaving the workaround (arm B) changed
nothing. Treat a comment that names an owned helper's defect as a debt marker.
Grep for it and fix the helper.

Limits: three small synthetic tasks, one prompt, two models, 240 runs. The test
does not measure long accumulation in a real codebase, which is the case Dune
describes. A test of that, or a team's before-and-after report, would reopen
this decision.

**Verdict, for now: do not adopt as a repo-wide gate where the why-comment
rule is already in force.** In the test it fixed no root causes and hid the
workarounds it did not stop. Consider it, ratcheted, where agents write most
of the code, existing comments are mostly workarounds, and nobody owns the why. Two changes
make it fit the standing-rule posture of this file:

1. Allow a neutral prefix (`WHY:`), not `WARNING:`. Then a standing constraint
   needs no false hazard label.
2. Allow that prefix on a multi-line block. Half the measured whys need it.

The stronger precedent is a comment that is *required*, not merely permitted.
clippy `undocumented_unsafe_blocks` requires `// SAFETY:` directly above each
`unsafe` block, and `unnecessary_safety_comment` flags a `SAFETY:` comment on
safe code. Where a code shape always needs a reason (a cast, a lint
suppression, a retry, a sleep), require the prefixed comment at that shape.
That is more precise than banning comments everywhere else.

For the agent lane, a hook that checks only the comments an edit *adds* gets
most of the benefit with no backlog. See `agent-tool-gates.md` for the hook
contracts. Community examples exist (`claude-pipe-down`,
`go-claude-code-comment-checker`), but they are unvetted.

## Rejected

- **ast-grep / Opengrep for the phrase rules.** Every rule here is
  regex-over-comment-text, not AST structure, so the matcher earns nothing and
  the rules must be written once per grammar. The two relational rules need
  arithmetic over sibling nodes, which neither expresses.
- **Off-the-shelf prose styles** (write-good, proselint, textlint, alex). They
  target document prose and their rule sets - passive voice, weasel words -
  do not intersect this concern. Vale's own package registry is also an unvetted
  download, so a `Packages` key trades this gate for a supply-chain hole.
- **Ruff `TD003`** takes the opposite position, *requiring* an issue link on
  every TODO. It coexists with a ticket-ID rule only if that rule exempts
  TODO-shaped comments, as windbag's does. Pick one posture per repo and say
  which in the config comment.
- **`no-warning-comments` / `capitalized-comments`** (ESLint) and Ruff `ERA001`
  (commented-out code) are adjacent and worth having, but check comment *shape*.
  Nothing in that family reads comment content against the code it documents.

## Tier

Tier 2, alongside the other lint gates. The step wants the same exclude set as
any other prose gate: vendored trees, verbatim quote collections, and fixture
directories - a style that flags its own quoted examples produces findings that
can only be suppressed, never fixed.
