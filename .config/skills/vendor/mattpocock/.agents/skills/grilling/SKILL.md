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

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

<!-- LOCAL PATCH (connorads dotfiles): find facts without assuming the runtime has sub-agents; open each round with what it unblocks and close with a recap -->

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one. Open each round with one line naming what just got settled and what it unblocks; skip that line when the questions already say it.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), find it: via a sub-agent where the runtime has one, otherwise yourself between rounds. Don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for that fact to land; ask the rest of the frontier now. The _decisions_ are the user's. Ask upfront for intent and existing constraints that change the investigation. A preference that depends on unseen results is not ready for questioning: gather and present the cheapest useful comparison, measurement or example first. A spike needs a question to investigate, not an invented acceptance threshold. When asked for trade-offs, explain them before asking for a choice; a comparison need not end with a decision.

End the current round when the remaining decisions need evidence. Name those deferred decisions and the investigation that would make them answerable; do not force answers to complete the tree. Continue authorised investigation without treating it as approval to implement a choice. When the decision session is complete, recap the settled decisions and anything still deferred. Do not implement the chosen plan until the user confirms you have reached a shared understanding.

When revising this skill, use [evals/evals.json](evals/evals.json) to check question timing and evidence-dependent decisions.
