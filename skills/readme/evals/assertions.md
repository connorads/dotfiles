# Assertions

Each prompt's output README passes all of these. Sources: baseline runs on
p1 without the skill, 2026-09-29 (both runs failed 1 to 5).

1. A picture is present, or an HTML comment TODO names the exact command or
   screen to capture. Static badges do not count.
2. At most 4 badges, each live (CI, version, licence, downloads).
3. No full flag table, output schema or security-model table inline; each is
   linked to `--help`, `docs/` or an ADR.
4. None of the shapes in SKILL.md's table: denial then reframe, aphorism
   close, mirrored antithesis, staccato negation, triplet then punchline, the
   reveal, dash-list tagline, identical bold-dash bullets, em dash aside.
5. No bold or italic emphasis in running text; no decorative emoji.
6. No home-relative or machine-specific paths.
7. Pitch and go length: 300 to 800 words. First code block within about 100
   words of the top.
8. Handback names any docs file created and any image still to capture.
