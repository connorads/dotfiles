# Worked example: the warm cache that proved nothing

A composite of a real incident, genericised. It is worth reading because
every error in it was committed by capable, careful investigators - the
failure was never effort, it was inference.

## The setup

A staff dashboard computes per-organisation metrics. The slow path fans out
to a datastore (~1-2s per segment, 8 segments); a nightly job precomputes
the aggregates and a cached read path serves them, gated on an env flag:

```ts
if (process.env.METRICS_CACHE_ENABLED !== "true") return null;
```

The cache shipped in July: parity checks 10/10, p50 collapsed 4.1s → 300ms.
A month later the perf board goes red for 4 of 9 organisations. A ticket
appears:

> p95 back over 6s. Slow traces show `getOrgMetrics` dominating, 5-9s
> spans. KV checked: metrics keys present for all orgs, written last night
> (cache is warm). Working theory: `METRICS_CACHE_ENABLED` got unset in a
> recent env change - the fan-out is ~1-2s × 8 segments, which matches the
> spans exactly.

An investigation "verifies the theory against the code" and reports, with
exact file:line citations, that the mechanism is real and the cache is
warm. The ticket is treated as confirmed. It is wrong - the flag was on the
whole time; the tail was serverless cold starts, a rival already recorded
in an older ticket nobody re-read.

## What the protocol catches, step by step

**Step 1 - modality.** The question is "is the cache being read in
production?" - actuality. Every piece of evidence gathered (code structure,
docstrings, KV contents) answers disposition or adjacent questions. The
citations are precise; the modality is wrong. Precision is not relevance.

**Step 2 - premises.** "Suspect the flag got unset" arrived inside the
ticket and was inherited as the frame by everyone downstream. It is
Hypothesis #0. Note also what each retelling did: "likely unset" became
"caches sit warm and unread" became "recomputing metrics live" - hedges
stripped at every hop.

**Step 3 - rivals.** The rival was not obscure: an older ticket recorded
that after the serverless migration the extreme tail flipped from datastore
time to cold start, and that cold-start time is attributed to whatever the
first awaited call is. Nobody enumerated rivals, so nobody re-read it. The
rival also explains the 4-of-9 split (low-traffic orgs cold-start more),
which a process-wide flag struggles to.

**Step 4 - diagnosticity.** Score each evidence item against both
hypotheses: slow p95 (both), red board (both), slow `getOrgMetrics` spans
(both - cold start lands inside the first awaited span), warm KV keys
(both - the writer job never reads the flag, so warm keys are what you see
whether the read path runs or not). Five items, zero discrimination. The
case felt strong by volume and proved nothing. Discriminating checks
existed and were cheap: trace shape (flag off = no KV-get span at all,
before the fan-out), or p50 for all orgs (flag off = p50 up everywhere;
cold start = p50 flat, tail only).

**Step 5 - labels.** "Mechanism exists" - observed. "Cache warm" -
observed, and irrelevant (see above). "Flag unset in prod" - assumed, and
marked unverifiable in the report itself. The final confidence was
effectively averaged across claims; the weakest-conjunct rule says the
conclusion could never be stronger than that one assumed link.

**Step 6 - basis.** The honest report is: "Cannot determine from the
repo whether the cached path runs; the code establishes the mechanism only.
The warm cache discriminates nothing because the writer is ungated.
Deciding observation: the env value on the serving deployment, or the
presence/absence of a KV-get span in one slow trace."

**Stop rule.** With the flag's state assumed, no action (env change,
"fix" deploy, ticket closure) is licensed. The next step is the deciding
observation, which was one command away the entire time.

**The arithmetic check, in passing.** 8 segments × 1-2s predicts 8-16s of
live compute; observed spans were 5-9s. The ticket said the numbers matched
"exactly". They are incompatible with a full live compute - derived, from
the ticket's own figures, and nobody ran the multiplication.

## The follow-on trap this skill was commissioned for

With "cold start" now suspected, a teammate proposed deploying a CI-only
change and watching the weekend: no recurrence, call it fixed. Step 4 kills
it in one line - a deploy touching no production code cannot exercise a
production-code hypothesis, so a quiet weekend is compatible with every
live hypothesis and rules nothing out. Step 6's arithmetic adds the bound:
weekend traffic on a staff dashboard yields a handful of independent
trials; zero events in n trials bounds the rate near 3/n, far above the
historical rate. The quiet was guaranteed to look like success whatever
was true - the observation could not have come out differently if the
conclusion were wrong, which is the north star failing in its purest form.
