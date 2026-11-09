# Minicharts

Charts drawn by hand and to scale, as real things from their own subject: your spending as a pie of coins, a
sign-up funnel pouring letters into a postbox. 54 chart types, each an interactive HTML page where every part answers when you touch it.

By April Zhu · https://april-zhu.com/minicharts

## Install

Claude Code: put this `minicharts` folder in `~/.claude/skills/` (or your project's `.claude/skills/`).
Claude.ai: upload `minicharts.skill` (or this folder zipped) under Settings → Capabilities → Skills.

## Use

Ask for a chart in plain words, with your numbers or just a subject:

- "Use Minicharts to draw where our café's money went last month as a pie chart: rent 1,200, beans 640, milk 310, staff 2,100."
- "A funnel of our newsletter: 4,000 visited, 900 signed up, 300 opened the first email."
- "Show my week of sleep as a lasagna plot."

You get one HTML file. Open it in any browser and touch the slices, bars and dots.

## What is inside

- `SKILL.md`: what Claude follows.
- `references/types.md`: the 54 types and what each is for.
- `references/kit.md`: the drawing kit.
- `assets/`: the engine, the 54 example drawings and the page builder (`python3 assets/build.py --examples all -o all.html` shows every example).

## Licence

MIT. Free for personal and commercial work, including the charts you make with it. See LICENSE and NOTICE.md.
