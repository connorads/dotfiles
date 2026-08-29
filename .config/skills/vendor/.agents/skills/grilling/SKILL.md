---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

<!-- LOCAL PATCH (connorads dotfiles): ask each round through the runtime's structured-question tool (AskUserQuestion / request_user_input); prose numbered lists are the fallback, not the default -->

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet.

Ask the frontier with the runtime's structured-question tool, never prose: `AskUserQuestion` (Claude Code), `request_user_input` (Codex), or whatever equivalent is exposed. Batch as many frontier questions per call as the tool allows, each offering the strongest two to four options its schema permits, the recommended option first and suffixed `(Recommended)`. Every option is a concrete choice whose description names the real trade-off, never yes/no/maybe. The tool appends its own free-text escape, so never add an "Other" option or mention free text. Use multi-select where the choices genuinely stack and the tool supports it. When the frontier is wider than one batch, ask the questions with the most leverage and roll the rest into the next round. Never skip a question and assume the answer.

Where no such tool is exposed, fall back to prose: ask the whole frontier in one round, each question formatted like so, then wait for the user's answers before the next round.

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
