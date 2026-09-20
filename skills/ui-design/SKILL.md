---
name: ui-design
description: >-
  Designs and builds application screens and task flows. Use when creating or
  improving a working user interface and deciding its screen structure,
  navigation, collection controls, repeated entry, progress or recovery.
  Covers review queues, editors, import screens and multi-step forms.
  Not for marketing pages, research diagnosis, feature prioritisation, or an
  already specified cosmetic or accessibility fix.
---

# UI Design

**What must this person see, do and understand to complete the task?**

Make the next decision easy to make. Group its evidence, controls and outcome
before allocating space to the application shell. A screen can look composed
while making someone scroll past repeated metadata to read the one fact their
decision needs.

Recommend a structure from the supplied task and implement it. Ask only when
an unresolved product rule changes the structure or consequences. Treat
assumptions as assumptions; a polished prototype is not user research.

## Choose the working view

Read the relevant reference before choosing its structure:

| Task | Reference |
| --- | --- |
| Overview, list/detail, searching, filtering or moving between items | [references/screens-and-collections.md](references/screens-and-collections.md) |
| Repeated entry, branching, interrupted work, uploads or consequential actions | [references/workflows-and-actions.md](references/workflows-and-actions.md) |
| Checking a runnable design before delivery | [references/verification.md](references/verification.md) |
| Checking attribution, editions or limits of the advice | [references/sources.md](references/sources.md) |

Keep the recommendation concrete: which information stays together, which
control advances the work, and what remains when the person returns. Build
the smallest complete task with representative data and actual state changes.
A handoff to another skill is not completion of a request to build.

## Work with the available tools

Use the project's components, tokens and conventions. Use available visual
skills for hierarchy and craft, accessibility guidance for semantics and
keyboard/focus behaviour, and engineering guidance for implementation.
`ui-design-playbook`, `accessibility` and Impeccable are optional companions;
this skill requires none of them and does not require installing an engine.

Without companions, keep the next action distinct, related information close,
labels explicit and controls native. Inspect the rendered result at narrow and
wide widths, with long content and a keyboard. Follow the task checks in the
verification reference, then finish the requested implementation.

`evals/` contains maintainer prompts and fixtures. It is not part of a product's
runtime or a checklist to inject into every task.
