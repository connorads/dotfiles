{{marker}}

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
