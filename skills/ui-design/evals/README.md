# Evaluation

`evals.json` contains the fixed briefs, observable assertions, boundary cases
and a standalone-use case. The JSON files in `fixtures/` supply deterministic
inputs. These are synthetic construction tasks, not observations of users.

## Comparison

1. Freeze prompts, fixtures and assertions before changing the skill. Copy the
   queue fixture to `fixture.json`, the import fixture to `fixture-rules.json`
   and the form fixture to `fixture.json` in separate run directories.
2. Snapshot the same visual and accessibility guidance for every run. Use the
   common prompt and case prompt with each of three arms: existing guidance;
   existing guidance plus `adhoc_instruction`; existing guidance plus this
   skill and its relevant references. Keep model, tools and budgets equal.
3. Run each build in a fresh session. Keep the queue and import cases for
   development. Hold the branching form back from revisions until validation.
   Do not let builders inspect other runs or the grader's assertions.
4. Run the assertions against the resulting apps in a browser. Keep scripts,
   screenshots, transcripts, files read, token usage and launch instructions
   outside the skill directory. Retain failed builds and infrastructure errors
   separately. A claimed check in the final response needs supporting evidence.
5. Shuffle output labels before comparing visual hierarchy, grouping, density
   and consistency. Record the concrete differences and any task failures.
   Human review decides visual preference; an agent comparison is provisional.
6. Compare the skill with both controls. Prune instructions that change nothing;
   rerun affected comparisons after revisions. Check the held-out case against
   the final candidate and report regressions, ties and uncertainty.

Open prototypes through a local HTTP server so fixtures and browser storage
work. Clear each origin's saved state before an independent case. Use keyboard
interaction as well as pointer input and inspect at desktop and narrow widths.

## Boundaries and standalone use

Copy `fixtures/boundary.html` into an isolated directory for each boundary
prompt. The fixture deliberately contains a broken error-summary link handler.
Run the four prompts with the skill available and check whether its use stays
within the requested work. The research prompt needs a diagnosis proposal,
not edits to the unrelated conference fixture. Repeat the import task with only this skill
available. It must remain actionable without companion skills or local books.

Explicitly telling an agent to use a skill tests its instructions. It does not
measure automatic discovery. To test discovery, expose its name and description
alongside neighbouring skills and issue a prompt without naming the skill.
Keep a held-out positive and a near-miss negative when revising the description.

## Evidence limits

One build per arm per case identifies specific failures and design differences.
It cannot establish a reliable win rate, human usability or accessibility
conformance. Browser focus checks do not establish spoken screen-reader output.
Save run-specific findings outside this installable payload.
