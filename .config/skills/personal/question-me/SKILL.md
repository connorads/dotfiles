---
name: question-me
description: A relentless interview that asks the whole frontier at once, round by round, as batched multiple-choice questions. Use only when the user explicitly asks to be questioned, grilled, or interviewed about a plan, design, or idea - never fire it to resolve ordinary ambiguity mid-task.
---

Interview the user until you reach a shared understanding. Map the problem as a **design tree**: every decision branches into the decisions hanging off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled - the questions you can ask *now* without guessing at answers you haven't heard yet. A question that depends on another question still open belongs to a *later* round, not this one.

Ask the frontier with `AskUserQuestion`, not prose. Up to four questions per round, two to four options each, the recommended option first and suffixed `(Rec)`. Every option is a concrete choice whose description names the real trade-off - never yes/no/maybe. The tool appends its own free-text escape, so offer the strongest three or four candidates and never mention it. Use `multiSelect: true` where the choices genuinely stack. When the frontier is wider than four, ask the four with the most leverage and roll the rest into the next round.

Open a round with one line naming what just got settled and what it unblocks. Skip that line when the questions already say it.

Finding *facts* is your job, never the user's. When a frontier question needs a fact from the environment, dispatch a sub-agent to find it. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait - ask the rest of the frontier now. The *decisions* are the user's.

Each answered round reshapes the tree: settled decisions push the frontier outward and unblock what depended on them. Recompute and ask again. The session ends when the frontier is empty - recap every settled decision in a few lines, then wait. Do not act until the user confirms you have reached a shared understanding.
