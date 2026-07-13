---
name: capture-brand
description: >-
  Captures a brand kit from a company or product name, domain, URL, website, or
  brand-guidelines link: official source resolution, logos, favicons, social
  images, screenshots, colours, typography, visual style notes, design tokens,
  and a basic on-brand page brief. Use when the user asks to copy, capture,
  match, recreate, clone the vibe of, extract tokens/assets from, or make a
  page feel on-brand from a web link or just a brand name. Not for phishing,
  fake affiliation, counterfeit pages, or exact replicas of protected flows.
---

# Capture Brand

A brand capture is evidence gathering first and design synthesis second. Build
an auditable kit that is enough to create a basic brand-inspired page, without
pretending to be the brand or copying protected product flows.

## Workflow

1. **Resolve the brand.** If the user gave only a name, identify the official
   domain before gathering assets. If the name is ambiguous, ask or present the
   top candidates instead of guessing.
2. **Prefer official evidence.** Use user-provided guidelines/assets first,
   then official brand, media, press, design-system, and website sources. Label
   third-party sources as fallback evidence.
3. **Capture the web surface.** For a URL, run:

   ```bash
   scripts/capture_web_brand.py https://example.com --out brand-capture
   ```

   The script saves raw HTML/CSS, candidate assets, `sources.md`, and
   `tokens.raw.json`. Use it as evidence, not as the final judgement. For
   Wayback or other archive URLs, prefer clean replay URLs such as `if_` for
   screenshots and inspection, and treat normal replay pages as potentially
   contaminated by archive toolbar assets.
4. **Inspect screenshots.** Capture at least desktop and mobile when the final
   deliverable is visual. Note responsive layout patterns and avoid overfitting
   to one viewport.
5. **Normalise the kit.** Convert raw evidence into `tokens.json`,
   `brand-brief.md`, and a local `assets/` set. Keep unreviewed downloads under
   `raw/assets/candidates/`; put only selected, renamed assets in
   `assets/{logos,icons,images,screenshots}`. Cite the source for every major
   colour, font, logo, image, and style claim.
6. **Hand off a page brief.** If the user wants a page recreation, produce a
   neutral brand-inspired layout brief or implementation. Do not copy login,
   payment, account, pricing, checkout, or other trust-sensitive flows.
7. **Verify.** Check files open, sources are traceable, `tokens.json` is valid
   JSON, local asset paths exist, fonts are usable or have fallbacks, and the
   final page reads as inspired by the brand rather than a pixel copy.

## Output Contract

Create or update a `brand-capture/` folder following the layout in
`references/token-schema.md` (Folder contract).

`tokens.json` is the compact handoff file. `brand-brief.md` explains what to
use, what to avoid, confidence levels, and source citations. `verification.md`
records checks run and any remaining unknowns.

Use these confidence labels:

- `confirmed`: observed in official guidelines or current official website
- `likely`: inferred from repeated official evidence
- `fallback`: from third-party source or weak official signal
- `unknown`: not found or too ambiguous to call

## Evidence Rules

- Never rely on memory for current logos, colours, or typography.
- Never treat image search as authoritative.
- Never use a third-party logo when an official current asset is available.
- Keep raw captures separate from the final curated assets.
- Preserve original filenames where useful, but rename curated assets by role
  (`logo-primary.svg`, `favicon-32.png`, `og-image.png`).
- If the brand uses a paid or proprietary font, record it and choose legal
  fallbacks unless the user supplies licensed files.
- If an API or third-party source is useful, check its current docs and terms
  during the task; do not assume cached endpoint behaviour.

## Boundaries

Allowed: mood, palette, typography direction, spacing/radius/elevation cues,
logo placement in neutral contexts, and simple page/component styling.

Constrain or refuse: deceptive clones, fake affiliation, credential capture,
payment/account flows, exact replicas, counterfeit goods, impersonation, and
use of marks in ways that imply endorsement. When the user likely owns the
brand or provides official assets, continue but still keep source notes.

## References

| Need | Read |
|---|---|
| Source priority, ambiguity, third-party services, citation rules | `references/source-priority.md` |
| Token schema and final folder contract | `references/token-schema.md` |
| Trademark, copyright, phishing, and exact-copy boundaries | `references/safety.md` |
| Turning the kit into a basic page without cloning | `references/frontend-handoff.md` |
| Forward-test prompts and expected behaviours | `references/evals.md` |
