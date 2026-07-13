# ARIA Patterns Reference

## Contents

- The Accessible Name Computation
- Labelling Techniques
  - aria-label (string directly on element)
  - aria-labelledby (points to visible text)
  - aria-describedby (supplementary description)
  - Labelling groups with fieldset/legend
- ARIA Roles
  - Landmark Roles (navigation regions)
  - Widget Roles (interactive elements)
- ARIA States and Properties
  - Dynamic states (change at runtime)
  - Relationship properties
  - Toggle button pattern
- Live Regions
  - Choosing the right pattern
  - Implementation rules
  - When NOT to use live regions
- Complex Widget Patterns
  - Tabs (ARIA tab pattern)
  - Menu Button pattern
  - Accordion
- aria-hidden Pitfalls

ARIA (Accessible Rich Internet Applications) exposes semantics to assistive technologies when native HTML doesn't provide them. The golden rule: **no ARIA is better than bad ARIA**. Native HTML is always preferred.

---

## The Accessible Name Computation

Screen readers compute a control's accessible name using this priority order (highest wins), per the [Accessible Name and Description Computation](https://www.w3.org/TR/accname-1.2/):

1. `aria-labelledby` (references another element's text)
2. `aria-label` (inline string)
3. Native markup for the element type — a form control's associated `<label>`, an image's `alt`, or *name from content* (a button's or link's own text)
4. `title` attribute (tooltip — last-resort fallback; inconsistent support)
5. `placeholder` attribute (last resort, form fields only; never a substitute for a label — disappears on input)

The exact native source at step 3 is element-dependent, but `title` then `placeholder` are always the final fallbacks: if anything higher supplies a name, they are ignored.

> Strictly, steps 1–4 follow [accname-1.2](https://www.w3.org/TR/accname-1.2/); `placeholder`-as-name is an input-only fallback defined by [HTML-AAM](https://www.w3.org/TR/html-aam-1.0/), not a step in the accname computation itself. Either way it is a last resort — never a substitute for a `<label>`.

**Accessible description** (supplementary, announced after the name) comes from `aria-describedby`.

```html
<!-- Name: "Email address" | Description: "We'll never share your email" -->
<label for="email">Email address</label>
<input id="email"
       aria-describedby="email-hint"
       type="email" />
<span id="email-hint">We'll never share your email with anyone.</span>
```

---

## Labelling Techniques

### aria-label (string directly on element)

Use when no visible label exists or the visible label is insufficient.

```html
<button aria-label="Close dialog">✕</button>
<nav aria-label="Main navigation">...</nav>
<section aria-label="Recommended products">...</section>
```

**Caveat:** `aria-label` is not translated by automated tools. For multilingual sites, prefer `aria-labelledby` pointing to visible translated text.

### aria-labelledby (points to visible text)

Use when the label already exists visually elsewhere on the page.

```html
<h2 id="products-heading">Products</h2>
<ul aria-labelledby="products-heading">...</ul>

<!-- Composing a name from multiple elements -->
<span id="first">John</span> <span id="last">Smith</span>
<button aria-labelledby="first last">Profile</button>
<!-- Announced: "John Smith, button" -->
```

### aria-describedby (supplementary description)

Announced after the name, typically on focus. Use for: hints, error messages, format instructions.

```html
<input id="pw"
       type="password"
       aria-describedby="pw-requirements"
       aria-invalid="false" />
<p id="pw-requirements">
  Must be 8+ characters with a number and symbol.
</p>
```

### Labelling groups with fieldset/legend

Always use for radio groups and checkbox groups.

```html
<fieldset>
  <legend>Notification preferences</legend>
  <label><input type="radio" name="notify" value="email" /> Email</label>
  <label><input type="radio" name="notify" value="sms" /> SMS</label>
  <label><input type="radio" name="notify" value="none" /> None</label>
</fieldset>
<!-- Each radio announced: "Email, radio button, 1 of 3, Notification preferences, group" -->
```

---

## ARIA Roles

### Landmark Roles (navigation regions)

| HTML Element | Implicit ARIA Role | Use For |
|---|---|---|
| `<header>` | `banner` | Site-level header (once per page) |
| `<nav>` | `navigation` | Navigation regions |
| `<main>` | `main` | Primary page content (once per page) |
| `<footer>` | `contentinfo` | Site-level footer |
| `<aside>` | `complementary` | Related but non-essential content |
| `<section>` with accessible name | `region` | Named content region |
| `<form>` with accessible name | `form` | Form region |
| `<search>` | `search` | Search landmark (HTML 5.x) |

Multiple `<nav>` elements must be distinguished with `aria-label`:

```html
<nav aria-label="Main">...</nav>
<nav aria-label="Footer">...</nav>
```

### Widget Roles (interactive elements)

Only use when native HTML doesn't provide the semantics. All widget roles require keyboard handling.

**`role="button"`** — use only when you cannot use `<button>`.

```html
<div role="button" tabindex="0"
     onkeydown="if(event.key==='Enter'||event.key===' ') activate(event)">
  Save
</div>
```

Better: just use `<button>`.

**`role="checkbox"` (custom)**

```html
<div role="checkbox"
     aria-checked="false"
     tabindex="0"
     aria-labelledby="tos-label">
</div>
<span id="tos-label">Accept terms of service</span>
```

Keyboard: `Space` toggles `aria-checked`. `Enter` is not required but common.

**`role="switch"`** — for boolean toggles (on/off semantics, not checked/unchecked)

```html
<button role="switch" aria-checked="true">Dark mode</button>
```

**`role="combobox"`** — autocomplete/select widget (complex — see ARIA APG)

**`role="dialog"`** — modal overlay

```html
<div role="dialog"
     aria-modal="true"
     aria-labelledby="dialog-title">
  <h2 id="dialog-title">Confirm deletion</h2>
  ...
</div>
```

`aria-modal="true"` tells screen readers to restrict reading to the dialog. Still implement JS focus trap — `aria-modal` alone is insufficient.

**`role="alertdialog"`** — modal requiring immediate response (confirm/deny)

**`role="alert"`** — implicit `aria-live="assertive"`. Use for errors and urgent messages.

```html
<div role="alert">Your session is about to expire. Save your work.</div>
```

**`role="status"`** — implicit `aria-live="polite"`. Use for success messages, counts.

```html
<div role="status">File uploaded successfully.</div>
```

---

## ARIA States and Properties

### Dynamic states (change at runtime)

| Attribute | Values | Use When |
|---|---|---|
| `aria-expanded` | `true` / `false` | Toggle buttons controlling collapsible regions |
| `aria-selected` | `true` / `false` | Active tab, selected option in listbox |
| `aria-checked` | `true` / `false` / `mixed` | Custom checkboxes, switches |
| `aria-pressed` | `true` / `false` | Toggle buttons |
| `aria-disabled` | `true` / `false` | Non-interactive elements (prefer HTML `disabled` on form controls) |
| `aria-invalid` | `true` / `false` / `grammar` / `spelling` | Form field with validation error |
| `aria-busy` | `true` / `false` | Loading states (partial support — pair with live region) |
| `aria-hidden` | `true` | Remove from accessibility tree entirely |

### Relationship properties

| Attribute | Purpose |
|---|---|
| `aria-controls` | Identifies element controlled by this one (e.g., toggle → panel) |
| `aria-owns` | Declares parent-child relationship not in DOM order |
| `aria-haspopup` | Indicates a popup (menu, listbox, tree, grid, dialog) will appear |

### Toggle button pattern

```html
<button aria-expanded="false" aria-controls="nav-menu">
  Menu
</button>
<ul id="nav-menu" hidden>
  <li><a href="/">Home</a></li>
  <li><a href="/about">About</a></li>
</ul>

<script>
  btn.addEventListener('click', () => {
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', !expanded);
    menu.hidden = expanded;
  });
</script>
```

---

## Live Regions

Live regions announce changes to screen readers without moving focus. Use sparingly — overuse causes noise.

### Choosing the right pattern

| Scenario | Pattern | Urgency |
|---|---|---|
| Success toast ("Saved") | `role="status"` or `aria-live="polite"` | Low |
| Cart count update | `aria-live="polite"` + `aria-atomic="true"` | Low |
| Search result count | `aria-live="polite"` | Low |
| Error after form submit | `role="alert"` or `aria-live="assertive"` | High |
| Session timeout warning | `role="alertdialog"` (dialog, not live region) | High |
| Constantly updating ticker | Move focus, or provide separate "summary" button | Avoid live region |

### Implementation rules

1. **Live regions must be in the DOM on page load** — inject text *into* them, not the region itself
2. **Start empty** — if pre-populated, the initial content won't be announced
3. **Register before populating** — if you inject the region dynamically, insert it *empty* first, then set its text in a separate step (a later tick / next frame is enough) so the AT registers it before the change. Better: ship the empty region in the initial HTML (rule 1) and avoid the problem
4. **Keep messages concise** — they're announced once and cannot be replayed
5. **`aria-atomic="true"`** — announces the entire region content, not just the changed part (use for counts: "4 items in cart" not just "4")

```html
<!-- In HTML on page load — always empty initially -->
<div id="status-live" role="status" aria-live="polite" aria-atomic="true"></div>
<div id="error-live" role="alert" aria-live="assertive" aria-atomic="true"></div>

<!-- In JS — inject text to trigger announcement -->
document.getElementById('status-live').textContent = '3 items in cart';

// To re-trigger the same message (clear first):
statusEl.textContent = '';
requestAnimationFrame(() => { statusEl.textContent = '3 items in cart'; });
```

### When NOT to use live regions

- **Focus moves to the new content** — moving focus is already an announcement
- **Modal opens** — focus trap + role="dialog" handles this
- **Page navigates** — document title change + focus to `<main>` or `<h1>` announces it
- **Inline form errors** — `aria-describedby` + `aria-invalid` on the field is sufficient; the error is read when the field receives focus. Use `role="alert"` only for a summary error region at the top of a form.

---

## Complex Widget Patterns

For complex interactive widgets, follow the **ARIA Authoring Practices Guide** (APG) patterns exactly. Partial ARIA implementation is worse than none.

### Tabs (ARIA tab pattern)

```html
<div role="tablist" aria-label="Account sections">
  <button role="tab" aria-selected="true" aria-controls="profile-panel" id="profile-tab">Profile</button>
  <button role="tab" aria-selected="false" aria-controls="billing-panel" id="billing-tab" tabindex="-1">Billing</button>
</div>
<!-- tabindex="0" only when the panel has no focusable content of its own -->
<div role="tabpanel" id="profile-panel" aria-labelledby="profile-tab" tabindex="0">...</div>
<div role="tabpanel" id="billing-panel" aria-labelledby="billing-tab" hidden>...</div>
```

Keyboard:

- `Tab` enters the tab list; **arrow keys** move between tabs (not `Tab`); `Home`/`End` jump to the first/last tab.
- `Tab` then moves focus *out* of the tab list to the next focusable element — the tabpanel only if it (or its first content) is focusable. Give the panel `tabindex="0"` when it has **no** focusable content, so it isn't skipped.
- **Activation:** *automatic* (selecting a tab on arrow shows its panel immediately) suits cheap panels; *manual* (arrow moves focus, `Enter`/`Space` activates) suits panels that are expensive to render.

### Menu Button pattern

Use `role="menu"`/`menuitem` **only for application-style action menus** — a list of commands like Edit / Delete / Duplicate. It commits you to the full APG keyboard model below; a partial implementation is worse than none.

```html
<button aria-haspopup="menu" aria-expanded="false" id="actions-btn">
  Actions ▾
</button>
<ul role="menu" aria-labelledby="actions-btn" hidden>
  <li role="menuitem" tabindex="-1">Edit</li>
  <li role="menuitem" tabindex="-1">Delete</li>
</ul>
```

Keyboard:

- **On the button:** `Enter`/`Space` opens the menu and moves focus to the first item. `Down` opens and focuses the first item; `Up` opens and focuses the last item (both optional per APG).
- **In the menu:** arrow keys move focus between items via a **roving tabindex** — the focused `menuitem` has `tabindex="0"` (all others `-1`) and receives `.focus()`; or use `aria-activedescendant`. `Home`/`End` jump to first/last. First-letter type-ahead is optional. `Escape` closes and returns focus to the button.

> **Do not use `role="menu"`/`menuitem` for site navigation** — a dropdown of links (Home, About, Products). That is a *disclosure*, not a menu: a `<button aria-expanded>` toggling a `<ul>` of `<a>` inside `<nav>` (the [Toggle button pattern](#toggle-button-pattern) above), with **no** menu roles. Menu roles suppress link semantics and mislead screen reader users into expecting application-menu keyboard behaviour. ([Roselli: Don't Use ARIA Menu Roles for Site Nav](https://adrianroselli.com/2017/10/dont-use-aria-menu-roles-for-site-nav.html))

### Accordion

```html
<h3>
  <button aria-expanded="false" aria-controls="section1-body">
    Section 1
  </button>
</h3>
<div id="section1-body" hidden>
  Content
</div>
```

No custom ARIA role needed — the `<button>` inside a heading is sufficient.

---

## aria-hidden Pitfalls

`aria-hidden="true"` removes the element and all descendants from the accessibility tree.

**Never apply to:**

- Focusable elements (`<button>`, `<a>`, `<input>`) — keyboard focus will land there with no announcement
- The currently focused element
- Parents of focusable elements

**Correct uses:**

```html
<!-- Decorative icon -->
<button>Delete <svg aria-hidden="true">...</svg></button>

<!-- Decorative separator -->
<hr aria-hidden="true" />
```

**Hiding modal background:**
Neutralise the background behind an open modal with the `inert` attribute (or the native `<dialog>` element's `showModal()`, which makes the rest of the page inert for you), **not** bare `aria-hidden`. `aria-hidden` removes content from the accessibility tree but leaves it keyboard-focusable, so Tab can still land in "hidden" content; `inert` blocks focus, the a11y tree, and find-in-page together. See references/focus-management.md. Remove `inert` when the modal closes.
