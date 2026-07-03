# Evidence behind design-forking

Condensed research base for each rule in SKILL.md. Findings graded: [robust] = meta-analytic or repeatedly replicated; [supported] = converging controlled studies; [practitioner] = credible practice without controlled evidence.

## Why fork at all

- First workable ideas win by default (satisficing - Simon 1955-57) and anchor everything after them; designers reproduce example features *even when told the features are flawed*, and expertise does not immunise (design fixation - Jansson & Smith 1991, Design Studies 12(1); replicated by Purcell & Gero 1996, Linsey et al. 2010). [robust]
- Parallel creation of alternatives beats serial on outcome quality, divergence, and openness to critique, with effort held constant (Dow et al. 2010, ACM TOCHI 17(4) - web-ad experiment with live click-through data; Dow et al. 2011 CHI for sharing-multiple). [supported]
- You keep only the best candidate, so payoff follows the sample maximum: it rises with N and with the set's variance, not its average (Girotra, Terwiesch & Ulrich 2010, Management Science 56(4); Simonton's equal-odds rule 1997). "Generate alone, then pool" beat collaborative building. [supported]
- Ousterhout, A Philosophy of Software Design ch. 11 ("Design it Twice"): consider two or more options for every major decision, "pick approaches that are radically different from each other", include one you suspect is worse; the dominant comparison axis for interfaces is ease of use for callers. [practitioner - the canonical software framing]

## Why the gate (step 0)

- Bezos one-way/two-way doors: deliberate slowly only on irreversible, consequential decisions; decide reversible ones fast. Fowler ("Who Needs an Architect?", IEEE Software 2003): the architect's job is to *eliminate irreversibility*; modularity manufactures the option to defer. Real-options treatments: Baldwin & Clark; Hohpe. [practitioner, economically grounded]
- Set-based concurrent engineering (Toyota - Ward, Sobek, Liker; Sloan Mgmt Review 1995/1999): carry sets of alternatives, converge at the last responsible moment, and eliminate by proven infeasibility rather than early preference. Pays only under genuine uncertainty and costly reversal - hence the gate. [supported in manufacturing; transfers as discipline]

## Why forced axes and the mechanism ban (step 2)

- LLMs fixate within a run at near-human rates AND collapse to one shared centroid across runs (knowledge aggregation): humans' first ideas spanned ~14.5 unique categories vs ~8.4 for the model (arXiv 2602.20408). Individual novelty gains with collective homogenisation: Doshi & Hauser 2024, Science Advances; Anderson et al. 2024; homogeneity holds across model families (arXiv 2501.19361; PNAS Nexus). [supported]
- What works: elaborate/CoT prompting and diverse *ordinary* personas (persona+CoT beat humans' category coverage by 26% in 2602.20408); blunt "go beyond the usual categories" defixation instructions (IDEAFix, arXiv 2606.00875) - which also found formal creativity methods (SCAMPER, TRIZ, Design Thinking) fail to beat simple prompting. Temperature is a weak lever and degrades quality (arXiv 2402.01727). [supported]
- Denial prompting - incrementally banning the previous solution's core construct - measurably pushes models into novel solution regions (via IDEAFix/NeoGauge). The mechanism ban generalises this. [supported, LLM-specific]
- Independent samples from the same prompt diversify; sequential proposals re-anchor (Tree of Thoughts, arXiv 2305.10601 - validated on open-ended creative writing). Hence fresh-context parallel subagents for one-way doors. [supported]
- The enforcement-locus axis (types / boundary parser / tests / runtime / process) is our synthesis from "Parse, Don't Validate" (Alexis King 2019) + "make illegal states unrepresentable" (Minsky; Feldman): the same invariant enforced at different loci yields radically different designs with different cost/safety/reversibility profiles. Not a cited technique - an original contribution, but exactly the kind of structural axis denial-prompting research exploits.
- Analogy: far-but-retrievable beats near or random - an inverted-U in analogical distance (Chan et al. 2011; Fu et al. 2013), and models don't analogise spontaneously, so the source domain must be named. [supported]

## Why converge separately with an independent judge (step 3)

- Generating well does not select well: groups systematically pick early, feasible, unoriginal ideas (Rietzschel, Nijstad & Stroebe 2006; Johnson & D'Lauro 2018). Discernment is the binding constraint (Girotra 2010, lever 4). [supported]
- LLM judges self-prefer their own outputs, traced to self-recognition; it survives prompt-level debiasing and amplifies in self-refinement loops (Zheng et al. 2023; Xu et al. 2024; Panickssery et al. 2024). Mitigation is architectural: fresh-context or different-family judges; panels of disjoint judges beat one big judge (PoLL, Verga et al. 2024). [supported]
- Per-attribute scoring over overall marks: ATAM (SEI - Kazman/Klein): quality attributes inherently conflict; the analysis output is sensitivity and trade-off points, not a total score. [practitioner, heavily codified]
- Multi-agent debate is not a diversity engine - it roughly matches self-consistency at equal budget (arXiv 2505.22960). Independent generation + rubric judge is cheaper and as good. [supported]

## Why record the losers (step 4)

- MADR / ADR practice: "Considered Options" with per-option pros and cons as a first-class, required section - the analysis is the reusable artefact, and it cannot be faked convincingly post-hoc. [practitioner]

## Why the hard gate phrasing

- Advisory process language gets rationalised away on "simple" tasks - documented lesson from the superpowers brainstorming skill (v4.3.0), matching the fixation literature. Divergence must be a step with a completion criterion, not advice. [practitioner + consistent with [robust] fixation findings]

## Deliberately NOT encoded (evidence-free or debunked formats)

Verbal group brainstorming (nominal individuals beat interacting groups - Diehl & Stroebe 1987 [robust]); Six Thinking Hats / lateral thinking branding (Moseley et al. 2005: evidence "sparse"); SCAMPER and TRIZ as rituals (test-score gains only / unreproducible derivation); Double Diamond and Crazy 8s as formats (the underlying diverge-converge and parallel-ideation principles are captured directly above); morphological boxes as more than a structuring heuristic; temperature as a creativity knob.
