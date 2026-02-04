# UI Patterns

When-to-use guidance for common interface patterns. Not a spec library — a decision guide.

---

## Navigation

### When to Use What

| Pattern | Use when | Avoid when |
|---------|----------|------------|
| **Top nav bar** | ≤7 primary sections, desktop-first | Many sections, deeply nested |
| **Hamburger menu** | Mobile, space-constrained | Desktop (hides important nav) |
| **Tab bar (mobile)** | 3-5 key sections in mobile app | >5 sections, nested content |
| **Sidebar** | Many sections, hierarchical content (dashboards, docs) | Simple sites, mobile-primary |
| **Tabs** | Content in distinct categories on one page | >6 tabs, unrelated content |
| **Breadcrumbs** | Deep hierarchies (>2 levels) | Flat sites, linear flows |

### Top Navigation

```
┌────────────────────────────────────────────────────────┐
│  [Logo]    Home  Products  About  Contact    [🔍] [👤] │
└────────────────────────────────────────────────────────┘
```

- Fixed or sticky at top
- Logo links to home
- Active item distinguished (underline, bold, or colour)
- Collapses to hamburger on mobile
- `<nav aria-label="Main navigation">`
- Current page: `aria-current="page"`

### Hamburger Menu

```
Closed: [≡]     Open: [×]
                       ├── Home
                       ├── Products
                       ├── About
                       └── Contact
```

- Slide from left/right, 300ms ease
- Trap focus within when open
- Escape key closes
- Backdrop click closes
- Return focus to hamburger on close
- `aria-expanded` toggles on open/close

### Tabs

```
[Tab 1*]  [Tab 2]  [Tab 3]
┌────────────────────────────┐
│ Content for Tab 1          │
└────────────────────────────┘
```

- Arrow keys switch tabs
- Active tab: `aria-selected="true"`
- Panel: `role="tabpanel"` linked via `aria-controls`
- Content should not cause page scroll jump on switch

### Breadcrumbs

```
Home > Products > Electronics > Laptops
```

- `<nav aria-label="Breadcrumb">` with `<ol>`
- Current page: `aria-current="page"`, not a link
- Only for hierarchical navigation, not linear flows

---

## Forms

### Layout Principles

- **Single column** — always. Two-column forms slow completion.
- **Labels above inputs** — better scanning, works at all widths
- **16px minimum font** — prevents iOS zoom on focus
- **One primary action** per form
- **Group related fields** with visual spacing or fieldsets

### Validation States

| State | Visual | Behaviour |
|-------|--------|-----------|
| **Default** | Grey border | — |
| **Focus** | Blue border + shadow | Validate on blur, not keystroke |
| **Valid** | Green checkmark | Show after blur if instant feedback helps |
| **Error** | Red border + icon + message | Show on blur or submit. `aria-invalid="true"` |
| **Disabled** | Greyed out, reduced opacity | `cursor: not-allowed`. Explain why if not obvious |

### Form Pattern

```
┌────────────────────────────┐
│  Field Label *             │
│  [____________________]    │
│  Helper text               │
│                            │
│  Field Label               │
│  [____________________]    │
│                            │
│  [ ] I agree to terms      │
│                            │
│  [    Submit    ]          │
└────────────────────────────┘
```

- Required fields: asterisk (*) with "* Required" note
- Helper text: below input, linked with `aria-describedby`
- Error messages: replace helper text, use `role="alert"`
- Submit button: match width to inputs or left-align

### Long Forms

Break into steps when >7 fields:

```
Step 1 of 3: Personal Details
[==========                    ] 33%

First Name *
[____________________]

Last Name *
[____________________]

[← Back]              [Next →]
```

- Progress indicator (bar or steps)
- Allow back navigation without data loss
- Validate per step, not just at end
- Show step count

---

## Cards

### When to Use Cards

- Displaying collections of similar items
- Each item has image + text + action
- Items can be compared or scanned

### Basic Card

```
┌────────────────────┐
│  [Image]           │
├────────────────────┤
│  Title             │
│  Description...    │
│  [Action]          │
└────────────────────┘
```

- Border-radius: 8px
- Subtle shadow, increased on hover
- Equal height within rows (CSS Grid)
- If clickable, entire card is the link
- Hover: slight elevation change (200ms ease)

### Responsive Grid

| Viewport | Columns | Gap |
|----------|---------|-----|
| Mobile (<768px) | 1 | 16px |
| Tablet (768-1023px) | 2 | 16px |
| Desktop (≥1024px) | 3-4 | 24px |

```css
.card-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
}
```

---

## Modals

### When to Use (and When Not)

**Use modals for:**
- Confirmations ("Delete this item?")
- Focused tasks that don't need full context
- Urgent messages requiring action

**Don't use modals for:**
- Information that could be inline
- Complex multi-step flows (use a page)
- Content users need to reference while doing other things

### Modal Structure

```
┌─────────────────────────────┐
│ Title                   [×] │
├─────────────────────────────┤
│                             │
│  Content                    │
│                             │
├─────────────────────────────┤
│          [Cancel] [Confirm] │
└─────────────────────────────┘
```

- Max-width: 600px, centred
- Backdrop: semi-transparent overlay
- Focus trap: Tab cycles within modal
- Escape closes
- Return focus to trigger on close
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby`

### Destructive Confirmation

```
┌───────────────────────────┐
│ ⚠ Delete account?     [×] │
├───────────────────────────┤
│                           │
│ This permanently deletes  │
│ all your data. This       │
│ cannot be undone.         │
│                           │
├───────────────────────────┤
│     [Cancel]  [Delete]    │
└───────────────────────────┘
```

- Explain consequences clearly
- Cancel is default/primary visual weight
- Destructive action uses danger colour
- Consider requiring typed confirmation for irreversible actions

---

## Buttons

### Hierarchy

| Level | Style | Use for |
|-------|-------|---------|
| **Primary** | Solid fill, high contrast | Main action per section |
| **Secondary** | Outlined | Supporting actions |
| **Tertiary** | Text only | Low-priority actions |
| **Danger** | Red fill or outlined | Destructive actions |

One primary button per visible section. Multiple primaries = no hierarchy.

### Sizing

| Context | Height | Min width | Touch target |
|---------|--------|-----------|-------------|
| Mobile | 48px | 120px | 44×44px minimum |
| Desktop | 40px | 100px | — |
| Compact | 32px | 80px | Only in toolbars/dense UI |

### States

Every button needs: default, hover, focus, active (pressed), disabled, loading.

- **Disabled**: 50% opacity, `cursor: not-allowed`, explain why if possible
- **Loading**: Replace label with spinner, prevent double-submit, keep button width stable

### Icon Buttons

```html
<button aria-label="Close">
  <svg aria-hidden="true"><!-- icon --></svg>
</button>
```

Minimum 40×40px (44×44px on mobile). Always provide `aria-label`.

---

## Loading

### Choosing a Pattern

| Pattern | Use when |
|---------|----------|
| **Spinner** | Unknown duration, small area |
| **Skeleton screen** | Known layout, content loading |
| **Progress bar** | Known progress (upload, multi-step) |
| **Optimistic UI** | Action likely to succeed (toggle, like) |

### Skeleton Screen

```
┌────────────────────────────┐
│  ▓▓▓▓▓▓▓▓▓▓▓▓              │
│  ▓▓▓▓▓▓ ▓▓▓▓▓▓▓            │
│                            │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓         │
│  ▓▓▓▓▓▓▓▓▓▓                │
└────────────────────────────┘
```

- Match the layout of real content
- Subtle shimmer animation (optional)
- Replace with real content when loaded
- `role="status"`, `aria-busy="true"` while loading

### Progress Bar

```html
<div role="progressbar"
     aria-valuenow="45"
     aria-valuemin="0"
     aria-valuemax="100"
     aria-label="Upload progress">
```

Show percentage or "Step X of Y" for clarity.

---

## Notifications

### Choosing a Pattern

| Pattern | Persistence | Use for |
|---------|-------------|---------|
| **Toast** | Auto-dismiss (3-5s) | Success, info confirmations |
| **Banner** | Persistent until dismissed | System-wide messages, warnings |
| **Inline alert** | Persistent, contextual | Section-specific info, errors |

### Toast

```
┌────────────────────────┐
│  ✓ Changes saved   [×] │
└────────────────────────┘
```

- Position: top-right or bottom-right
- Auto-dismiss: 3-5 seconds (pause on hover)
- `role="status"` for success/info
- `role="alert"` for errors
- Stack if multiple (most recent on top)

### Inline Alert

```
┌────────────────────────────┐
│  ⚠ Your trial expires in   │
│  3 days. Upgrade now.       │
└────────────────────────────┘
```

- Left border colour indicates type (red/yellow/blue/green)
- Tinted background (10% of border colour)
- Icon reinforces type
- Positioned near relevant content

---

## Data Display

### Tables

Use when: comparing structured data with multiple attributes.

```html
<table>
  <caption>Team members</caption>
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
```

- Responsive: horizontal scroll or card view on mobile
- Sortable columns: `aria-sort="ascending"`
- Alternating row colours for scanability

### Accordion

Use when: content is optional/supplementary and users need only some sections.

```html
<button aria-expanded="false" aria-controls="panel1">
  Section title
</button>
<div id="panel1" hidden>Content...</div>
```

- Allow multiple sections open (unless space is critical)
- Expand/collapse animation: 200-300ms
- Don't hide critical information in accordions

---

## Pattern Selection Cheatsheet

| User Need | Pattern |
|-----------|---------|
| Navigate between sections | Top nav, sidebar, tabs |
| Complete a task | Form (single column, progressive) |
| Browse a collection | Card grid |
| Make a focused decision | Modal |
| Trigger an action | Button (with proper hierarchy) |
| Wait for something | Skeleton, spinner, or progress bar |
| Get feedback | Toast, banner, or inline alert |
| Compare data | Table |
| Read optional detail | Accordion |
