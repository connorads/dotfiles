# Frontend Handoff

Use the kit to build a simple brand-inspired page, not a clone.

## Page shape

Prefer neutral structures:

- Product announcement
- Feature overview
- Internal concept page
- Event or campaign mock
- Documentation-style landing page
- Style tile with components

Avoid trust-sensitive structures:

- Login, checkout, payment, account, support, banking, medical, government, or
  identity verification pages.

## Applying tokens

1. Define CSS variables or project tokens for the curated palette, typography,
   radius, shadows, and spacing.
2. Use the official logo only where the user has supplied it or the context is
   clearly an internal prototype. Otherwise use a text wordmark placeholder and
   record the restriction.
3. Match broad cues: density, contrast, radius, illustration/photo treatment,
   button shape, and type personality.
4. Change content, layout composition, and component details enough that the
   result is recognisably new.
5. Use legal font fallbacks when the brand font is paid or unavailable.

## Existing pages

When restyling an existing user page with a captured kit:

- Preserve the page's content, links, information architecture, and behaviour
  unless the user asks for content edits.
- Swap tokens and assets first, then adjust layout details only where the old
  structure fights the brand.
- Use local curated assets from `assets/`, not raw candidate downloads.
- Watch for sticky headers, full-height flex layouts, and hero imagery causing
  shrinkage or clipping after the brand pass.
- Verify both desktop and mobile screenshots after the restyle.

## Verification

- Render desktop and mobile screenshots.
- Compare against official screenshots or pages for broad fit, not pixel match.
- Check text contrast for primary foreground/background pairs.
- Check images and logos load from local assets or approved remote URLs.
- Confirm no trust-sensitive or exact-copy elements slipped in.
