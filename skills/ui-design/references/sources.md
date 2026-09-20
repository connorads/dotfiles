# Sources and limits

This skill is an original synthesis of the following books. Examples and
verification tasks are original applications, not quotations or reported
experiments. The skill works without access to the books.

| Source | Relevant locations | Contribution |
| --- | --- | --- |
| Jenifer Tidwell, Charles Brewer and Aynne Valencia, [Designing Interfaces, third edition](https://www.oreilly.com/library/view/designing-interfaces-3rd/9781492051954/), O'Reilly | Chapter 2, pp. 35-38 and 86-87; chapter 7, pp. 335-350 | Screen purpose, collection decisions, split view, drilldown and inline expansion |
| Same book | Chapter 3, pp. 133, 165-168 and 171; chapter 8, pp. 402-420 | Navigation state, direct entry, preview, progress, cancellation and reversal |
| Alan Cooper, Robert Reimann, David Cronin and Christopher Noessel, *About Face*, fourth edition, Wiley, 2014, ISBN 9781118766576 | Chapter 5, pp. 123-130; chapter 12, pp. 285-297 | Group facts and actions by the decision; validate several scenarios; remove repeated work |
| Same book | Chapter 10, pp. 240-246; chapter 15, pp. 358-377 | Task frequency, contextual feedback, meaningful reversal and preview |
| Adam Silver, *Form Design Patterns*, Smashing Magazine, 2018 | Chapter 1, "The Question Protocol"; chapters 6-7, search and filter patterns | Field purpose, search scope and choosing immediate or batch filtering |
| Same book | Chapter 8, "A Persistent Upload Form" and "Feedback"; chapter 9, persistent form, branching and "Add Another"; chapter 10, task lists | Per-file state, repeated-entry choices and interrupted work |

Page numbers refer to printed pages, not PDF viewer positions. The Silver
citations use section names because EPUB pagination varies. Edition identity
comes from the books themselves; catalogue filenames can misidentify it.

*Every Layout*, by Heydon Pickering and Andy Bell, informs the optional visual
playbook's spacing and composition examples. It does not require a separate
layout library. *Refactoring UI*, by Adam Wathan and Steve Schoger, belongs with
visual hierarchy and styling guidance rather than being duplicated here.

## What does not transfer unchanged

These books supply interaction reasoning, not current browser support tables.
Check maintained HTML/CSS and accessibility documentation for implementation.
Do not import historical jQuery or ARIA snippets, tiny pointer targets, omitted
keyboard operation for rare tasks, fixed pane counts or blanket rules to
minimise clicks. Task frequency does not excuse an inaccessible operation.

Cancellation, undo, persistence and ownership depend on the product's actual
operation model. A book's preference for recovery does not create that
capability. Do not invent user research, claim a pattern always wins or treat
a simulated backend as implemented persistence.
