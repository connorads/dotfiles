# Heuristics & Design Principles

Quick reference for established evaluation frameworks.

---

## Nielsen's 10 Usability Heuristics

Use these to evaluate existing designs. For each violation, rate severity (1-4).

### 1. Visibility of System Status

The system should keep users informed about what's happening through appropriate feedback within reasonable time.

**Check:** Does the user always know what's happening? Loading states, progress indicators, success/error feedback.

### 2. Match Between System and Real World

Use language, concepts, and conventions familiar to the user, not system-oriented terms.

**Check:** Would a non-technical user understand every label, message, and instruction?

### 3. User Control and Freedom

Provide undo, redo, and clear "emergency exits" from unwanted states.

**Check:** Can users easily back out, undo, or cancel? Is there always a way out?

### 4. Consistency and Standards

Follow platform conventions. Same words and actions should mean the same thing throughout.

**Check:** Are labels, icons, and interactions consistent? Does it follow platform conventions?

### 5. Error Prevention

Design to prevent errors before they happen. Eliminate error-prone conditions or present confirmation.

**Check:** Does the design prevent common mistakes? Are destructive actions confirmed?

### 6. Recognition Rather Than Recall

Minimise memory load. Make objects, actions, and options visible.

**Check:** Can users see what they need, or do they have to remember it?

### 7. Flexibility and Efficiency of Use

Provide shortcuts for expert users without confusing novices.

**Check:** Are there accelerators (keyboard shortcuts, recent items, defaults) for power users?

### 8. Aesthetic and Minimalist Design

Every piece of information competes for attention. Remove what doesn't serve the user's task.

**Check:** Does every element on screen earn its place? Is there visual noise?

### 9. Help Users Recognise, Diagnose, and Recover from Errors

Error messages should be in plain language, indicate the problem precisely, and suggest a solution.

**Check:** Are error messages human-readable with clear next steps?

### 10. Help and Documentation

Ideally the system needs no explanation, but provide documentation focused on the user's task.

**Check:** Is help available in context? Is it task-oriented, not feature-oriented?

### Severity Ratings

| Rating | Level | Impact |
|--------|-------|--------|
| **4** | Catastrophic | Blocks users from completing their goal |
| **3** | Major | Significant friction; users may give up |
| **2** | Minor | Annoying but users find workarounds |
| **1** | Cosmetic | Polish issue; fix when convenient |

---

## Norman's Design Principles

From Don Norman's "The Design of Everyday Things":

### Affordances

Properties that suggest how something can be used.
- A button affords pressing. A slider affords sliding.
- Digital affordances: raised appearance → clickable. Underlined text → link.
- **Check:** Does the element visually suggest its function?

### Signifiers

Signals that indicate where actions should take place.
- A door handle is a signifier (push/pull direction). A placeholder is a signifier.
- **Check:** Is it clear where to click, tap, or type?

### Mapping

Relationship between controls and their effects.
- Light switch position maps to on/off. Slider left-right maps to less-more.
- **Check:** Is the relationship between action and outcome intuitive?

### Feedback

Information about the result of an action.
- Button press → visual change. Form submit → success message.
- Feedback must be immediate, informative, and proportional.
- **Check:** Does every action produce visible feedback?

### Constraints

Limitations that guide correct use.
- Greyed-out buttons prevent invalid actions. Date pickers prevent invalid dates.
- **Check:** Does the design prevent misuse through constraints?

### Conceptual Models

The user's understanding of how the system works.
- Files and folders (desktop metaphor). Shopping cart (e-commerce).
- **Check:** Does the user's mental model match the system model?

---

## Shneiderman's 8 Golden Rules

Quick reference for interface design evaluation:

1. **Strive for consistency** — same actions, terminology, and layout across screens
2. **Cater to universal usability** — accommodate novices and experts
3. **Offer informative feedback** — every action should produce a visible response
4. **Design dialogues to yield closure** — multi-step tasks need clear beginning, middle, end
5. **Prevent errors** — design so errors can't happen, or are easy to recover from
6. **Permit easy reversal of actions** — undo reduces anxiety and encourages exploration
7. **Keep users in control** — they initiate actions, not the system
8. **Reduce short-term memory load** — don't require users to remember info across screens

---

## Heuristic Evaluation Process

### Setup

1. **Define scope** — which screens/flows to evaluate
2. **Select heuristics** — Nielsen's 10 is standard; add Norman's if evaluating interaction quality
3. **Prepare** — walk through the interface as a user first

### Evaluation

For each screen/interaction:
1. Walk through user tasks
2. Compare against each heuristic
3. Note violations with:
   - **Heuristic violated** (which one)
   - **Location** (where in the interface)
   - **Description** (what's wrong)
   - **Severity** (1-4)
   - **Recommendation** (specific fix)

### Reporting

```markdown
## Finding: [Short title]
**Heuristic:** #4 Consistency and Standards
**Severity:** 3 (Major)
**Location:** Settings > Profile page
**Issue:** "Save" button is labelled "Update" on this page but "Save" everywhere else.
**Recommendation:** Use "Save" consistently across all pages.
```

### Tips

- Evaluate independently before discussing with others (avoids groupthink)
- Multiple evaluators catch more issues (3-5 is ideal)
- Focus on problems, not preferences ("I don't like the colour" isn't a heuristic violation)
- Prioritise by severity × frequency
- Include positive findings too — what works well and why
