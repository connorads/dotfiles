# Screen Readers Reference

Practical knowledge for testing with and building for the three dominant screen readers. 2024 WebAIM survey: NVDA 65.6%, JAWS 60.5%, VoiceOver 44.1% (users commonly use multiple).

---

## How Screen Readers Work

Screen readers maintain a **virtual buffer** — a linearised copy of the page's accessibility tree. In **browse mode** (also called virtual cursor / reading mode), users navigate this buffer with single-key shortcuts without interacting with the live DOM. In **forms mode** (interaction mode / focus mode), keystrokes go to the focused control rather than the screen reader.

Understanding this is critical: keyboard commands like `H` for next heading only work in browse mode. Inside a form field or custom widget, those keys type characters. Screen readers switch modes automatically at certain elements, and announce the switch with a sound cue. Users can also switch manually.

**Implication for developers:** Custom widgets that expect arrow key input (menus, sliders, grids) must declare their roles so the screen reader knows to switch to forms mode. Widgets that don't declare roles trap users in browse mode where arrow keys navigate the buffer instead of the widget.

---

## NVDA (NonVisual Desktop Access)

**Free, open-source. Best with Firefox or Chrome on Windows. Strict code interpreter — exposes exactly what's in markup.**

### Starting NVDA
- Download from nvaccess.org (free)
- Press `Insert + N` to open NVDA menu
- Press `Ctrl` to silence speech mid-sentence
- Adjust speech rate: `Insert + N` → Preferences → Settings → Speech

### Browse Mode Commands

| Action | Command |
|--------|---------|
| Next heading | `H` |
| Previous heading | `Shift+H` |
| Heading level 1–6 | `1`–`6` |
| Next landmark | `D` |
| Next link | `K` |
| Next form field | `F` |
| Next button | `B` |
| Next table | `T` |
| Elements list (all) | `NVDA+F7` |
| Read current line | `NVDA+Up` |
| Read from cursor | `NVDA+Down` |
| Toggle forms mode | `NVDA+Space` |

### Forms Mode Commands

| Action | Command |
|--------|---------|
| Next form field | `Tab` |
| Activate button | `Enter` or `Space` |
| Select from combo box | `Alt+Down`, then arrow keys |
| Re-read field label | `NVDA+Tab` |
| Exit forms mode | `Escape` |

### Table Navigation (Browse Mode)
- `Ctrl+Alt+Right` — next cell in row
- `Ctrl+Alt+Left` — previous cell in row
- `Ctrl+Alt+Down` — cell below (with column header announced)
- `Ctrl+Alt+Up` — cell above

NVDA announces column and row headers automatically when `<th>` elements are correctly marked up.

### Testing Workflow with NVDA
1. Open page in Firefox or Chrome
2. Press `Ctrl+Home` to go to top
3. Press `NVDA+F7` → open elements list → switch to Headings view — is page structure logical?
4. Press `NVDA+F7` → switch to Landmarks view — are regions present and labelled?
5. Tab through all interactive elements — does each get announced with role + name?
6. Test any forms: enter data, trigger errors, check that errors are announced on field focus
7. Test any dialogs: open, check focus moves inside, check Escape closes and focus returns to trigger
8. Check any live regions: trigger dynamic updates, verify announcements

---

## JAWS (Job Access With Speech)

**Paid (£90/yr or £1,100 perpetual). Enterprise standard. Uses heuristics to "repair" bad markup — may pass things NVDA fails.** For auditing, this means JAWS passing is not proof of correctness; NVDA is the stricter reference.

JAWS offers 40-minute free evaluation sessions without purchase.

### Key Differences from NVDA
- JAWS has **smart navigation** that can infer context from visual layout when ARIA is missing
- Uses a different virtual buffer implementation — occasional differences in announcement order
- Better compatibility with legacy enterprise applications (MS Office, older CRMs)
- `Insert` is the JAWS modifier (same as NVDA, but settings key is `Insert+J`)

### Browse Mode Commands (same navigation keys as NVDA)

| Action | Command |
|--------|---------|
| All headings list | `Insert+F6` |
| All links list | `Insert+F7` |
| All form fields list | `Insert+F5` |
| Read current element | `Insert+Tab` |
| Say all | `Insert+Down` |

### Forms Mode
JAWS enters forms mode automatically when focused on an input. You hear a "chime" entering forms mode and a lower "chime" leaving. Press `Enter` or `Space` on a form field to activate forms mode manually if needed.

---

## VoiceOver (macOS and iOS)

**Built into all Apple devices. Best with Safari. More lenient with markup errors than NVDA.**

### Enabling VoiceOver
- macOS: `Cmd+F5` or System Settings → Accessibility → VoiceOver
- iOS: Settings → Accessibility → VoiceOver → toggle on

VoiceOver uses a **rotor** (gesture or `VO+U` on Mac) to switch navigation modes — headings, links, form controls, landmarks, etc.

### Core macOS Commands

| Action | Command |
|--------|---------|
| VO modifier (hold) | `Ctrl+Option` (VO) |
| Next element | `VO+Right` |
| Previous element | `VO+Left` |
| Interact with element | `VO+Shift+Down` |
| Stop interacting | `VO+Shift+Up` |
| Activate | `VO+Space` |
| Open rotor | `VO+U` |
| Read from beginning | `VO+A` |
| Headings list | `VO+U`, then arrow to "Headings" |

### Rotor Navigation (most efficient for users)
Press `VO+U` to open the rotor wheel. Arrow left/right to select category (Headings, Links, Form Controls, Landmarks, etc.). Arrow up/down to move through items in that category. Press `Enter` to jump.

### iOS VoiceOver Gestures
- Swipe right/left — next/previous element
- Double tap — activate
- Two-finger swipe up — read from top
- Rotor — rotate two fingers to switch navigation mode, swipe up/down to navigate

---

## Screen Reader + Browser Pairings

Testing with the correct browser pairing matters — some accessibility APIs work differently across combinations.

| Screen Reader | Best Browser | Notes |
|---|---|---|
| NVDA | Firefox, Chrome | Both good; Firefox has slightly better ARIA support |
| JAWS | Chrome, IE (legacy) | Chrome is primary for modern testing |
| VoiceOver macOS | Safari | Safari has the most complete AT support on Mac |
| VoiceOver iOS | Safari | Always use Safari on iOS |
| Narrator (Windows) | Edge | Built into Windows, edge cases with complex ARIA |
| TalkBack (Android) | Chrome | Default Android screen reader |

---

## Navigation Patterns Real Users Rely On

From WebAIM screen reader surveys, the most common navigation strategies on a new page:

1. **Headings first** — users press `H` repeatedly to understand page structure and jump to sections. If headings are missing or skipped, users lose navigation entirely.
2. **Forms mode** — entering any input triggers forms mode; `Tab` navigates between fields. Users rely on labels being correctly associated to know what each field is.
3. **Links list** — `Insert+F7` (JAWS/NVDA) opens all links in a list. Every link must make sense out of context. "Click here" and "Read more" are useless in this view.
4. **Landmarks** — `D` jumps between regions. Pages without landmarks force linear reading of the entire page to find content.
5. **Table navigation** — when a table is announced, users use `Ctrl+Alt+Arrow` to navigate cell-by-cell, expecting headers to be re-announced with each cell.

---

## Component-Level Testing Scripts

### Testing a button
1. Tab to the button
2. What is announced? Should be: `[name], button`
3. Press `Enter` and `Space` — both should activate
4. If icon-only: is `aria-label` present? Is the SVG `aria-hidden="true"`?

### Testing a form
1. Tab to first field — should announce: `[label], edit` (or `[label], required, edit`)
2. Submit with empty required fields — do errors appear?
3. Tab to an errored field — should announce: `[label], [error message], invalid data, edit`
4. Check error message is not just colour change

### Testing a modal dialog
1. Activate the trigger
2. Does focus move inside the dialog? (Should announce dialog role + name)
3. Tab through all elements — does focus wrap within the dialog?
4. Press `Escape` — does dialog close and focus return to the trigger?
5. Try tabbing outside — can focus escape the dialog? (It shouldn't)

### Testing a dropdown menu
1. Press the toggle button — should announce: `[name], button, expanded`
2. Navigate items with arrow keys (in custom menus) or Tab
3. Select item — should announce selection and close menu
4. Press `Escape` — should close menu and return focus to trigger

### Testing a tab panel
1. Tab to the tab list
2. Arrow keys move between tabs (not Tab key — Tab should move to tab panel content)
3. `Enter` or `Space` activates a tab
4. The active tab should have `aria-selected="true"` announced
5. `Tab` from the tab moves focus to the panel content

### Testing live content
1. Trigger the update (add to cart, submit form, filter results)
2. Wait — within 1–2 seconds the screen reader should announce the change
3. Verify the announcement is concise and meaningful (not just raw data)

---

## Common Announcement Patterns

What screen readers announce for well-implemented elements:

```
<button>Save changes</button>
→ "Save changes, button"

<input id="name" required /> <label for="name">Full name</label>
→ "Full name, required, edit text"

<input aria-invalid="true" aria-describedby="name-err" />
<span id="name-err">Name must be at least 2 characters</span>
→ "Full name, Name must be at least 2 characters, invalid data, required, edit text"

<a href="/about">About us</a>
→ "About us, link"

<nav aria-label="Main">...</nav>
→ "Main, navigation" (announced when entering landmark)

<h2>Products</h2>
→ "Products, heading level 2"

<img alt="Bar chart showing 25% increase in Q2 sales" />
→ "Bar chart showing 25% increase in Q2 sales, image"

<img alt="" />  (decorative)
→ (nothing announced)
```
