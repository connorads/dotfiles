# Common Fixes Reference

Ready-to-use code fixes for the 20 most frequent accessibility audit findings. Each fix is minimal — it targets the specific issue without rewriting surrounding code.

---

## 1. Icon-only button missing accessible name

```html
<!-- ❌ Before -->
<button class="icon-btn">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <path d="M19 11H7.83l4.88-4.88..."/>
  </svg>
</button>

<!-- ✅ After -->
<button class="icon-btn" aria-label="Back to previous page">
  <svg aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <path d="M19 11H7.83l4.88-4.88..."/>
  </svg>
</button>
```

Note: `focusable="false"` on SVG prevents IE/Edge from adding SVG to tab order.

---

## 2. Input without associated label

```html
<!-- ❌ Before - placeholder is not a label -->
<input type="search" placeholder="Search products..." />

<!-- ✅ After - Option A: Visible label -->
<label for="product-search">Search products</label>
<input id="product-search" type="search" />

<!-- ✅ After - Option B: Visually hidden label (when design can't accommodate visible label) -->
<label for="product-search" class="visually-hidden">Search products</label>
<input id="product-search" type="search" placeholder="e.g. shoes, jackets" />

<!-- ✅ After - Option C: aria-label (use when label element is impractical) -->
<input type="search" aria-label="Search products" placeholder="e.g. shoes, jackets" />
```

---

## 3. Form error not associated with field

```html
<!-- ❌ Before -->
<div class="field">
  <label for="email">Email</label>
  <input id="email" type="email" class="error" />
  <span class="error-msg">Please enter a valid email address.</span>
</div>

<!-- ✅ After -->
<div class="field">
  <label for="email">Email</label>
  <input 
    id="email" 
    type="email"
    class="error"
    aria-invalid="true"
    aria-describedby="email-error"
  />
  <span id="email-error" class="error-msg">Please enter a valid email address.</span>
</div>
```

For inline errors, `aria-invalid` + `aria-describedby` is sufficient — the error is read when the field is focused. No live region needed unless you also want to announce it immediately.

---

## 4. Form error summary at top of page

```html
<!-- ✅ Error summary that receives focus after failed submit -->
<div 
  id="error-summary" 
  role="alert"
  tabindex="-1"
  class="error-summary"
>
  <h2>There are 2 errors in this form</h2>
  <ul>
    <li><a href="#email">Email: Please enter a valid email address</a></li>
    <li><a href="#password">Password: Must be at least 8 characters</a></li>
  </ul>
</div>
```

```javascript
// After form submit validation
document.getElementById('error-summary').focus();
```

The `role="alert"` announces immediately. Moving focus there ensures keyboard users land on the summary. Links in the list allow jumping to each errored field.

---

## 5. div or span used as interactive control

```html
<!-- ❌ Before - no keyboard access, no role -->
<div class="btn" onclick="handleSave()">Save</div>

<!-- ✅ After - native element -->
<button class="btn" onclick="handleSave()">Save</button>

<!-- ✅ After - if you truly cannot change the element (third-party library) -->
<div 
  class="btn"
  role="button"
  tabindex="0"
  onclick="handleSave()"
  onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();handleSave();}"
>
  Save
</div>
```

---

## 6. Ambiguous link text

```html
<!-- ❌ Before - "Read more" repeated 10× on page, all link to different articles -->
<article>
  <h3>Product update</h3>
  <p>We've improved performance...</p>
  <a href="/updates/2024-q4">Read more</a>
</article>

<!-- ✅ After - Option A: Descriptive link text -->
<a href="/updates/2024-q4">Read more about our Q4 product update</a>

<!-- ✅ After - Option B: Visually hidden context -->
<a href="/updates/2024-q4">
  Read more <span class="visually-hidden">about our Q4 product update</span>
</a>

<!-- ✅ After - Option C: aria-label -->
<a href="/updates/2024-q4" aria-label="Read more: Q4 product update">Read more</a>
```

---

## 7. Link opens in new tab without warning

```html
<!-- ❌ Before -->
<a href="https://partner.example.com" target="_blank">Partner site</a>

<!-- ✅ After - warn visually and programmatically -->
<a href="https://partner.example.com" target="_blank" rel="noopener">
  Partner site
  <svg aria-hidden="true" class="icon-external">...</svg>
  <span class="visually-hidden">(opens in new tab)</span>
</a>
```

---

## 8. Select/radio group missing group label

```html
<!-- ❌ Before - individual labels but no group label -->
<div class="field-group">
  <label><input type="radio" name="contact" value="email" /> Email</label>
  <label><input type="radio" name="contact" value="phone" /> Phone</label>
</div>

<!-- ✅ After - fieldset + legend groups them -->
<fieldset>
  <legend>Preferred contact method</legend>
  <label><input type="radio" name="contact" value="email" /> Email</label>
  <label><input type="radio" name="contact" value="phone" /> Phone</label>
</fieldset>
```

For a group of related checkboxes, same pattern applies.

---

## 9. Required fields not indicated programmatically

```html
<!-- ❌ Before - visual asterisk only -->
<label for="name">Name <span class="required">*</span></label>
<input id="name" type="text" />

<!-- ✅ After - aria-required + explained in legend/instruction -->
<p>Fields marked with <span aria-hidden="true">*</span><span class="visually-hidden">an asterisk</span> are required.</p>

<label for="name">Name <span aria-hidden="true">*</span></label>
<input id="name" type="text" required aria-required="true" />
```

`required` (HTML) and `aria-required="true"` (ARIA) both work. HTML `required` also triggers native validation. Use `aria-required` when you've implemented custom validation.

---

## 10. Custom toggle/accordion without ARIA state

```html
<!-- ❌ Before - state not announced -->
<button class="accordion-trigger" onclick="toggle(this)">
  How do I reset my password?
</button>
<div class="accordion-content" hidden>...</div>

<!-- ✅ After -->
<button 
  class="accordion-trigger"
  aria-expanded="false"
  aria-controls="faq-1-content"
  onclick="toggle(this)"
>
  How do I reset my password?
</button>
<div id="faq-1-content" class="accordion-content" hidden>...</div>
```

```javascript
function toggle(trigger) {
  const expanded = trigger.getAttribute('aria-expanded') === 'true';
  trigger.setAttribute('aria-expanded', !expanded);
  
  const contentId = trigger.getAttribute('aria-controls');
  document.getElementById(contentId).hidden = expanded;
}
```

---

## 11. Navigation missing accessible name when multiple navs exist

```html
<!-- ❌ Before - two <nav>s, indistinguishable by screen reader -->
<nav><!-- Main navigation --></nav>
<nav><!-- Breadcrumb --></nav>

<!-- ✅ After -->
<nav aria-label="Main">...</nav>
<nav aria-label="Breadcrumb" aria-current="page">...</nav>
```

If there's only one `<nav>`, no label is needed (the landmark role is sufficient).

---

## 12. Carousel/slider not keyboard navigable

```html
<!-- ✅ Accessible carousel skeleton -->
<section aria-label="Featured products" aria-roledescription="carousel">
  <div 
    role="group"
    aria-roledescription="slide"
    aria-label="Slide 1 of 3"
    aria-hidden="false"
  >
    <!-- Slide content -->
  </div>

  <button aria-label="Previous slide">‹</button>
  <button aria-label="Next slide">›</button>

  <div aria-live="polite" class="visually-hidden" id="carousel-live"></div>
</section>
```

```javascript
function changeSlide(newIndex) {
  // Update aria-hidden on slides
  slides.forEach((slide, i) => {
    slide.setAttribute('aria-hidden', i !== newIndex);
  });
  
  // Announce change
  document.getElementById('carousel-live').textContent = 
    `Showing slide ${newIndex + 1} of ${slides.length}`;
}
```

Auto-advancing carousels must have a pause control (WCAG 2.2.2).

---

## 13. Toast notification not announced

```html
<!-- In HTML on page load (empty) -->
<div id="toast-announcer" role="status" aria-live="polite" aria-atomic="true" class="visually-hidden"></div>

<!-- Visual toast can be whatever -->
<div id="toast" class="toast" hidden>Item added to cart</div>
```

```javascript
function showToast(message) {
  // Show visual toast
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.hidden = false;
  setTimeout(() => toast.hidden = true, 3000);

  // Announce to screen readers
  const announcer = document.getElementById('toast-announcer');
  announcer.textContent = '';
  requestAnimationFrame(() => {
    announcer.textContent = message;
  });
}
```

---

## 14. Table missing headers or scope

```html
<!-- ❌ Before - data table without headers -->
<table>
  <tr><td>Alice</td><td>Engineering</td><td>Senior</td></tr>
  <tr><td>Bob</td><td>Design</td><td>Junior</td></tr>
</table>

<!-- ✅ After - column headers -->
<table>
  <caption>Team members</caption>
  <thead>
    <tr>
      <th scope="col">Name</th>
      <th scope="col">Department</th>
      <th scope="col">Level</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Alice</td>
      <td>Engineering</td>
      <td>Senior</td>
    </tr>
  </tbody>
</table>
```

For complex tables with both row and column headers:
```html
<th scope="row">Row header</th>
<th scope="col">Column header</th>
```

---

## 15. Images of text (charts, infographics)

```html
<!-- ❌ Before - screen reader gets no information -->
<img src="infographic.png" alt="Infographic" />

<!-- ✅ After - Option A: Detailed alt -->
<img src="infographic.png" 
     alt="2024 user growth: 45,000 users in Q1, 62,000 in Q2, 78,000 in Q3, 95,000 in Q4." />

<!-- ✅ After - Option B: Linked long description -->
<figure>
  <img src="infographic.png" alt="2024 user growth infographic. Full data in table below." />
  <figcaption>
    <details>
      <summary>Full data table</summary>
      <table><!-- Full data table --></table>
    </details>
  </figcaption>
</figure>
```

---

## 16. focus outline removed globally

```css
/* ❌ Before - common reset that breaks keyboard accessibility */
* { outline: none; }
*:focus { outline: none; }

/* ✅ After - remove for mouse users only, keep for keyboard */
*:focus:not(:focus-visible) {
  outline: none;
}

*:focus-visible {
  outline: 3px solid #005fcc;
  outline-offset: 2px;
}
```

---

## 17. Lazy-loaded images missing alt

```html
<!-- ❌ Before - alt="" on functional images means "decorative" to screen readers -->
<img 
  src="placeholder.jpg" 
  data-src="product.jpg" 
  alt=""
  class="lazy"
/>

<!-- ✅ After - include meaningful alt from the start -->
<img 
  src="placeholder.jpg"
  data-src="product.jpg"
  alt="Blue leather wallet, front view"
  class="lazy"
/>
```

---

## 18. Custom select/dropdown not keyboard navigable

For custom selects, prefer a native `<select>` styled with CSS over a custom implementation. If a custom implementation is necessary, follow the ARIA Authoring Practices Guide combobox pattern which is complex. Minimal version:

```html
<div class="custom-select">
  <button 
    id="select-btn"
    aria-haspopup="listbox"
    aria-expanded="false"
    aria-labelledby="select-label select-btn"
  >
    <span id="select-label">Choose country</span>
    <span id="selected-value">Select...</span>
  </button>
  
  <ul 
    role="listbox" 
    aria-labelledby="select-label"
    hidden
  >
    <li role="option" aria-selected="false">United Kingdom</li>
    <li role="option" aria-selected="false">France</li>
    <li role="option" aria-selected="true">Germany</li>
  </ul>
</div>
```

Keyboard requirements: `Enter`/`Space` opens, arrow keys move between options, `Enter` selects, `Escape` closes. Home/End move to first/last. Type-ahead search is expected.

Consider using Radix UI, Headless UI, or React Aria — all provide fully accessible implementations.

---

## 19. Sticky header obscuring focused elements (WCAG 2.4.11)

```css
/* ✅ Scroll offset when jumping to anchor/focused elements */
html {
  scroll-padding-top: 80px; /* Match sticky header height */
}

/* Or per element */
#main-content {
  scroll-margin-top: 80px;
}
```

For focus visibility specifically:
```css
:focus-visible {
  scroll-margin-top: 80px; /* Ensure focused element scrolls into view below sticky header */
}
```

---

## 20. Skip link not working for screen reader users

```html
<!-- ✅ Complete skip link implementation -->
<a href="#main-content" class="skip-link">Skip to main content</a>

<header>...</header>
<main id="main-content" tabindex="-1">
  <!-- tabindex="-1" makes it focusable programmatically when skip link activates -->
  ...
</main>
```

```css
.skip-link {
  position: absolute;
  top: -40px;
  left: 8px;
  background: #000000;
  color: #ffffff;
  padding: 8px 16px;
  text-decoration: none;
  font-weight: bold;
  z-index: 9999;
  border-radius: 0 0 4px 4px;
}

.skip-link:focus {
  top: 0;
}
```

The `tabindex="-1"` on `<main>` allows browsers to move focus to it when the skip link is activated, ensuring the next Tab press doesn't go back to the navigation.

---

## The Visually Hidden Utility Class

Required for many of the above patterns:

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

Use for:
- Extra link context ("Read more <span class="visually-hidden">about our returns policy</span>")
- Icon button supplement (`aria-label` is preferred, but this works for translation needs)
- Form labels hidden by design but required for AT
- Skip link text when not focused
- Live region containers

Do NOT use `display:none` or `visibility:hidden` — those hide from AT too.
