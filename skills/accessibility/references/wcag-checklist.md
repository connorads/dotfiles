# WCAG 2.2 AA Checklist

## Contents

- Perceivable
  - 1.1 Text Alternatives
  - 1.2 Time-based Media
  - 1.3 Adaptable
  - 1.4 Distinguishable
- Operable
  - 2.1 Keyboard Accessible
  - 2.2 Enough Time
  - 2.3 Seizures and Physical Reactions
  - 2.4 Navigable
  - 2.5 Input Modalities
- Understandable
  - 3.1 Readable
  - 3.2 Predictable
  - 3.3 Input Assistance
- Robust
  - 4.1 Compatible
- Testing Order by Impact

Criterion-by-criterion reference for WCAG 2.2 Level A and AA. Level AAA included where commonly implemented. Focus is on practical pass/fail examples, not abstract definitions.

Conformance target for most projects: **WCAG 2.2 AA**. It underpins the common legal baselines — ADA, Section 508 (US federal), and the European Accessibility Act. WCAG 2.2 has no **4.1.1 Parsing** criterion (markup parsing is handled by modern browsers and AT); disregard audit findings that cite it.

---

## Perceivable

### 1.1 Text Alternatives

**1.1.1 Non-text Content (A)**
All non-text content must have a text alternative.

```html
<!-- ✅ Informative image -->
<img src="chart.png" alt="Bar chart: Q2 revenue up 25% vs Q1" />

<!-- ✅ Decorative image -->
<img src="divider.png" alt="" role="presentation" />

<!-- ✅ Icon with function -->
<button><img src="search.png" alt="Search" /></button>

<!-- ✅ SVG icon — hide SVG, label the button -->
<button aria-label="Search">
  <svg aria-hidden="true" focusable="false">...</svg>
</button>

<!-- ❌ Missing alt -->
<img src="product.jpg" />

<!-- ❌ Filename as alt -->
<img src="product.jpg" alt="product.jpg" />

<!-- ❌ "image of" / "photo of" — redundant -->
<img src="dog.jpg" alt="Photo of a dog" />
```

Alt text should convey the **purpose and meaning**, not describe the picture literally. "Bar chart showing Q2 revenue" is better than "A chart with blue and orange bars."

---

### 1.2 Time-based Media

#### 1.2.1 Audio-only and Video-only (A)

- Pre-recorded audio: provide a text transcript
- Pre-recorded video (no audio): provide audio description or text equivalent

**1.2.2 Captions — Pre-recorded (A)**
All pre-recorded video with audio must have synchronised captions. Auto-generated captions alone (YouTube, etc.) are insufficient — they must be reviewed for accuracy.

**1.2.3 Audio Description (A)**
Pre-recorded video must have audio description or a text alternative where visual content conveys information not in the audio track.

**1.2.4 Captions — Live (AA)**
Live synchronised media (webinars, live streams) with audio must have real-time captions.

**1.2.5 Audio Description (AA)**
All pre-recorded video must have audio description (same as 1.2.3, stricter).

---

### 1.3 Adaptable

**1.3.1 Info and Relationships (A)**
Structure and meaning must be programmatically determinable.

```html
<!-- ✅ Heading hierarchy -->
<h1>Page title</h1>
  <h2>Section</h2>
    <h3>Subsection</h3>
  <h2>Another section</h2>

<!-- ❌ Heading used for styling, not structure -->
<h4 style="font-size: 1.5rem">This should be an h2</h4>

<!-- ✅ Table with headers -->
<table>
  <thead>
    <tr>
      <th scope="col">Name</th>
      <th scope="col">Role</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Alice</td>
      <td>Engineer</td>
    </tr>
  </tbody>
</table>

<!-- ❌ Layout table presenting data -->
<table>
  <tr><td><b>Name</b></td><td><b>Role</b></td></tr>
  <tr><td>Alice</td><td>Engineer</td></tr>
</table>
```

**1.3.2 Meaningful Sequence (A)**
Reading order in the DOM must be logical. CSS absolute positioning should not create a DOM order that contradicts the visual/logical reading order.

**1.3.3 Sensory Characteristics (A)**
Instructions must not rely on shape, colour, size, location, or sound alone.

```text
❌ "Click the red button to continue"
✅ "Click the Continue button (highlighted in red) to proceed"
```

**1.3.4 Orientation (AA)**
Content must not be restricted to portrait or landscape only, unless essential.

**1.3.5 Identify Input Purpose (AA)**
Form inputs collecting personal data must use autocomplete attributes.

```html
<input type="email" autocomplete="email" />
<input type="tel" autocomplete="tel" />
<input type="text" autocomplete="given-name" />
<input type="text" autocomplete="family-name" />
<input type="text" autocomplete="street-address" />
```

---

### 1.4 Distinguishable

**1.4.1 Use of Colour (A)**
Colour must not be the only visual means of conveying information.

```text
❌ Required fields marked only by red label colour
✅ Required fields marked with asterisk (*) + aria-required="true" + visible legend explaining the mark

❌ Error state shown only by red border
✅ Error state: red border + error icon + error text message
```

**1.4.2 Audio Control (A)**
Any audio that plays automatically for more than 3 seconds must have a mechanism to pause or stop it.

**1.4.3 Contrast Minimum (AA)**
Text contrast ratios (pt is the normative unit; px shown as the approximate equivalent, 1pt ≈ 1.333px):

- Normal text (< 18pt / 24px, and < 14pt bold / 18.5px): **4.5:1**
- Large text (≥ 18pt / 24px, or ≥ 14pt bold / 18.5px): **3:1**

Exceptions (no contrast requirement): text in an inactive/disabled component; pure decoration; text not visible to anyone; text that is part of a picture with significant other visual content; and text that is part of a logo or brand name.

Tools: WebAIM Contrast Checker, browser DevTools, Colour Contrast Analyser (desktop app).

**1.4.4 Resize Text (AA)**
Text must resize to 200% without loss of content or functionality. Do not use `px` for font sizes in ways that prevent scaling. Avoid fixed-height containers that clip text.

**1.4.5 Images of Text (AA)**
Use actual text rather than images of text. Exception: logos.

**1.4.10 Reflow (AA)**
Content must reflow at 400% zoom (equivalent to 320px viewport width) without horizontal scrolling. Exception: content requiring two-dimensional layout (maps, data tables).

**1.4.11 Non-text Contrast (AA)**
UI components and graphical objects must have 3:1 contrast against adjacent colours.

- Form input borders must meet 3:1 against background
- Focus indicators must meet 3:1
- Icon-only buttons must meet 3:1 for the icon

**1.4.12 Text Spacing (AA)**
Text must remain readable when users apply all of the following simultaneously:

- Line height: 1.5× the font size
- Letter spacing: 0.12× the font size
- Word spacing: 0.16× the font size
- Paragraph spacing: 2× the font size

**1.4.13 Content on Hover or Focus (AA)**
When additional content appears on hover or focus (tooltips, sub-menus):

- The content is dismissable (e.g., Escape closes it)
- The pointer can move over the additional content without it disappearing
- The content stays until pointer leaves, focus moves, or user dismisses

```html
<!-- ✅ Tooltip that persists when hovered -->
<button aria-describedby="tooltip">?</button>
<div role="tooltip" id="tooltip">More information about this field</div>
```

**Colour preferences and forced colours (best practice beyond a single criterion)**
Honour `prefers-color-scheme` for dark mode and `prefers-contrast: more` where you offer it. Under Windows High Contrast / `forced-colors: active`, the OS swaps your palette for a limited system set — test there, use CSS system-colour keywords for essential borders and icons, and never suppress it with `forced-colors-adjust: none` on meaningful content. `box-shadow`-only focus rings and CSS `background-image` icons disappear in forced-colors mode; provide an `outline` and real `<img>`/SVG fallback.

---

## Operable

### 2.1 Keyboard Accessible

**2.1.1 Keyboard (A)**
All functionality must be operable via keyboard. This means:

- Every interactive element must be reachable by Tab
- All mouse-triggered actions must have keyboard equivalents
- Custom drag-and-drop must have a keyboard alternative

**2.1.2 No Keyboard Trap (A)**
Users must always be able to move focus away from any component using standard keys (Tab, arrow keys, Escape). Exception: modals — which intentionally trap focus but must release on Escape.

**2.1.4 Character Key Shortcuts (A)**
Single character keyboard shortcuts that fire on keydown/keypress must be reconfigurable, disableable, or only active when the component has focus.

---

### 2.2 Enough Time

**2.2.1 Timing Adjustable (A)**
If any time limit exists, users must be able to turn it off, adjust it, or extend it (at least 20 seconds' warning, extendable ≥10×). Exceptions: real-time events (auctions), essential limits, or limits longer than 20 hours. Session timeouts that log a user out without warning are the common failure.

**2.2.2 Pause, Stop, Hide (A)**
Any moving, blinking, scrolling, or auto-updating content that starts automatically, lasts more than 5 seconds, and runs alongside other content must have a mechanism to pause, stop, or hide it. Applies to carousels, marquees, auto-advancing sliders, animated backgrounds, and auto-refreshing feeds.

---

### 2.3 Seizures and Physical Reactions

**2.3.1 Three Flashes or Below Threshold (A)**
Nothing may flash more than **three times in any one second**, unless it stays below the general-flash and red-flash thresholds. This is a safety criterion — flashing content can trigger seizures. Test animation and video with the free PEAT (Photosensitive Epilepsy Analysis Tool).

**Reduced motion** — 2.3.3 Animation from Interactions is Level AAA, but honouring `prefers-reduced-motion` is a baseline expectation. Large parallax, auto-playing motion, and transform-heavy transitions cause nausea and dizziness for people with vestibular disorders. Default to no non-essential animation and layer it in only when motion is allowed:

```css
/* Default: no motion. Opt in only when the user permits it. */
.card { transition: none; }

@media (prefers-reduced-motion: no-preference) {
  .card { transition: transform 200ms ease; }
}

/* Blanket-neutralise motion for those who request less */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Essential motion (e.g. a spinner conveying progress) may remain, but keep it small and non-flashing.

---

### 2.4 Navigable

**2.4.1 Bypass Blocks (A)**
There must be a mechanism to skip repetitive navigation. Minimum: a "Skip to main content" skip link as the first focusable element.

```html
<a href="#main" class="skip-link">Skip to main content</a>
...
<main id="main">...</main>
```

Also satisfied by ARIA landmark regions that allow screen reader users to jump by landmark.

**2.4.2 Page Titled (A)**
Every page must have a descriptive `<title>`. Format: `[Page name] — [Site name]`. In SPAs, update `document.title` on every route change.

**2.4.3 Focus Order (A)**
Tab order must follow a meaningful sequence. DOM order should match visual reading order.

**2.4.4 Link Purpose (In Context) (A)**
Link text must make sense in isolation or in context of its surrounding paragraph/heading. "Click here" and "Read more" fail without context.

```html
<!-- ❌ Ambiguous out of context -->
<a href="/report.pdf">Click here</a>

<!-- ✅ Descriptive -->
<a href="/report.pdf">Download Q4 Annual Report (PDF, 2.3MB)</a>

<!-- ✅ Context via visually hidden text -->
<a href="/report.pdf">
  Read more <span class="visually-hidden">about our Q4 Annual Report</span>
</a>

<!-- ✅ Context via aria-label -->
<a href="/report.pdf" aria-label="Download Q4 Annual Report PDF">Read more</a>
```

**2.4.5 Multiple Ways (AA)**
Provide more than one way to locate a page within a site — e.g. a navigation menu plus a search, or a sitemap. Exception: a page that is a step within a process (a checkout flow need not be reachable other ways).

**2.4.6 Headings and Labels (AA)**
Headings and form labels must describe their topic or purpose.

**2.4.7 Focus Visible (AA)**
All focusable elements must have a visible focus indicator. Never `outline: none` without a replacement.

**2.4.11 Focus Not Obscured — Minimum (AA)** *(new in 2.2)*
A focused element must not be entirely hidden by sticky headers, cookie banners, or other overlaid content.

**2.4.12 Focus Not Obscured — Enhanced (AAA)** *(new in 2.2)*
The entire focused element must be visible (no partial obscuring).

**2.4.13 Focus Appearance (AAA)** *(new in 2.2 — AAA, not required for AA)*
Stricter than the AA focus rules. The focus indicator must cover at least the area of a 2 CSS pixel thick perimeter of the component, and change by at least 3:1 contrast *between the focused and unfocused states* (a change-of-state contrast). The **AA** obligations for focus indicators are 2.4.7 Focus Visible, 1.4.11 Non-text Contrast (3:1 against adjacent colours), and 2.4.11 Focus Not Obscured — aim for 2.4.13 where practical but don't cite it as AA.

---

### 2.5 Input Modalities

**2.5.1 Pointer Gestures (A)**
Multipoint or path-based gestures (pinch, swipe, drag) must have a single-pointer alternative.

**2.5.2 Pointer Cancellation (A)**
For single-pointer interactions, at least one of: no down-event trigger, abort/undo mechanism, or up-event trigger with reversibility.

**2.5.3 Label in Name (A)**
Visible label text must match or be contained within the accessible name.

```html
<!-- ❌ Accessible name doesn't contain visible text -->
<button aria-label="Submit the registration form">Register</button>

<!-- ✅ Accessible name contains visible text -->
<button aria-label="Register for the conference">Register</button>
```

Voice control users say the visible label to activate controls. If the accessible name differs, the control won't respond.

**2.5.4 Motion Actuation (A)**
Functionality triggered by device motion must have a UI alternative, and motion response must be disableable.

**2.5.7 Dragging Movements (AA)** *(new in 2.2)*
Any drag-and-drop functionality must have a single-pointer alternative.

**2.5.8 Target Size — Minimum (AA)** *(new in 2.2)*
Pointer targets must be at least 24×24 CSS pixels. Exceptions:

- **Spacing** — a 24px-diameter circle centred on each undersized target does not overlap another target (or its circle)
- **Equivalent** — the same function is available via another control on the page that does meet 24×24
- **Inline** — the target is within a sentence, or constrained by the line-height of surrounding non-target text (e.g. inline links). *This is the most common legitimate pass — don't fail inline text links.*
- **User agent control** — the size is set by the browser and not modified by the author (e.g. native date pickers, default form controls)
- **Essential** — a specific presentation is essential or legally required (e.g. map pins, dense data visualisation)

---

## Understandable

### 3.1 Readable

#### 3.1.1 Language of Page (A)

```html
<html lang="en">
<html lang="fr">
<html lang="ar" dir="rtl">
```

**3.1.2 Language of Parts (AA)**
Mark language changes inline:

```html
<p>The French for hello is <span lang="fr">bonjour</span>.</p>
```

---

### 3.2 Predictable

**3.2.1 On Focus (A)**
No context change on receiving focus alone. No popups, redirects, or form submits triggered by `:focus`.

**3.2.2 On Input (A)**
No automatic context changes when a user changes input value, unless warned. No auto-submit on select change.

**3.2.3 Consistent Navigation (AA)**
Navigation menus appear in the same order across pages.

**3.2.4 Consistent Identification (AA)**
Components with the same function have the same accessible name across pages. A "Search" button is always labelled "Search", not "Search" on one page and "Find" on another.

**3.2.6 Consistent Help (A)** *(new in 2.2)*
Help mechanisms (FAQ, chat, contact details) appear in a consistent location across pages.

---

### 3.3 Input Assistance

**3.3.1 Error Identification (A)**
Errors are identified in text. Not by colour alone. The error message describes what went wrong.

**3.3.2 Labels or Instructions (A)**
Labels or instructions are provided for required format or constraints.

```html
<label for="dob">Date of birth <span aria-hidden="true">(DD/MM/YYYY)</span></label>
<input id="dob" type="text" aria-describedby="dob-format" />
<span id="dob-format" class="visually-hidden">Format: day, month, year. Example: 25/03/1985</span>
```

**3.3.3 Error Suggestion (AA)**
If an error is detected and suggestions for correction are known, provide them.

**3.3.4 Error Prevention — Legal, Financial, Data (AA)**
For submissions with legal/financial consequences: provide a review step, ability to correct, or ability to reverse/cancel.

**3.3.7 Redundant Entry (A)** *(new in 2.2)*
Information already entered in a multi-step process must be auto-populated or available to select, not required to be re-entered.

**3.3.8 Accessible Authentication — Minimum (AA)** *(new in 2.2)*
Authentication must not rely solely on a cognitive function test (memorising passwords, solving puzzles) without an alternative. Allowing copy-paste for passwords, password managers, and "show password" toggles all help satisfy this.

**3.3.9 Accessible Authentication — Enhanced (AAA)** *(new in 2.2 — AAA, not required for AA)*
Stricter than 3.3.8: no cognitive-function test at all, even with an alternative — it also removes 3.3.8's object-recognition and personal-content allowances.

---

## Robust

### 4.1 Compatible

**4.1.2 Name, Role, Value (A)**
All UI components must have an accessible name, the correct role, and appropriate state/value programmatically set.

```html
<!-- ✅ Custom checkbox -->
<div role="checkbox"
     aria-checked="false"
     tabindex="0"
     aria-labelledby="label-id">
</div>
<span id="label-id">Accept terms</span>

<!-- ❌ Status changes but not announced -->
<div class="status active">Active</div>

<!-- ✅ State change announced -->
<div aria-live="polite" class="status" aria-label="Status: Active">Active</div>
```

**4.1.3 Status Messages (AA)**
Status messages (success, error, loading) must be programmatically determinable so they can be announced without receiving focus. Use `role="status"`, `role="alert"`, or `aria-live`.

---

## Testing Order by Impact

1. Run automated scan (axe, Lighthouse) — a shift-left check that catches only a minority of issues (~30–40% of success criteria) and never proves compliance
2. Keyboard-only navigation test — Tab through entire page
3. Screen reader test with NVDA + Firefox (or Chrome)
4. Colour contrast audit
5. Zoom/reflow test at 400%
6. Mobile screen reader test with VoiceOver/TalkBack

Automated tools to use:

- **axe DevTools** (browser extension) — most accurate automated scanner
- **Lighthouse** (built into Chrome DevTools) — good for quick audits
- **WAVE** (browser extension) — good for visual overlay of issues
- **IBM Equal Access Checker** — good WCAG 2.2 coverage
