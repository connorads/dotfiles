# Source Priority

Use the strongest current evidence available. A brand name alone is not enough
to identify a brand.

## Priority order

1. User-provided brand guidelines, press kit, design tokens, logos, or font
   files.
2. Official brand, media, newsroom, press, design-system, or developer pages on
   the brand's own domain.
3. Current official website assets: CSS, web app manifest, favicon, Apple touch
   icon, mask icon, Open Graph and Twitter images, screenshots, and structured
   metadata.
4. Official app-store listings and verified social profiles, used only to
   confirm identity or fill weak gaps.
5. Third-party services and repositories, clearly labelled as fallback evidence.

## Archived official pages

Use archived official-domain pages when the current official site is unavailable
or the user explicitly supplies an archive URL. Record the archive URL,
timestamp when visible, resolved replay URL, and original target URL.

For Wayback captures:

- Prefer clean replay forms such as `if_` for screenshots and visual
  inspection.
- Treat normal replay pages as potentially toolbar-contaminated.
- Ignore toolbar/static assets from `web-static.archive.org/_static/` or
  equivalent archive chrome.
- Mark evidence as `likely` unless it is corroborated by current official
  guidelines, current official assets, or a user-provided source.

Do not let archive chrome influence colours, typography, spacing, screenshots,
or logo candidates.

## Brand name resolution

For a bare name:

- Search the web for the brand's official domain.
- Confirm with at least two signals when possible: official site title,
  knowledge panel/company page, verified social profile, app-store listing, or
  official press page.
- For ambiguous names, stop before capture and ask which brand/domain the user
  means. If asking is impractical, present candidates and mark the run blocked
  on identity.
- Distinguish product, parent company, campaign, and regional brand. Capture the
  one the user actually requested.

## Website evidence

Good website signals:

- CSS variables and repeated CSS values for colour, type, radius, elevation, and
  spacing.
- `font-family` declarations and web font stylesheets.
- `theme-color`, manifest `theme_color` / `background_color`, and manifest
  icons.
- `rel=icon`, `apple-touch-icon`, `mask-icon`, and SVG wordmarks in navigation
  or footer.
- `og:image`, `twitter:image`, title, description, and canonical URL.
- Schema.org / JSON-LD `logo` and `image` fields.
- Screenshots at desktop and mobile widths.

Weak signals:

- A single sampled screenshot colour.
- Old blog assets or campaign microsites.
- Archived official pages that are not corroborated by current official
  sources.
- Archive toolbar assets, replay CSS, or third-party logos embedded in a page.
- Unofficial image-search logos.
- Third-party icon repositories with stale source links.

## Third-party sources

Use third-party services only after checking current docs and terms during the
task. Useful categories include brand-data APIs, logo APIs, favicon services,
and open brand icon repositories. Record the source URL, access date, and why an
official source was insufficient.

Do not hard-code service behaviour into the final kit. Treat a third-party
result as a candidate to verify against official evidence.

Current useful fallback categories:

- Brand-data APIs for logos, colours, fonts, and company metadata.
- Domain-to-logo APIs when only a logo is needed.
- Open brand icon repositories for common monochrome icons and published brand
  hex values.
- Favicon services for low-confidence icon fallback.
- Scraping/metadata APIs for screenshots and page metadata when local capture
  is blocked.

Do not rely on retired or undocumented favicon/logo endpoints. If a service is
deprecated, archived, or only documented through community posts, skip it unless
the user explicitly asks for that provider.

## Citations

Every major item in `tokens.json` should carry a source:

- Colours: CSS file, guideline page, manifest field, or sampled official image.
- Typography: CSS declaration, font stylesheet, guideline page, or supplied font
  file.
- Logos and icons: official asset URL or page where found.
- Imagery style: screenshot or official gallery/page.
- Voice/style claims: observed copy from official pages or guideline text.

Use `confirmed`, `likely`, `fallback`, and `unknown` confidence labels
consistently.
