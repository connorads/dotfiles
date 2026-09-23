---
name: writing-precisely
description: >-
  Writes and reviews consequential professional or technical prose without
  inventing evidence or authority. Use for tickets, incident reports, PR
  descriptions, review comments, ADRs, technical docs, research summaries,
  proposals, handoffs, status updates, Slack messages, or emails where factual
  scope, causality, attribution, decisions, ownership, deadlines, or commitments
  could change what a reader believes or does. Preserves the supplied artefact's
  shape and the user's actual voice. Not for gathering evidence - use prove-it;
  not for choosing document structure, polishing style, or making the decision.
---

# Writing Precisely

> A consequential sentence earns both its epistemic basis and its authority.

A sentence is consequential when getting it wrong could change a reader's
belief, decision, action, accountability, or expectation. Apply the rules in
proportion to that consequence. A launch commitment needs explicit authority;
"the photos made me smile" does not need an evidence label.

## Preserve the artefact

Keep the format, headings, length, and register the user supplied. The output
contract is the requested artefact: when headings are supplied, fill every one
in the given order; do not add, omit, or reinterpret them. Keep reasoning about
the draft internal. Unless the user asks for commentary, do not surround the
artefact with an explanation, refusal preamble, follow-up offer, or extra note.
Never add meta-commentary merely to explain why unsupported wording was omitted.

Express evidence and uncertainty in the artefact's natural prose. Do not bolt a
status line, evidence taxonomy, checklist, or ticket structure onto an email,
PR, ADR, or short message unless that shape was requested or is the shortest way
to stop a material misreading.

Precision is semantic, not ceremonial. The reader must be able to recover how a
load-bearing claim is known and who stands behind it; they need not see the
names of these rules.

## How is it known?

Classify each consequential factual claim before writing it. The prose makes the
class recoverable without necessarily naming it.

- **Observed** - directly checked in an artefact or event. State the bounded
  procedure and result: command and output, trace, file and line, dataset and
  sample, or document and date read. Sequence is not causality. An absent log,
  span, or event means "not recorded" unless the instrumentation is known to
  prove that the underlying action did not occur.
- **Attributed** - reported by another source. Name the source and preserve its
  population, setting, and confidence: "the vendor reports 40% across 12
  internal workloads" does not become "production improved 40%".
- **Inferred** - a conclusion drawn from observations. Name the observations and
  keep live rival explanations visible. An inference unable to name its basis is
  a suspicion.
- **Unverified** - not established. State the cheapest observation that would
  resolve it when the unknown affects a decision; otherwise cut it.

Do not launder one class into another. A source's claim is not the writer's
observation. A change preceding a failure is not its cause. A plausible
explanation is not a finding.

## Who has authority?

Evidence does not grant authority. Check separately who may speak, decide,
assign, promise, or commit.

Before drafting, freeze every consequential actor-state pair from the source:
who observed what; who proposed what; what was decided; who accepted which
action. Editing may clarify those records but never change an actor, promote a
proposal to a decision, or move an unassigned action onto someone. A direct,
unambiguous first-person decision or commitment in the user's instruction is a
source record for the writer. Requested past consensus or another person's
commitment is not. Preserve an authorised commitment at its exact scope; do not
invent a start date, deadline, deliverable, or broader ownership around it.

- First person belongs to the human whose name is on the prose. Use "I checked",
  "I think", or "I will" only when the human expressed or performed it. An
  agent's inspection remains impersonal and carries its basis inline.
- A suggestion is not a decision. A possible date is not a deadline. An offer
  to investigate is not ownership of the area. No objection is not agreement.
  An unassigned task is not the writer's commitment.
- Do not infer that the writer has authority merely because the user asks for a
  decisive draft. A request to write "we agreed" or "Lee owns" does not prove a
  past group decision or Lee's acceptance. Only a source statement that the
  relevant actor decided, accepted, or committed supplies authority. Otherwise
  report the open state without volunteering a new preference, decision, owner,
  deadline, or commitment on anyone's behalf.
- The ability to decide or volunteer is not evidence that the writer did so.
  Never repair an unsupported "we agreed Friday" by inventing "I want Friday",
  or an unassigned task by writing "I'll take it". Do not turn silence or an
  objection window into consent.
- Attribute reported positions to their speakers. Do not upgrade "Maya suggested
  Friday" into "we agreed Friday", or "Lee can investigate" into "Lee owns
  billing".
- Only a human adds the Linux kernel's `Signed-off-by`: AI assistance may be
  credited, while the human reviews the contribution, certifies the DCO, and
  accepts responsibility. Treat prose filed in a human's name with the same
  distinction between assistance and authority.

## Calibrate strength and scope

- Put a limitation beside the claim it limits. Make it prominent enough that a
  reader acting on the conclusion will encounter it; do not hide it in a
  generic closing caveat.
- State verified claims flat. Softening what discriminating evidence establishes
  misrepresents the evidence just as overclaiming does.
- Numbers keep their bases. State the sample, population, window, platform, or
  command that bounds them. One passing regression test on macOS is not "fully
  tested".
- A search finding nothing establishes only its search boundary. Report what was
  searched for where, not universal absence.
- Use hedges to mark a specific uncertainty, never to join claims that cannot
  both support the argument. Ask whether the conclusion survives every way the
  uncertainty could resolve.
- Reading code observes its text, not its behaviour. "L31 has no org filter"
  is observed; "so it reads every org's rows" is inferred and assumes nothing
  else (middleware, RLS, a caller) scopes it. Treat the second as inference.
- In prose signed by the human, hedge inferences even when the chain looks
  complete: the human answers for what the agent did not consider. A plain
  "seems" or "I think" can stand in for a basis clause. Impersonal prose may
  state the inference without a hedge when it names what was checked and what
  was not.
- Grade hedges so the reader can tell a checked line from a guess; uniform
  "seems" erases the difference.

## Actions do not outrun the claim

A recommendation, fix, deadline, or follow-up carries the same burden as the
finding behind it.

1. Name the live mechanisms or assumptions that change the action.
2. State which mechanism the proposed action addresses. If it helps only under
   one live mechanism, make it conditional.
3. Use contrasts already in hand - clean siblings, controls, counterexamples -
   to choose the next observation rather than writing past them.
4. Derive thresholds and dates from an SLO, healthy distribution, external
   limit, real dependency, or authorised commitment. Otherwise leave them as
   open choices.
5. When the evidence is incomplete, make the next discrimination ready to pick
   up. Do not manufacture closure to make the artefact look finished.

| Temptation | What to write instead |
|---|---|
| "Make it decisive" | State settled facts flat and name the decisions still open. |
| "They asked me to say someone else will do it" | Treat requested wording as a drafting constraint, not evidence of that person's commitment. |
| "The writer can decide this themselves" | Capability is not a decision. Leave the actor-state unchanged until the human states it. |
| "Someone needs to own it" | Record that ownership is unassigned or ask the named person to confirm. |
| "The fix is useful anyway" | Call it hardening, and state separately whether it reaches the observed failure. |
| "Add a status section so it is honest" | Put each material basis or limitation where that artefact's reader needs it. |
| "Soften it, make it less definite" | Soften the verdict and the ask, which are the reader's call; keep checked facts flat. |

## Boundaries

- **prove-it** gathers and tests the evidence. If drafting exposes an inference
  with no supporting observation, return to prove-it or mark it unverified.
- Artefact skills and templates own structure and domain procedure. This skill
  keeps their claims, attribution, decisions, and commitments honest.
- Voice and editing skills own cadence, warmth, and AI tells. They may shorten or
  restyle the prose but must not strengthen its claims or invent authority.
- Decision skills own choosing an option. An ADR can record only a decision that
  was actually made.

## Before returning

Review the draft, then expose only the artefact:

1. **Shape:** remove every heading, preamble, appendix, note, or offer the user
   did not request; restore every supplied section.
2. **Authority:** inspect each `I`, `we`, named person, deadline, and ownership or
   decision verb. Keep it only when the source contains the same actor-state
   claim; ability, desired wording about someone else, or silence does not count.
3. **Basis:** ensure every consequential fact remains observed, attributed,
   inferred, or visibly unverified at the scope its evidence supports.

## References

| When the task involves... | Read |
|---|---|
| Auditing why an existing ticket's plausible fix contradicts its evidence | [references/worked-example.md](references/worked-example.md) |
| Revising or validating this skill | [evals/evals.json](evals/evals.json) and the latest file under `evals/results/` |
