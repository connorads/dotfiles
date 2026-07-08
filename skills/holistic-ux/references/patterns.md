# UI Patterns

Pattern-selection guidance for low-fidelity UX work. This is a decision guide,
not a visual spec or implementation library.

Boundary: use `ui-design-playbook` for visual implementation details such as
spacing, typography, colour, layout polish, and component styling. Use
`accessibility` for WCAG, ARIA, keyboard, focus, and screen-reader details.

## Navigation

Choose navigation by information shape:

| Pattern | Use when | Avoid when |
| --- | --- | --- |
| Top navigation | There are a few stable, high-level destinations | The product has many nested areas |
| Sidebar | Users need repeated access to many sections or a hierarchy | The experience is simple or mobile-primary |
| Tabs | Users switch between peer categories within one context | The sections are unrelated or too numerous |
| Breadcrumbs | Users move through a deep hierarchy | The flow is flat or strictly linear |
| Mobile menu | Screen space is tight and destinations are secondary to the task | The hidden destinations are core to completion |

Check the main user task before adding navigation. More navigation can make
orientation worse if it competes with the primary path.

## Forms

Use forms when the user must provide structured information to complete a task.

- Prefer one clear path through the fields.
- Group related fields by meaning, not database structure.
- Break long or high-risk forms into steps when users need reassurance or when
  later questions depend on earlier answers.
- Show validation and recovery where the user can act on it.
- Keep optionality explicit; hidden requirements create support load.

Avoid asking for information before it is needed. If the service already knows
something, confirm it instead of making the user re-enter it.

## Cards

Use cards for collections where each item is a self-contained object users can
scan, compare, or open.

- Good fit: products, articles, templates, saved items, candidates, projects.
- Weak fit: dense tabular comparison, step-by-step tasks, long prose, settings.
- Keep each card focused on the same decision: compare, choose, resume, or
  inspect.

If users need to compare many attributes precisely, use a table instead.

## Modals

Use modals for short, interruptive decisions that must resolve before the user
continues.

- Good fit: confirmations, lightweight focused tasks, urgent warnings.
- Weak fit: multi-step work, reference material, complex editing, anything users
  need to compare with the page behind it.
- Prefer inline disclosure or a dedicated page when context matters.

Destructive confirmations should explain consequence, reversibility, and the
safe exit.

## Buttons

Buttons express action priority. Decide the hierarchy before styling.

| Level | Use for |
| --- | --- |
| Primary | The main next action for the current decision |
| Secondary | Useful alternatives that should remain visible |
| Tertiary | Low-priority actions that should not compete |
| Destructive | Actions with irreversible or harmful consequences |

One visible decision area should normally have one primary action. Too many
primaries signal that the flow has not been prioritised.

## Loading

Choose loading feedback by what the user can know and do:

| Pattern | Use when |
| --- | --- |
| Skeleton | The shape of content is known and loading should feel continuous |
| Spinner | Duration is unknown and the waiting area is small |
| Progress indicator | Progress is measurable or the task has clear steps |
| Optimistic update | Failure is rare and rollback is easy to explain |

For slow or risky operations, set expectations and preserve user input. A loader
without recovery is only decoration.

## Notifications

Choose the smallest feedback pattern that matches the consequence:

| Pattern | Use when |
| --- | --- |
| Toast | The outcome is brief, low-risk, and does not need immediate action |
| Banner | The message affects the whole page, session, or service |
| Inline alert | The message belongs to a specific field, section, or decision |

Do not use transient notifications for errors users must fix or information they
may need to reference.

## Tables

Use tables when users compare structured data across shared attributes.

- Good fit: records, financial data, inventory, permissions, logs, schedules.
- Weak fit: narrative content, visual browsing, sparse item summaries.
- Prioritise the columns that support the user's decision.
- Plan empty, loading, error, filtered, and no-results states.

If the user scans objects more than attributes, cards may be clearer.

## Accordions

Use accordions for optional or secondary detail where users need only some
sections.

- Good fit: FAQs, progressive detail, advanced settings, grouped policy text.
- Weak fit: primary steps, critical warnings, information users must compare
  across sections.
- Avoid hiding content required for task completion.

If most users need most sections open, the accordion is adding work rather than
reducing complexity.

## Selection Cheatsheet

| User need | Likely pattern |
| --- | --- |
| Move between product areas | Navigation |
| Provide structured information | Form |
| Browse similar objects | Cards |
| Resolve a focused interruption | Modal |
| Trigger or confirm an action | Button |
| Wait with confidence | Loading pattern |
| Understand an outcome or issue | Notification |
| Compare structured records | Table |
| Reveal optional detail | Accordion |
