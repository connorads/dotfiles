---
name: visual-replies
description: Present compact interactive HTML in BB replies with the visual-replies-prototype plugin.
---

# Visual replies

Prefer `composition_reply` for in-chat charts, tables, metrics and adjustable
scenarios that its native catalogue can express. Use this HTML tool for custom
applications, unsupported interactions or an explicit HTML deliverable.

Use `visual_reply_html` with `{html, title}`. Supply self-contained HTML, inline CSS and inline JavaScript.
The title labels the iframe for accessibility. It does not add a visible heading.

The tool returns `{id, path, directive}`. Put the returned directive on its own line in your assistant reply:

```text
::visual-reply{id="<returned UUID>"}
```

BB requires this assistant directive. The tool result does not render HTML directly.
Tools become available at the next agent session start after plugin installation.

## Style contract

- Keep the outer surface transparent. Align content with the reply column.
- Use compact controls with readable labels and visible keyboard focus.
- Avoid dashboard wrappers, redundant headings, nested cards and repeated prose.
- Use one chart that answers the user's question.
- Measure chart width from its container with `ResizeObserver`. Keep chart height fixed in pixels.
- Update the SVG viewBox width to the measured width. Never scale a desktop-width SVG down for mobile.
- Keep chart labels at least 11 screen pixels. Include axis units.
- Use semantic labels, accessible chart descriptions and live text for changing results.
- Test controls and chart labels at mobile and desktop widths.

The sandbox supplies these live BB CSS variables:

```css
--foreground
--muted-foreground
--background
--muted
--primary
--primary-foreground
--border
--ring
--destructive
--font-sans
--font-mono
```

BB font faces are copied into the sandbox. Use `var(--font-sans)` and `var(--font-mono)`.
Theme changes preserve input state. Use CSS variables rather than fixed colours.

## Storage and isolation

The tool writes unique HTML and JSON files under the invoking thread's `visual-replies/` directory.
It uses BB's thread storage host. It does not write workspace files or parent reports.
HTML is limited to 200,000 characters. Titles are limited to 100 characters.

Scripts run inside an opaque-origin iframe. Remote scripts, styles, requests and forms are blocked.
Use inline code and data URLs. No parent DOM access, popups or top navigation is granted.
Height follows content and stops at 1,200 pixels. Larger content scrolls inside the iframe.
Avoid full-viewport layouts and iframe-height-dependent sizing.

## Queue example

Run `bb visual-replies-prototype queue` from a BB thread. Include its returned directive.
The example starts with 12 arrivals/minute, 5 jobs/worker/minute, 2 workers and 60 jobs of backlog.
Three workers clear it in 20 minutes. Four workers clear it in 7.5 minutes.
Balanced capacity cannot clear a positive backlog. No arrivals clear it in 6 minutes with two workers.
