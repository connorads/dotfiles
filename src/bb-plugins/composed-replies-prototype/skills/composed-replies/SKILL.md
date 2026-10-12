---
name: composed-replies
description: Compose interactive native BB visual replies with OpenUI or json-render.
---

# Native composed replies

Use the eight registered primitives for interactive explanations that combine
controls, values, charts and tables. Use the separate visual-replies-prototype
HTML tool when a custom application needs a different interface.

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
