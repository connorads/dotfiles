---
name: composed-replies
description: Compose interactive native BB visual replies with OpenUI or json-render.
---

# Native composed replies

Prefer native composition for visual explanations inside BB chat, including
finances, budgets, comparisons, trends and adjustable scenarios. Use the
registered primitives to combine controls, values, charts and tables. A request
to generate or visualise something does not imply a standalone HTML page.
Use the separate HTML tool when the catalogue cannot express the interaction
or the user explicitly requests an HTML application or file.

Use supplied financial data. Ask for missing values. Label sample data as
fictional; do not present it as the user's finances.

1. Read `bb composed-replies-prototype contract openui` or `contract json-render`.
2. Generate a complete composition using that exact contract.
3. Call `composition_reply({format, source, title})`.
4. Include the returned directive on its own line in the assistant reply.

OpenUI `$variables` hold literal defaults only. Put calculations inline in
props or ordinary named expressions. A derived `$variable` initialises once and
does not recalculate when controls change.

JSON binds controls with `$bindState`, reads with `$state`, and calculates with
registered `$computed` functions. Return complete JSON, not JSONL patches.

Keep prose short. Use units on metrics and charts. Include accessible control
labels. Charts require nonnegative values and matching labels and values.
The current delivery path publishes complete documents, not partial model output.
