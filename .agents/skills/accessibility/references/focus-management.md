# Focus Management Reference

Focus management is the programmatic control of keyboard focus — moving it, trapping it, and restoring it. This is the area most commonly broken in modern web apps, especially SPAs.

---

## The Core Focus Contract

1. When a UI state change hides the current focused element, move focus to somewhere logical
2. When a dialog opens, focus moves inside it
3. When a dialog closes, focus returns to what opened it
4. When a SPA navigates, focus moves to the new page content
5. When focus would be lost (deleted element), move it to the nearest logical parent

Breaking this contract means keyboard and screen reader users lose their place on the page with no way to recover other than reloading.

---

## Modal Dialogs

### The complete accessible modal checklist

- [ ] `role="dialog"` or use native `<dialog>` element
- [ ] `aria-modal="true"` (restricts virtual cursor to dialog in supporting screen readers)
- [ ] `aria-labelledby` pointing to the dialog's heading, or `aria-label`
- [ ] Focus moves into dialog on open (to dialog container, first heading, or first interactive element)
- [ ] Focus is trapped within dialog while open (Tab and Shift+Tab cycle within)
- [ ] `Escape` key closes the dialog
- [ ] Focus returns to the trigger element on close
- [ ] Background content is `aria-hidden="true"` while dialog is open

### Vanilla JS focus trap implementation

```javascript
function trapFocus(element) {
  const focusableSelectors = [
    'a[href]', 'button:not([disabled])',
    'input:not([disabled])', 'select:not([disabled])',
    'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'
  ].join(', ');

  function getFocusableElements() {
    return [...element.querySelectorAll(focusableSelectors)]
      .filter(el => !el.closest('[hidden]'));
  }

  function handleKeyDown(e) {
    if (e.key !== 'Tab') return;
    
    const focusable = getFocusableElements();
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      // Shift+Tab from first → go to last
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      // Tab from last → go to first
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  element.addEventListener('keydown', handleKeyDown);

  // Return cleanup function
  return () => element.removeEventListener('keydown', handleKeyDown);
}

// Usage
function openModal(modalEl, triggerEl) {
  const cleanup = trapFocus(modalEl);
  
  // Make background inert
  document.getElementById('app-root').setAttribute('aria-hidden', 'true');
  
  // Focus first focusable element in dialog
  const firstFocusable = modalEl.querySelector(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  firstFocusable?.focus();

  function handleEscape(e) {
    if (e.key === 'Escape') closeModal();
  }

  document.addEventListener('keydown', handleEscape);

  function closeModal() {
    cleanup();
    document.removeEventListener('keydown', handleEscape);
    document.getElementById('app-root').removeAttribute('aria-hidden');
    triggerEl.focus(); // Restore focus to trigger
  }

  return closeModal;
}
```

### Using native `<dialog>` element (recommended)

The native `<dialog>` element handles focus trapping, `Escape` key, and `aria-modal` behaviour automatically in modern browsers.

```html
<dialog id="confirm-dialog" aria-labelledby="dialog-title">
  <h2 id="dialog-title">Confirm deletion</h2>
  <p>Are you sure you want to delete this item?</p>
  <button id="confirm-btn">Delete</button>
  <button id="cancel-btn" autofocus>Cancel</button>
</dialog>
```

```javascript
const dialog = document.getElementById('confirm-dialog');
const trigger = document.getElementById('delete-trigger');

trigger.addEventListener('click', () => {
  dialog.showModal(); // Opens as modal, traps focus, handles Escape
});

document.getElementById('cancel-btn').addEventListener('click', () => {
  dialog.close();
  trigger.focus(); // Native <dialog> does NOT auto-restore focus
});

dialog.addEventListener('close', () => {
  trigger.focus(); // Always restore focus on close
});
```

**`autofocus` attribute** on the cancel button is correct for destructive dialogs — prevents accidental confirmation. For non-destructive dialogs, focus the first input or the dialog container itself.

### React implementation

```jsx
import { useEffect, useRef } from 'react';

function Modal({ isOpen, onClose, title, children, triggerRef }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    // Focus first element inside dialog
    const focusable = dialogRef.current?.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusable?.focus();

    // Restore focus on close
    return () => {
      triggerRef.current?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      ref={dialogRef}
    >
      <h2 id="modal-title">{title}</h2>
      {children}
      <button onClick={onClose}>Close</button>
    </div>
  );
}
```

Libraries: `focus-trap-react`, `@radix-ui/react-dialog`, `react-aria` (Adobe) all handle this correctly. Prefer them over custom implementations.

---

## SPA Route Changes

Traditional page loads reset focus to the top of the document automatically. SPAs don't. Without intervention, focus remains on the clicked link or button after navigation, and screen reader users have no idea the page changed.

### Pattern 1: Focus the `<h1>` on route change

```javascript
// React Router v6 example
import { useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';

function PageTitle({ title }) {
  const h1Ref = useRef(null);
  const location = useLocation();

  useEffect(() => {
    // Update document title
    document.title = `${title} - My App`;
    
    // Move focus to page heading
    // tabIndex="-1" makes it focusable programmatically without entering tab order
    h1Ref.current?.focus();
  }, [location.pathname]);

  return <h1 ref={h1Ref} tabIndex={-1}>{title}</h1>;
}
```

### Pattern 2: Focus a live region announcing the new page

```javascript
// Announce route change without moving visible focus
const announcer = document.getElementById('route-announcer');

router.on('navigate', (route) => {
  announcer.textContent = '';
  requestAnimationFrame(() => {
    announcer.textContent = `Navigated to ${route.title}`;
  });
});
```

```html
<!-- In app shell - present on all pages -->
<div id="route-announcer" 
     aria-live="assertive" 
     aria-atomic="true"
     class="visually-hidden">
</div>
```

### Pattern 3: Skip link to main content (always include this)

```html
<!-- First element in <body> -->
<a href="#main-content" class="skip-link">Skip to main content</a>

<header>...</header>
<main id="main-content">...</main>
```

```css
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  background: #000;
  color: #fff;
  padding: 8px;
  z-index: 100;
  text-decoration: none;
}

.skip-link:focus {
  top: 0; /* Slides into view only on keyboard focus */
}
```

---

## Focus Visibility

Never remove focus outlines without providing a visible replacement. Keyboard users depend on the focus indicator to know where they are.

### WCAG 2.2 Focus Appearance (2.4.11, 2.4.12 — AA)
- Focused element must have a focus indicator with at least 3:1 contrast ratio against adjacent colours
- Focus indicator area must be at least the perimeter of the element

```css
/* Minimal compliant focus style */
:focus-visible {
  outline: 3px solid #005fcc;
  outline-offset: 2px;
}

/* Remove focus ring only for mouse users (not keyboard) */
:focus:not(:focus-visible) {
  outline: none;
}
```

`:focus-visible` applies only when the browser determines focus came from keyboard or AT, not mouse click. This prevents the ring appearing on button click for mouse users while keeping it for keyboard users.

### Custom focus style example

```css
button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px white, 0 0 0 5px #005fcc; /* White gap for contrast on coloured buttons */
}
```

---

## tabindex

| Value | Effect |
|---|---|
| `tabindex="0"` | Makes non-interactive element keyboard focusable and adds to natural tab order |
| `tabindex="-1"` | Focusable programmatically (via `.focus()`) but not via Tab key |
| `tabindex="1"` or higher | **Never use.** Creates unpredictable tab order that breaks for users |

```html
<!-- Make a modal container focusable so focus.() works on open -->
<div role="dialog" tabindex="-1" aria-labelledby="title">...</div>

<!-- Custom widget container — arrow keys navigate internally, not Tab -->
<ul role="listbox" tabindex="0">
  <li role="option" tabindex="-1">Option 1</li>
  <li role="option" tabindex="-1">Option 2</li>
</ul>
```

The **roving tabindex pattern** (used for widgets like tab lists, menus, radio groups): only the active item has `tabindex="0"`, all others have `tabindex="-1"`. Arrow keys move between items and update which has `tabindex="0"`. Tab moves focus out of the widget entirely.

---

## Focus After Dynamic Content Changes

| Scenario | Focus destination |
|---|---|
| Modal opens | First focusable element inside modal, or modal container (tabindex="-1") |
| Modal closes | Element that triggered the modal |
| Inline confirmation appears | The confirmation element (with tabindex="-1") |
| Form error summary appears | Error summary container (with tabindex="-1") |
| SPA navigation | Page `<h1>` or `<main>` (with tabindex="-1") |
| Accordion opens | Leave focus on the accordion toggle (do not move) |
| Infinite scroll loads | Leave focus in place; announce count via live region |
| Toast/notification appears | Leave focus in place; use live region |
| Deleted item in list | Next item in list, or the list container if last item |

---

## Inert Attribute (Modern Alternative)

The `inert` attribute (2023+, good browser support) makes an element and all its descendants unfocusable, non-interactive, and hidden from the accessibility tree simultaneously — a cleaner alternative to `aria-hidden` + `tabindex` manipulation.

```javascript
function openModal(modal, appRoot) {
  appRoot.inert = true;  // Locks out background completely
  modal.removeAttribute('inert');
  modal.querySelector('button')?.focus();
}

function closeModal(modal, appRoot, triggerEl) {
  modal.inert = true;
  appRoot.inert = false;
  triggerEl.focus();
}
```

Check browser support before using in production. Polyfill available: `wicg-inert`.

---

## Common Focus Bugs

**Bug: Focus lost to `<body>` after dynamic removal**
```javascript
// ❌ Element removed, focus disappears
item.remove();

// ✅ Move focus before removing
const nextSibling = item.nextElementSibling || item.previousElementSibling || list;
nextSibling.focus();
item.remove();
```

**Bug: Modal opens, focus not moved**
```javascript
// ❌ Modal appears, screen reader user is still on the trigger
modal.classList.remove('hidden');

// ✅ Move focus after modal renders
modal.classList.remove('hidden');
modal.querySelector('h2, button, input').focus();
```

**Bug: Focus trapped in modal after `display:none` toggle**
```javascript
// ❌ Modal hidden but focus trap still active
modal.style.display = 'none';

// ✅ Clean up trap before hiding
cleanup(); // remove event listeners
modal.style.display = 'none';
triggerEl.focus();
```

**Bug: Skip link not visible on focus (common mistake)**
```css
/* ❌ Hidden with display:none — not focusable at all */
.skip-link { display: none; }
.skip-link:focus { display: block; }

/* ✅ Visually positioned off-screen, slides in on focus */
.skip-link { position: absolute; top: -40px; }
.skip-link:focus { top: 0; }
```
