# Accessibility — WCAG 2.1 AA

Distilled reference for designing accessible experiences. For the full specification, see [WCAG 2.1 Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/).

---

## Top 10 Rules

These catch ~80% of accessibility issues:

### 1. Semantic HTML

Use the right element for the job. Buttons for actions, links for navigation, headings for structure.

```html
<!-- Not this -->
<div onclick="submit()">Submit</div>

<!-- This -->
<button type="submit">Submit</button>
```

Semantic HTML gives you keyboard support, screen reader announcements, and focus management for free.

### 2. Text Alternatives

Every meaningful image needs descriptive alt text. Decorative images get empty alt.

```html
<img src="chart.png" alt="Sales increased 25% in Q4">
<img src="decorative-line.png" alt="">
```

Icon buttons need labels:
```html
<button aria-label="Close dialog">
  <svg aria-hidden="true"><!-- X icon --></svg>
</button>
```

### 3. Colour Contrast

| Element | Minimum ratio |
|---------|--------------|
| Normal text (<18px) | 4.5:1 |
| Large text (≥18px or ≥14px bold) | 3:1 |
| UI components & graphics | 3:1 |

**Check with:**
```bash
python scripts/contrast-check.py #333333 #ffffff
```

**Common failures:**
- `#999` on `#fff` = 2.85:1 (FAIL)
- `#767676` on `#fff` = 4.54:1 (PASS — lightest grey that passes)
- `#333` on `#fff` = 12.63:1 (PASS — comfortable margin)

### 4. Keyboard Access

All functionality must be keyboard accessible. Tab to navigate, Enter/Space to activate, Escape to dismiss.

- Use native elements (`<button>`, `<a>`, `<input>`)
- `tabindex="0"` for custom interactive elements
- `tabindex="-1"` for programmatic focus only
- Never use positive tabindex values

### 5. Visible Focus Indicators

Users must see where keyboard focus is. Never remove focus outlines without providing an alternative.

```css
:focus {
  outline: 2px solid #0066CC;
  outline-offset: 2px;
}

/* If customising, ensure visibility */
:focus-visible {
  outline: 2px solid #0066CC;
  outline-offset: 2px;
  box-shadow: 0 0 0 3px rgba(0, 102, 204, 0.2);
}
```

### 6. Form Labels

Every input needs a visible, associated label. Placeholder text is not a label.

```html
<label for="email">Email address</label>
<input type="email" id="email" name="email">
```

Group related inputs with `<fieldset>` and `<legend>`:
```html
<fieldset>
  <legend>Shipping address</legend>
  <!-- Address fields -->
</fieldset>
```

### 7. Heading Hierarchy

Use headings in order (h1 → h2 → h3). Don't skip levels. One h1 per page.

Screen reader users navigate by headings — they're the primary navigation mechanism for assistive technology.

### 8. ARIA (When Needed)

Use ARIA only when semantic HTML isn't sufficient. First rule of ARIA: don't use ARIA if you can use native HTML.

**Common ARIA attributes:**
- `aria-label`: Names an element when visible text isn't sufficient
- `aria-describedby`: Associates descriptive text with an element
- `aria-expanded`: Indicates whether a collapsible section is open
- `aria-live="polite"`: Announces dynamic content updates
- `role="alert"`: Announces urgent messages immediately
- `aria-invalid="true"`: Marks a form field with an error

### 9. Error Messages

Errors must be: identified in text, described clearly, and announced to assistive technology.

```html
<input type="email"
       id="email"
       aria-invalid="true"
       aria-describedby="email-error">
<div id="email-error" role="alert">
  Enter a valid email address (e.g., name@example.com)
</div>
```

Don't rely on colour alone — use icons, text, and borders together.

### 10. Test with Keyboard and Screen Reader

No automated tool catches everything. At minimum:
- Tab through the entire page
- Verify logical focus order
- Check all interactive elements work with Enter/Space
- Test with VoiceOver (Mac: Cmd+F5) or NVDA (Windows)

---

## Keyboard Navigation Checklist

```
[ ] Tab reaches all interactive elements
[ ] Tab order matches visual order
[ ] Enter/Space activates buttons and links
[ ] Escape closes modals, dropdowns, popovers
[ ] Arrow keys navigate within widgets (tabs, menus, radio groups)
[ ] No keyboard traps (can always Tab away)
[ ] Focus visible on every interactive element
[ ] Focus moves into modal on open
[ ] Focus returns to trigger on modal close
[ ] Skip link available ("Skip to main content")
```

---

## Modals and Focus Management

When a modal opens:
1. Save the triggering element
2. Move focus to the first focusable element inside the modal
3. Trap Tab within the modal (wrap from last to first element)
4. Close on Escape
5. Return focus to the triggering element on close
6. Prevent background scroll

```html
<div role="dialog"
     aria-modal="true"
     aria-labelledby="dialog-title">
  <h2 id="dialog-title">Confirm action</h2>
  <!-- content -->
  <button>Cancel</button>
  <button>Confirm</button>
</div>
```

---

## Dynamic Content

Content that updates without page reload must be announced:

```html
<!-- Polite: announced at next pause (status updates, loading) -->
<div role="status" aria-live="polite">
  Your changes have been saved.
</div>

<!-- Assertive: announced immediately (errors, warnings) -->
<div role="alert" aria-live="assertive">
  Connection lost. Retrying...
</div>

<!-- Loading state -->
<div role="status" aria-live="polite" aria-busy="true">
  Loading results...
</div>
```

---

## Colour and Visual

**Don't use colour as the only indicator:**
```
Bad:  "Fields in red are required"
Good: "Required fields are marked with * (asterisk)"
```

**Support both orientations** — don't lock to portrait/landscape.

**Resizable text** — content must work at 200% zoom without horizontal scrolling (at 320px width for vertical content).

**Text spacing** — no content loss when users adjust:
- Line height: 1.5× font size
- Paragraph spacing: 2× font size
- Letter spacing: 0.12× font size
- Word spacing: 0.16× font size

---

## Common Violations Quick Fixes

| Violation | Fix |
|-----------|-----|
| `<div onclick>` instead of button | Use `<button>` |
| Placeholder as only label | Add `<label>` element |
| Image without alt | Add descriptive `alt` or `alt=""` if decorative |
| `outline: none` without replacement | Add visible focus style |
| Icon button without text | Add `aria-label` |
| Colour-only error indication | Add icon + text |
| Missing page `<title>` | Add descriptive `<title>` |
| Missing `lang` attribute | Add `<html lang="en">` |
| Auto-playing media | Provide pause/stop control |
| Time limits without extension | Allow user to extend or disable |

---

## Testing Quick Reference

**Automated (catches ~30% of issues):**
- axe DevTools browser extension
- Lighthouse (Chrome DevTools → Audits)

**Manual (catches the rest):**
- Keyboard navigation test (Tab through everything)
- Screen reader test (VoiceOver on Mac: Cmd+F5)
- Zoom to 200% test
- Colour contrast check

**In code:**
```bash
# Contrast check
python scripts/contrast-check.py #hex1 #hex2
```

---

## POUR Principles Summary

| Principle | Question | Key checks |
|-----------|----------|------------|
| **Perceivable** | Can users perceive all content? | Alt text, contrast, captions, no colour-only info |
| **Operable** | Can users operate all controls? | Keyboard access, focus indicators, no traps, sufficient time |
| **Understandable** | Can users understand the interface? | Clear labels, error messages, consistent navigation, page language |
| **Robust** | Does it work with assistive tech? | Valid HTML, ARIA usage, status messages, proper roles |
