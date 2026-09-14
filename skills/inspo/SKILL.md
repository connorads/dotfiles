---
name: inspo
description: >-
  Look at real production websites before designing one. Searches a curated
  archive of 832 captured sites - screenshots, palettes, fonts, extracted design
  systems, reference components - filters it by style, vibe, macrostructure,
  colour, page type and industry, and downloads the screenshots so you can
  actually see them. Use before building any landing page, marketing site,
  dashboard, portfolio or app UI from a brief, when picking a visual direction
  or page structure, when a design needs a concrete reference rather than
  adjectives, or when the user asks what sites like theirs look like. Not for
  polishing UI you have already chosen, and not for one named brand's own site.
---

# inspo

**You cannot design from a description.** The archive's prose will tell you a
page is "brutal monochrome geometry, stark sans-serifs, vast negative space",
and you still do not know what it looks like. Fetch the screenshot and look.

The trap is specific. `get_screen` returns an `autopsy` field: several hundred
words of fold-by-fold analysis with hex values and type scales, and it **reads
like a finished brief**. Reading the autopsy and writing code is the failure
this skill exists to stop. It is a caption for an image you have not seen.

## The loop

The order is the mechanism, not a suggestion.

1. **Brief → `recommend`.** Hand it the user's actual words. It returns a
   macrostructure `pick` with its rationale, a ranked `shortlist` of page
   structures, and `exemplars` - the screen slugs that carry them. Its `pick`
   is lexical, so a brief whose defining word is a feeling rather than a page
   type ("expensive and quiet") lands on whatever genre shares its vocabulary.
   Treat it as a seed and run `search_screens` on `vibe` and `style` too.
2. **`shots` those exemplar slugs, then Read each file.** Pixels first. Read at
   least three before writing any markup.
3. **Then `get_screen` or `get_design_system`** for the sites you chose by eye.
   Now the autopsy is a caption for something you have seen, and the palette
   and type ramp are numbers you can copy.
4. **Build**, naming which slug each decision came from.

Skipping to step 3 produces plausible design prose and generic markup. That is
the whole failure mode, and it looks like working output.

## Commands

```bash
# 1. Brief in, ranked shortlist out. Quote the user's own words.
scripts/inspo.py recommend "a trader's dashboard, dense but calm"

# 2. Screenshots to disk, one absolute path per line. Read each one.
#    The slugs are whatever step 1 returned, never ones you made up.
scripts/inspo.py shots <slug> <slug> <slug>

# 3. Structured filters beat free text on a curated archive of 832 sites.
scripts/inspo.py call search_screens --arg query="a designer's portfolio" \
    --arg style=editorial --arg mode=dark --arg limit=3

# 4. The live schema: every tool, every argument and its accepted values.
scripts/inspo.py tools
```

`--arg KEY=VALUE` works on all fifteen tools. Each value is parsed as JSON and
falls back to the raw string, so `limit=3` is a number, `slugs=["a","b"]` is a
list, and an apostrophe in a brief needs no escaping.

## Reading the images

`--variant hero` is the default and usually the right one: above the fold, about
40-80 KB, legible at full size. Reach for `full` (roughly 90-260 KB) only when
section rhythm or page length is the actual question, and `mobile` when the
deliverable is responsive. Captures are cached, so a re-read costs nothing.

## Gotchas

- **Slugs come only from tool output.** `search_screens`, `recommend` and
  `find_similar` return them. A slug you inferred from a domain name exits 1.
- **`tools` is the live schema**, and it prints each argument's accepted
  values. Never guess one: a wrong value is a rejected call, not a fuzzy match.
- **A `budgetNote` on stderr means ranked results were dropped**, weakest
  first, to fit the response budget. Raise `--max-tokens` or narrow the query.
  It never means the archive is thin.

## Boundaries

- `capture-brand` - evidence from one named brand's live site.
- `ui-design-playbook` - making UI look designed once you know what you are building.
- `inspo` - what real production sites look like, before you decide.

The archive is third-party and its capture URLs are undocumented, so `shots`
re-asks the archive whenever a constructed URL 404s. `tests/` pins that
fallback and both error channels: `uv run --with pytest -- pytest tests/ -q`.
The evals in `evals/` are unrouted; run them by hand.
