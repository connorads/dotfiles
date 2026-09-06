# Failure modes and disciplines

Use this map for root-cause and fix claims. The names are shared vocabulary;
the written checks are the mechanism.

| Failure mode | Required discipline | Provenance |
|---|---|---|
| A matching symptom becomes a unique cause | List live rivals, relevant base rates and each rival's predictions. State how the observation changes their relative weight. | Heuer, Analysis of Competing Hypotheses; premature closure |
| Rows, requests or charts are counted as independent events | Establish unit, identity, deduplication, retry, aggregation and shared upstreams. Collapse common-mode signals before weighing them. | Measurement validity; common-mode failure |
| A successful proxy is treated as the target state | Trace what the proxy actually measures. Verify the downstream state or label the bridge inferred. | Construct validity; open-loop execution |
| A later healthy check rules out an earlier transient state | Align event, intervention and observation windows. Name any assumption that bridges them. | Temporal ambiguity |
| A check ran cleanly but could not observe the failure | Validate detector coverage with a known-positive where practical. State which failure classes and paths remain invisible. | Negative-control logic; verification gap |
| Code, docs or a vendor failure mode match production symptoms | Separate disposition and compatibility from actuality. Observe the live path and compare rivals. | Modal confusion; affirming the consequent |
| A before-after result becomes a causal claim | Name the compared runs and check build, environment, config, input, starting state, window and detector comparability. | Counterfactual contrast; method of difference |
| The strongest toggle would harm users | Do not recreate the production failure. Use a sandbox, replay, shadow, canary or historical contrast; otherwise lower claim strength. | Experiment ethics; safety constraint |
| Zero recurrence becomes zero risk | Validate event identity, denominator, independence, exposure and detector coverage. Report a bound, not certainty. Read null-results.md. | Hanley and Lippman-Hand's rule of three |
| A restart, capacity increase or fallback becomes a repair | Separate symptom disappearance, mitigation, masking, candidate causality, defect removal and recurrence assurance. | Repair-vs-mitigation distinction |
| One passing reproducer becomes general correctness | State exactly which input, state and path the reproducer covers. Keep related failures and general correctness separate. | Zeller's defect-infection-failure chain |
| One tidy root cause replaces a system account | Report trigger, proximate mechanism, contributing conditions, failed defences and intervention points. Mark necessary, sufficient and merely present factors only where supported. | Cook, How Complex Systems Fail |
| An inherited ticket diagnosis hardens into fact | Treat it as Hypothesis #0. Re-derive from primary evidence and preserve its original uncertainty. | Diagnosis momentum; laundering by summary |
| Broken-looking code found by search becomes the cause | Ask whether the signal predated the incident, appears in healthy controls, and is common in the codebase. | Texas sharpshooter; base-rate neglect |
| A narrow green check supports a broad claim | Write the check's actual scope beside the desired claim and name the gap. | Claim-requires-not-sufficient |
| User doubt flips the answer | Revise only for a named change to evidence, logic, arithmetic, provenance or assumptions. | Sycophantic collapse |
| Rigour becomes endless doubt | Stop when target strength is reached or no safe feasible observation has enough decision value. Drop doubts that change neither conclusion nor action. | Calibration; value of information |

## Two cautions

- Vocabulary is not enforcement. The artefacts produced by the protocol are
  what make the reasoning inspectable.
- A discipline used outside its scope becomes a bias. Code answers disposition;
  live state answers actuality; neither substitutes for the other.
