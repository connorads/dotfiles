# Failure modes → disciplines

The full map behind the protocol. Each row: the failure as it appears in
engineering work, the discipline that counters it (stated as an act with an
output, not a disposition), and the classical name or source of the idea -
vocabulary for humans and agents to share, not the mechanism itself.

| Failure mode | Discipline | Names / provenance |
|---|---|---|
| "The symptom didn't recur after a change, so the diagnosis was right" | Before citing a clean result, state the outcome that would have refuted you. If no realistic outcome could have, write "this observation is uninformative" and design one that discriminates. For fixes, run the toggle: remove the fix, see it fail; restore, see it pass. | Affirming the consequent; Popper's risky prediction; Mayo's severity; Agans rule 9 |
| The check ran cleanly but never exercised the suspected path (a CI-only deploy against a production-code bug) | Write, per possible outcome, which hypotheses it eliminates. All outcomes compatible with all hypotheses = not a test. State whether the check reaches the suspected mechanism, in the suspected environment, under the suspected conditions. | Heuer's diagnosticity (ACH); Platt: "what hypothesis does your experiment disprove?" |
| "No caller / no discussion / no recurrence found, therefore none exists" | A search that ran and found nothing: state the queries verbatim and what they rule out. A search not run: report a gap, never a null result. For quiet periods: zero events in n independent trials bounds the rate near 3/n (95%); if the historical rate sits below the bound, the quiet rules nothing out. | Absence of evidence vs evidence of absence; Hanley & Lippman-Hand's rule of three |
| Anchoring on the first plausible cause | Enumerate at least two rivals before a definitive cause (sweep: config, data, deploy, dependency, concurrency, caching, permissions, clock, network, resource limits). Going straight from symptom to a single cause is the failure even when the cause turns out right. | Anchoring; premature closure (Croskerry); Platt's multiple working hypotheses |
| Reporting done from the action performed rather than the state observed | A completion claim cites a fresh observation: the command, exit code, and the output line carrying the claim. "Tests passed earlier" proves only the tree they ran on. | Open-loop execution; "verification before completion" |
| An unstated premise ("the flag is on", "this is the deployed build", "this check would have caught it") inherited rather than checked | Check the premises a conclusion stands on before answering; report false ones promptly. Label statements observed / derived / assumed; a conclusion inherits its weakest label. | Premise critique; "check the plug" (Agans rule 7) |
| An early hypothesis in a note, ticket, or previous turn hardens into fact through retelling | Treat any inherited diagnosis as Hypothesis #0, ranked on evidence with the rest. Re-derive from primary evidence; record rule-in and rule-out evidence per candidate. Watch for hedges stripped in each retelling ("likely unset" → "is unset"). | Diagnosis momentum (clinical); laundering by summary |
| User pushback with no new information flips a correct conclusion | Revise only on a named new observation. Otherwise restate the conclusion and its evidence. A content-free "are you sure?" flips a measurable fraction of correct answers; expressed doubt is not evidence. | Sycophantic collapse; self-correction limits |
| Asserting a log line, metric, or tool result never actually observed | Every evidential claim carries its source and the load-bearing line quoted, or "no match found". If a tool could not run, say so - never reason from its imagined output. Catch phrases in your own draft: "presumably", "the log would show", "I'll assume". | Fabricated evidence; simulation confusion |
| Grepping a messy repo until something looks guilty, then narrating it as the cause | Record whether the hypothesis predated the pattern that suggested it. Run the control: was the same signal present during healthy periods? How many equally suspicious things exist here that are not the cause? Broken-looking code in a legacy repo is base-rate noise. | Texas sharpshooter; base-rate neglect; post-hoc target drawing |
| One tidy root cause narrated for a system failure | State the conjunction of conditions that had to hold; mark necessary vs merely present. Ask "how did this become possible?" not "why did this happen?". Two concurrent defects are common. | Single-cause bias; Hickam's dictum; Cook, "How Complex Systems Fail" |
| "X causes the failure", from reading code and logs alone | Name the two runs and the single minimal difference between them before using the word cause. Only the failing run in hand = a hypothesis. A multi-change deploy coinciding with improvement licenses no causal claim. | Mill's method of difference; post hoc ergo propter hoc; Agans rule 5 ("change one thing at a time") |
| The hard question silently swapped for a tractable lookalike ("is the flag on in prod?" becomes "does the code branch on the flag?") | Write the question being answered next to the question asked; check they are the same question in the same modality. Rigour of the substitute answer - exact citations, file:line - is what makes the substitution invisible. | Attribute substitution (Kahneman); modal confusion |
| Plausible in domain terms, so the inference is never examined | Restate the inference with domain words stripped: "if C then O; O observed; therefore C". If the abstract form is invalid, domain plausibility does not rescue it. Then ask what other antecedents produce the same O. | Content effects; formal validity vs plausibility |
| A narrow green check read as proof of a broad claim | State what the check actually bounds, then the claim wanted, then whether the first covers the second; name the gap when it does not. The linter is not the compiler; a paths-exist check does not verify prose. | Verification gap; claim / requires / not-sufficient |
| Correlated verifiers presented as independent confirmation | Independence requires a different evidence channel, framing, or probed failure mode. Same inputs + same framing = one vote. Confidence in a conjunction is its weakest conjunct's, never an average - especially when one conjunct is marked unverifiable in plain sight. | Common-mode failure; redundancy without diversity |
| A "silent regression" accepted because symptoms fit | A regression claim against a dated positive control is the extraordinary claim: it needs a candidate event for the change, not just consistent symptoms. No candidate cause = raise suspicion of the claim, not acceptance. | Prior neglect; extraordinary claims |
| Rigour curdling into manufactured doubt, hedging, or endless investigation | A doubt must name its claim and mechanism and pass "would resolving this change the conclusion or only the wording?" - else drop it. Sound is a complete verdict. Three non-discriminating checks: report what stands, what is open, what would decide it, and stop. | Calibration; epistemic cowardice (the opposite failure) |

Two scoping cautions carried over from the research behind this skill:

- **Vocabulary is not the mechanism.** A controlled ablation of a
  falsification-themed skill found its gains came from procedural scaffold
  structure; the epistemic vocabulary added nothing over bare headings. The
  names in this table are shared vocabulary for talking about failures, not
  what prevents them - the protocol's written artefacts are.
- **Debiasing rules have scope.** "Distrust the docs, verify against the
  code" is sound for what code answers (disposition) and misleading for
  what it cannot (actuality). A debiasing rule applied outside its modality
  becomes a bias: it tells you where to look, and the place cannot contain
  the answer.
