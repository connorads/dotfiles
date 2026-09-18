---
name: technical-explainer
description: >-
  Shapes explanations of technical changes so an audience can review a
  proposal or decide whether to try it. Use when creating a PR review video,
  explaining an architecture proposal to colleagues, or presenting experiment
  results for a decision. Not for performing the code review, writing a routine
  PR description, or teaching a topic across multiple lessons.
---

# Technical Explainer

What must this audience understand to make the decision or take the action
the user wants?

## Keep The Brief

Keep the audience, requested response, format, duration and accepted choices
in the project's existing brief or notes. Recover these from the conversation
before asking questions. Ask only about unresolved choices that change the
explanation. A request to revise the voice does not reopen the audience or length.

## Build The Explanation

1. Lead with the proposal and why the audience should care. Give only the
   wider context needed to understand this decision.
2. Choose one real example with a visible problem and an understandable
   action. Prefer an example requiring little background over one covering
   more of the implementation. Show the relevant input, change and consequence.
3. Explain the process before its results. Say what people or tools actually
   did. Introduce an unfamiliar term after that explanation, if the audience
   needs the term to navigate the source material.
4. Present the evidence needed for the decision. Explain what was compared
   and what a reported number counts. Keep limitations beside the conclusions
   they constrain. Where no evaluation exists, describe what remains to test.
5. End with a short route to act. Name what to inspect, what feedback matters
   and where to give it. Carry forward the user's requested response.

Use this order as a starting point. Preserve a supplied structure when the
user asks for it. Cut a section if removing it leaves the audience able to
make the same informed decision.

## Choose And Check Examples

Read the underlying change and its supporting material before selecting an
example. Keep source links and revisions beside the working script. Historical
comments may refer to code that the final revision has already changed.

For each candidate, write one sentence explaining the problem and one explaining
the action. If those sentences require another lesson, choose a simpler candidate.
Simplify the presentation, but preserve differences that change whether the
proposed action works. Label shortened code and paraphrased comments.

Use concrete process language in the explanation. For example, "we downloaded
PR comments and grouped repeated requests" tells the audience more than
"we mined human review threads". Repeated requests establish something worth
considering; they do not establish agreement on a rule.

Check that the story distinguishes what exists in this change, what is proposed,
and what is possible follow-up work. An attractive future use must not look
like an implemented feature.

## Boundaries And References

This skill owns the explanation's structure and choice of example.
`writing-precisely` owns evidence, attribution and authority in the wording.
Use the audience's requested writing and accessibility skills for presentation.

For a narrated PR video, read [the video recipe](references/pr-review-video.md).
Use the chosen media skills for tool commands, recording, animation and rendering.

`evals/cases.md` contains authoring test cases and observed feedback. It is
for evaluating this skill, not part of the explanation workflow.
