---
name: writing-precisely
description: >-
  Renders investigation findings as honest tickets, issues, bug reports, and
  incident writeups filed in the user's name: every claim carries its evidence,
  hedges mark real uncertainty instead of smoothing over gaps, and proposed
  fixes never outrun the diagnosis. Use when drafting or reviewing a ticket or
  writeup, when deciding how confident a claim may sound, when the user asks
  whether a ticket overclaims or is bullshitting, or when writing first-person
  prose on the user's behalf. Not for conducting the investigation itself -
  that is prove-it; this skill owns how the result is written down.
---

# Writing Precisely

> A document is honest in its structure, not its tone. Every load-bearing
> claim states how it is known and who vouches for it; a reader checks
> compliance by the shape of the text, not the register.

The corollary that motivates everything below: **hedged style is not
calibration**. A ticket can sound measured - "mechanism not fully proven",
careful percentiles, a "likely" in the right place - while the chain between
its sentences is broken. Tone rules would pass it. These rules do not.

## Voice: who vouches

First person belongs to the human whose name is on the document. It is their
signature, and a signature is the one thing an agent must never forge (the
Linux kernel's rule: an assistant may be credited, but only a human adds
`Signed-off-by`).

- Never write "I believe / I think / I suspect / I checked" for a judgement
  or action the human has not expressed or taken. Their hedge is a trusted
  signal precisely because it means *their* judgement passed over the claim.
- Agent-established claims are written impersonally with their basis inline:
  "the retry loop at `queue.ts:142` never resets the counter (traced, not
  run)" - not "I found that the retry loop…".
- Leave first-person judgement slots to the human: draft the claim with its
  evidence and let them add "I think we should…" where they mean it.

## The three kinds of sentence

Every material claim is one of three, and the prose must make clear which.
Short tickets carry this in sentence structure; long writeups in sections.

- **Observed** - cite the artefact: command and output, trace, file:line,
  doc plus date read. No causal verbs inside an observation ("errors rose at
  10:14", never "the deploy broke it at 10:14").
- **Inferred** - names the observations it rests on. An inference that
  cannot name them is a suspicion: mark it as one or cut it.
- **Unverified** - says what would check it, and never sits unmarked beside
  observations borrowing their credibility.

The document opens with a **status line of procedure verbs**: what was run,
what was read, what the human personally checked. "Ran the repro 10/10 on
`main@abc123`; cause traced in code, not toggled; queries below not yet run
against prod." A status names a procedure - "fairly confident" is a mood.

**Titles state the observation.** A diagnosis enters the title only once it
is observed or toggled, not while it is the leading hypothesis. "Status
endpoints hang ~55s" - not "…: no timeout on OAuth refresh" while the
mechanism is open.

## Hedges

- A hedge sits adjacent to the specific claim it qualifies and that claim's
  evidence. "Likely a race in the retry loop (inferred from interleaved
  timestamps in log X)" is precision. "There may be some issues with error
  handling" is unfalsifiable and cites nothing - the weasel form is vague
  attribution, not softness.
- It cuts both ways: an unhedged flat statement is *earned* by verification,
  and a verified claim is stated flat. Softening what three sources support
  misrepresents the evidence just as overclaiming does.
- **The bridging hedge** (anti-pattern): a hedge used to join two claims the
  evidence puts in tension - "mechanism not fully proven; whatever it is,
  the fix contains it" - written where the evidence shows the fix cannot
  reach the mechanism. Test any hedge: if the uncertainty resolved either
  way, would the surrounding argument survive? A marking hedge survives; a
  bridging hedge was hiding a fork in the road.
- **Basis inflation** (anti-pattern): "verified per-trace" meaning one
  trace; "warm instances stall too" with no stated source; a claim's basis
  quietly rounder than what was done. State n. Cite or cut. A search that
  found nothing is a bound ("searched X for Y, none found"), not proof of
  absence.

## Fixes never outrun the diagnosis

The observed failure this section exists for: an agent proposes a precise
fix while its own evidence contradicts the mechanism the fix assumes.

Before writing a Fix or Recommendation section:

1. List the mechanisms still live. If the ticket's evidence has not
   eliminated all but one, say so in the ticket.
2. The fix states which mechanism it assumes. A fix that only helps under
   some live mechanisms is not a fix - it is one arm of a spike.
3. **Use every contrast already in hand** (the unused contrast is how
   plausible-wrong diagnoses survive): a clean sibling, a control, a route
   that doesn't exhibit the symptom is evidence about mechanism. Run the
   discrimination or list it as the open question.
4. When the mechanism is open, write a **spike ticket**: each unknown as a
   checkbox with the observation that closes it, findings recorded as they
   land, the fix conditional on the outcome. An honest spike is more
   actionable than a confident wrong fix.
5. Numbers carry bases. A proposed threshold ("timeout ~5s") names its
   derivation (p99 of healthy calls, an SLO, a vendor limit) or stays a
   question for the implementer.

| You will think… | But actually… |
|---|---|
| "A timeout/guard is safe containment whatever the cause" | Containment must reach the mechanism. A handler-level timeout cannot contain a pre-handler stall. Name the mechanism the containment assumes. |
| "Mechanism not fully proven, but the fix is worth doing anyway" | Only if it helps under *every* live mechanism - then say exactly that. Otherwise this is a bridging hedge. |
| "A ticket with a Fix section reads more finished" | A wrong fix ships confident work to the wrong place. The spike form is the finished artefact when the diagnosis is open. |
| "The clean sibling is just noise, the pattern is what matters" | The clean sibling is the cheapest discriminator you have. Explain it or lose the diagnosis. |

## Boundary with prove-it

prove-it disciplines the investigation: whether the evidence gathered
entails the claim. This skill owns rendering the result as prose under the
user's name. The two meet at the chain: if drafting exposes an inference
that cannot name its observations, that is prove-it work - go get the
observation, or write the claim as unverified with what would check it.

## References

| When the task involves… | Read |
|---|---|
| Seeing the audit and rewrite of a realistic ticket that sounds calibrated but bullshits | [references/worked-example.md](references/worked-example.md) |
