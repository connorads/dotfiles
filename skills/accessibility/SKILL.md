---
name: accessibility
description: >
  Audit, implement, and fix web accessibility with a screen-reader-first lens.
  Use when building or reviewing UI components, forms, dialogs, navigation,
  dynamic content, or any interactive element. Covers WCAG 2.2 AA compliance,
  ARIA patterns, keyboard navigation, focus management, and assistive technology
  compatibility (NVDA, JAWS, VoiceOver). Trigger on: "accessible", "a11y",
  "screen reader", "WCAG", "ARIA", or when adding any interactive UI.
---

# Accessibility

Web accessibility done right means your UI is navigable, understandable, and operable by people with disabilities — screen reader users, keyboard-only users, and people with low vision, motor, or cognitive impairments. This skill takes a **screen-reader-first lens** because it surfaces structural failures fastest, but low-vision users (contrast, zoom, reflow) and cognitive users matter just as much — in fact low-contrast text is the single most common barrier on the web, affecting ~84% of home pages. The [WebAIM Million](https://webaim.org/projects/million/) consistently finds ~96% of home pages carry detectable WCAG failures, and just six issue types — low-contrast text, missing alt text, missing form labels, empty links, empty buttons, and missing document language — account for ~96% of all detected failures and have topped the list for seven years running. Most are preventable with the right mental model.

## The Core Mental Model

Screen readers **linearise** a 2D page into a 1D audio stream. A blind user never sees the whole page at once — they navigate sequentially by **headings**, **landmarks**, **form fields**, **links**, and **interactive controls** using keyboard shortcuts. Every decision you make should answer: *"What will a screen reader announce, and does it make sense in isolation?"*

The three rules that flow from this:

1. **Semantics over style** — use native HTML elements (`<button>`, `<nav>`, `<h2>`) before reaching for ARIA. Native elements come with free keyboard support, accessible names, and correct roles.
2. **Context must travel with the element** — a screen reader user navigating by tab or by links list sees elements stripped of their visual neighbours. Labels, descriptions, and states must be programmatically attached, not implied by proximity.
3. **Dynamic changes must be announced** — screen readers only notice changes if focus moves to new content or a live region announces it. Silent DOM mutations are invisible to AT.

---

## When Auditing Existing UI

Review in this priority order — fix critical issues before polishing low-impact ones:

| Priority | Category | WCAG Level | See |
|----------|----------|------------|-----|
| 1 | Accessible names (buttons, inputs, links) | A | references/aria-patterns.md |
| 2 | Keyboard operability (all interactive elements) | A | references/focus-management.md |
| 3 | Focus management (dialogs, SPAs, live regions) | A/AA | references/focus-management.md |
| 4 | Semantic structure (headings, landmarks, lists) | A | references/wcag-checklist.md |
| 5 | Form errors and validation | A/AA | references/common-fixes.md |
| 6 | Colour contrast and visual states | AA | references/wcag-checklist.md |
| 7 | Dynamic content announcements | AA | references/aria-patterns.md |
| 8 | Images and media | A | references/wcag-checklist.md |
| 9 | Motion, flashing, and timing (reduced-motion, seizure safety, auto-updating content) | A/AA | references/wcag-checklist.md |

Quote the exact failing snippet, name the WCAG criterion, and propose the smallest viable fix. Do not refactor unrelated code.

---

## When Building New UI

### The quick decision tree

```text
Need an interactive control?
  ↓
Does a native HTML element do this?  → YES → Use it. Done.
  ↓ NO
Use the correct ARIA role + required attributes + keyboard handler.

Adding dynamic content?
  ↓
Does focus move to the new content? → YES → No live region needed.
  ↓ NO
Is it a transient status (toast, cart count, form error)?
  → Use aria-live="polite" (or role="alert" for errors)

Opening a dialog/modal?
  → Trap focus inside. Restore focus to trigger on close.
  → See references/focus-management.md
```

### Mandatory checks before shipping any interactive component

- [ ] Every input, select, textarea has an associated `<label>` (not just placeholder)
- [ ] Every button has an accessible name (text content, `aria-label`, or `aria-labelledby`)
- [ ] Every icon-only control has `aria-label`; the icon has `aria-hidden="true"`
- [ ] Focus is visible on all interactive elements (never `outline: none` without a replacement)
- [ ] Tab order is logical and matches visual order
- [ ] All pointer interactions have a keyboard equivalent
- [ ] No `tabindex` greater than 0
- [ ] Interactive targets are at least 24×24 CSS px, or spaced apart (WCAG 2.5.8)
- [ ] Non-essential motion respects `prefers-reduced-motion`; nothing flashes more than three times per second (WCAG 2.3.1)

---

## Five High-Impact Screen-Reader Failures (and their fixes)

These are the failures you will hit most through this skill's screen-reader lens. (The highest-*volume* failures site-wide — low-contrast text, missing alt — are covered under Colour and Contrast and Images below.)

### 1. Icon-only button with no accessible name

```html
<!-- ❌ Screen reader announces: "button" -->
<button><svg>...</svg></button>

<!-- ✅ Screen reader announces: "Close, button" -->
<button aria-label="Close"><svg aria-hidden="true">...</svg></button>
```

### 2. Input with no label

```html
<!-- ❌ Screen reader announces: "edit text" -->
<input type="email" placeholder="Email" />

<!-- ✅ Screen reader announces: "Email address, edit text" -->
<label for="email">Email address</label>
<input id="email" type="email" />
```

### 3. div or span used as a button

```html
<!-- ❌ Not keyboard accessible, no role announced -->
<div onclick="save()">Save</div>

<!-- ✅ Free keyboard support, correct role -->
<button onclick="save()">Save</button>
```

### 4. Form error not linked to field

```html
<!-- ❌ Error visible but not associated with the field -->
<input id="email" type="email" />
<span>Please enter a valid email</span>

<!-- ✅ Screen reader announces error when field is focused -->
<input id="email" type="email"
       aria-describedby="email-err"
       aria-invalid="true" />
<span id="email-err" role="alert">Please enter a valid email</span>
```

### 5. Dynamic content updated silently

```html
<!-- ❌ Cart count updates, screen reader users never know -->
<span id="cart-count">3</span>

<!-- ✅ Announces "4 items in cart" when count changes -->
<span id="cart-count" aria-live="polite" aria-atomic="true">4 items in cart</span>
```

---

## Screen Reader Testing

Automated tools catch ~30–40% of accessibility issues. The rest require AT testing.

**Minimum viable test matrix:**

- NVDA + Firefox or Chrome (Windows) — free, strict, and one of the two most-used desktop readers
- VoiceOver + Safari (macOS/iOS) — the dominant reader across Apple platforms
- JAWS + Chrome for enterprise contexts — the other leading desktop reader

**Core navigation patterns to test manually:**

1. Tab through all interactive elements — are names and roles announced correctly?
2. Press `H` to navigate by headings — is the page structure logical?
3. Press `D` to navigate by landmarks — are regions clearly labelled?
4. Open and close any dialogs — does focus trap, then restore?
5. Submit a form with errors — are error messages announced?
6. Trigger any dynamic content update — is the change announced?

See **references/screen-readers.md** for NVDA/JAWS/VoiceOver commands, browse vs. forms mode, and testing scripts.

---

## ARIA: The Rules

**Rule 0:** Don't use ARIA if native HTML solves it. Bad ARIA is worse than no ARIA.

**Rule 1:** `aria-label` and `aria-labelledby` provide the accessible name (what the element *is*).
**Rule 2:** `aria-describedby` provides supplementary description (what it *does* or *needs*).
**Rule 3:** `aria-live="polite"` for non-urgent updates; `role="alert"` (implicit `assertive`) for errors.
**Rule 4:** Live regions must exist in the DOM on page load — inject text into them, don't inject the region itself.
**Rule 5:** `aria-hidden="true"` removes from the AT tree completely. Never apply to focusable elements.

Full ARIA pattern library → **references/aria-patterns.md**

---

## Visually Hidden Content

To show content to screen readers but hide it visually:

```css
.visually-hidden:not(:focus):not(:active) {
  clip-path: inset(50%);
  height: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}
```

Use for: skip links, supplementary link context ("Read more <span class="visually-hidden">about caching</span>"), icon button labels when `aria-label` is impractical for translation reasons.

Do **not** use for: content that sighted users need. Hiding meaningful content from one group creates disparity, not accessibility.

---

## Colour and Contrast (WCAG AA)

| Content type | Minimum ratio |
|---|---|
| Body text (<18pt / 24px, and <14pt bold / 18.5px) | 4.5:1 |
| Large text (≥18pt / 24px, or ≥14pt bold / 18.5px) | 3:1 |
| UI components (borders, icons, focus rings) | 3:1 |
| Placeholder text | 4.5:1 |
| Disabled elements | Exempt |

Never convey information by colour alone — always pair with a shape, pattern, or text label.

Respect user colour preferences: support `prefers-color-scheme`, and test under Windows High Contrast / `forced-colors: active` rather than overriding it (never `forced-colors-adjust: none` on meaningful content). See references/wcag-checklist.md.

Check exact foreground/background pairs from the `accessibility` skill
directory:

```bash
python scripts/contrast-check.py '#333333' '#ffffff'
python scripts/contrast-check.py '#767676' '#ffffff' --json
python scripts/contrast-check.py '#949494' '#ffffff' --target large-text
python scripts/contrast-check.py '#949494' '#ffffff' --target ui-component
```

Use `--target normal-text` (default), `large-text`, `ui-component`,
`aaa-normal-text`, or `aaa-large-text` to make the exit status follow the
relevant threshold. Do not round contrast values up. A measured `4.499:1` fails
a `4.5:1` requirement.

**WCAG 2 AA (this table) is the sole conformance target.** Its ratio maths is symmetric and ignores polarity, so it can over-rate some dark-mode pairings — if a passing pair still reads poorly on dark backgrounds, treat that as a design smell and sanity-check it with a perceptual tool (APCA). APCA is a candidate algorithm for the still-draft, undated [WCAG 3](https://www.w3.org/TR/wcag-3.0/) (it was even pulled from the July 2023 draft pending consensus) — a design aid only, never a compliance substitute.

---

## Reference Files

| File | Contents |
|------|----------|
| **references/screen-readers.md** | NVDA/JAWS/VoiceOver commands, browse vs. forms mode, testing scripts per component type |
| **references/aria-patterns.md** | ARIA roles, labelling hierarchy, live region patterns, complex widget ARIA (combobox, tabs, tree) |
| **references/focus-management.md** | Modal focus trap, SPA route change focus, skip links, focus restoration patterns |
| **references/wcag-checklist.md** | WCAG 2.2 AA criterion-by-criterion checklist with pass/fail examples |
| **references/common-fixes.md** | Code-level fix templates for the 20 most common audit findings |
| **scripts/contrast-check.py** | Deterministic WCAG contrast ratio checker for foreground/background hex pairs |
