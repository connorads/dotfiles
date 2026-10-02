`scripts/lint-render.py --all` renders every template at 390px and fails on
page overflow, an unreachable clipped SVG, a missing local scroller, or a
`min-width` that disagrees with the viewBox — including an absent one, which
lets the SVG shrink into the phone and takes the type ramp with it.
