# UI design skill evaluation

Evaluation date: 20 September 2026. The fixtures are synthetic. They test
construction decisions and observable browser behaviour, not user preference.

## Method

The [reproducible cases](../../skills/ui-design/evals/evals.json) define a review
queue, a multi-file import and a held-out branching reimbursement form.
Each has three fresh-session builds: existing visual/accessibility guidance,
the same guidance plus a short ad-hoc task-design instruction, and the same
guidance plus `ui-design`.

All builds use Codex CLI 0.154.0 with the user's configured `gpt-6-astra` model
and medium reasoning effort. The common guidance is a frozen snapshot taken
before the separate guidance corrections. Every arm receives identical copies.
The fixtures, prompts and assertions are frozen before drafting the candidate.
The queue and import inform development. The form remains held out until the
candidate is fixed for validation.

Each prompt requests a maximum of 12,000 output tokens and 12 minutes. These
are prompt instructions, not hard runtime limits. Actual usage must be reported;
the controls exceed the requested token count. Input usage includes repeated
and cached context across tool turns.

A first queue invocation cannot write because the nested CLI defaults to a
read-only sandbox. It produces no app and is excluded. A brief port collision
in the rerun is detected and corrected by the builder. Timing includes that
recovery. No infrastructure error is counted as a design failure.

## Initial observations

The queue baseline and ad-hoc control each pass the root's seven initial browser
checks: non-adjacent inspection, return, zero-result recovery, failed acceptance,
retry, narrow-screen context and narrow-screen overflow. The baseline import
passes separate selections, mixed outcomes, recovery, removal and completion.

At 1280 by 900, both queue controls require scrolling within the reading pane
to read the short fixture excerpt. Their navigation and repeated metadata
consume space before the decision evidence. This is the observed design stance
difference used to draft the candidate. It is not described as an inability to
complete the task.

The baseline already supplies collection continuity, per-file feedback and
recovery. Those behaviours cannot be credited as improvements merely because
the candidate also supplies them.

## Development comparison

All three queue builds pass the seven root behaviour checks. At 1280 by 900,
the initial excerpt occupies these vertical bounds:

| Arm | Excerpt bottom | Reading region bottom | Entire excerpt visible |
| --- | --- | --- | --- |
| Existing guidance | 815 px | 762 px | No |
| Ad-hoc instruction | 714 px | 699 px | No |
| Candidate | 663 px | 778 px | Yes |

The measurement checks the same first fixture item after clearing both local
and session storage. It demonstrates one arrangement improvement, not a general
quality score. The candidate also keeps the decision controls visible.

All three initial import builds pass the six root file-handling and narrow-width
assertions. Keyboard retry and removal are exercised. The controls block
completion until problem files are resolved or removed. The candidate permits
a clearly labelled partial import. Both are legitimate choices under the brief;
the candidate's choice needs accurate exclusion and completion feedback.

The first candidate keeps a large upload invitation after selection, pushing
failed rows below the initial viewport. The ad-hoc control condenses it. A
second candidate revises only the upload paragraph to give the selected
collection priority while retaining an Add files control. Its comparison uses
a fresh build with the same prompt and fixtures. No held-out form output informs
that revision.

## Validation and standalone use

All three held-out forms pass eleven root checks. These cover domestic
completion, mileage validation, keyboard error links, reload, changed branches,
server rejection, international completion and narrow-width overflow. The
candidate chooses two entry stages followed by review. Both controls use one
entry form followed by review. No behavioural advantage is established.

The standalone import uses only the candidate's instructions and references.
It passes eight root checks, including separate selections, mixed outcomes,
actual transcript preview, keyboard retry/removal, accurate completion count,
completion focus and narrow-width overflow. It works without companion skills.
The revised comparison import also passes explicit partial-import, exclusion
and later-retry checks.

## Scope checks

All four checks stay within the request. The conference page receives CSS-only
styling with its sections and booking flow retained. Research diagnosis produces
an evidence-gathering proposal and leaves the unrelated fixture unchanged. The
summary-link fix changes only its target and focus handler. The colour fix
changes one declaration to the existing teal token.

Source diffs verify scope. Browser checks verify keyboard focus, computed colour,
section retention and narrow layout. The agent reads the skill's entry point to
check applicability and applies none of its task-flow references. This tests
scope with the skill available; it does not measure automatic discovery.

## Shuffled visual comparison

A separate agent inspects nine screenshots with arm names concealed. It ranks
the queue candidate above the ad-hoc control, then baseline. Its reason matches
the geometry check: the supplied excerpt and decisions fit together. It also
notes smaller previous/next controls and hidden status counts in the candidate.

For import, it ties the revised candidate with the ad-hoc control, above the
baseline. The candidate has clearer partial-import wording and a shorter mobile
page. The ad-hoc control groups both error types more clearly and exposes more
recovery controls. These are provisional visual judgements, not user findings.
The labelled packet, concealed mapping and complete review are retained locally.

## Retained guidance

The observed differences support the compact decision-first screen stance and
selected-files-first upload guidance. The upload paragraph is revised once;
the remaining candidate is frozen for validation. Collection continuity and
form recovery remain concise parts of the complete task guidance. They produce
behavioural ties here and are not credited as novel improvements. Separate
visual, accessibility and implementation manuals are not copied into the skill.

The evaluations do not isolate the contribution of every remaining sentence.
A future comparison should test pruning the tied guidance rather than treating
these results as proof that every instruction is necessary.

## Run costs

Elapsed times come from transcript creation to its final update and include
tools. Input counts include cached context; cached tokens are a subset, not an
additional charge count. These are observed usage, not a cost estimate.

| Run | Minutes | Input tokens | Cached input | Output tokens |
| --- | --- | --- | --- | --- |
| queue-baseline | 9.80 | 969,974 | 897,792 | 16,281 |
| queue-adhoc | 10.05 | 1,287,936 | 1,220,352 | 16,183 |
| queue-skill | 9.17 | 1,354,625 | 1,277,952 | 15,062 |
| import-baseline | 8.79 | 806,912 | 736,256 | 15,344 |
| import-adhoc | 9.76 | 1,203,961 | 1,130,496 | 15,887 |
| import-skill | 11.27 | 1,978,433 | 1,909,248 | 16,341 |
| import-skill-v2 | 10.74 | 1,491,115 | 1,417,984 | 15,433 |
| form-baseline | 11.02 | 966,690 | 896,384 | 17,590 |
| form-adhoc | 9.01 | 925,852 | 864,640 | 15,428 |
| form-skill | 9.72 | 756,101 | 689,408 | 15,825 |
| standalone | 6.44 | 462,374 | 413,184 | 10,401 |

The separate four-case scope suite takes 5.04 minutes, with 352,073
input tokens (312,832 cached) and 5,889 output tokens.
Its prompt requests 5,000 output tokens and eight minutes.

The standalone prompt requests 6,000 output tokens and eight minutes. It exceeds
the token request. The comparison builds also exceed their requested output
budget, so no equal-token efficiency claim follows from this experiment.

## Evidence

Local raw artefacts are under `.cache/ui-design-evals/2026-09-20/` in the
dotfiles work-tree. Its README explains how to launch all retained prototypes.
Each run keeps its exact prompt, fixture, guidance snapshot, source, browser
checks, screenshots, notes and JSONL transcript. Input and candidate hashes
record the frozen versions. Run-specific outputs stay outside the shipped skill.
An independent transcript audit confirms the candidate reference reads and
standalone operation without visual or accessibility companion guidance.

The existing guidance correction checks are under
`.cache/ui-design-evals/corrections/`. Layout example checks and screenshots are
under `.cache/ui-design-evals/layout/`.

## Limits

A single build per arm per case does not establish a win rate. A blind agent
comparison can identify concrete differences but cannot establish human visual
preference. Chromium checks do not establish physical-device behaviour, spoken
screen-reader output or full accessibility conformance. Explicit skill use does
not test automatic discovery.
