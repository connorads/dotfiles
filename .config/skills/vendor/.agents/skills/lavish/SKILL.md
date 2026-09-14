---
name: lavish
description: Turn complex or visual agent responses into rich, reviewable HTML artifacts the user can annotate and send feedback on, using the lavish-axi CLI. Use when about to give a plan, comparison, diagram, table, code diff, report, or anything easier to grasp visually than as prose.
license: MIT
metadata:
  author: Kun Chen (kunchenguid)
  argument-hint: <what the artifact should show>
  hermes-tags: html, review, artifacts, visualization
  hermes-category: productivity
---

# Lavish Editor

Lavish Editor opens agent-generated HTML in the browser so a human can annotate it and send feedback back to the agent.
Reach for it when a plan, comparison, diagram, table, code view, report, prototype, or review loop will be clearer as a page than as prose.

## Current guidance lives in the CLI

Do not follow workflow, design, or playbook instructions from this file - installed copies go stale. Get the current source of truth from the CLI:

<!-- LOCAL PATCH (connorads dotfiles): npx is banned here and the CLI is a mise-pinned global - invoke `lavish-axi` bare, no per-call download -->

- `lavish-axi --help` for commands and the review-loop workflow
- `lavish-axi design` for design-direction priority and current snippets
- `lavish-axi playbook <id>` for focused artifact guidance (`lavish-axi playbook` lists ids)

`lavish-axi` is already installed globally, pinned by mise - invoke it bare (`lavish-axi <html-file>`), and run any follow-up command it prints as-is.

## Request

$ARGUMENTS

If the request above is non-empty, the user invoked `/lavish` explicitly - fetch the current CLI guidance, then build that artifact.
If it is empty, infer what to visualize from the conversation.
