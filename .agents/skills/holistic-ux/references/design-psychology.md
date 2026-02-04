# Design Psychology

Psychological principles that inform good UX decisions. These aren't rules to blindly apply — they're lenses for understanding why designs work or fail.

---

## Laws of UX

### Hick's Law

> The time to make a decision increases logarithmically with the number of options.

**In practice:**
- 2 options: nearly instant. 10 options: significantly slower. 50 options: paralysis.
- This applies to navigation menus, settings pages, product listings, form dropdowns.

**Design applications:**
- **Progressive disclosure**: Show 4-6 items, reveal more on demand
- **Smart defaults**: Pre-select the most common option
- **Categorisation**: Group 20 options into 4 categories of 5
- **Search**: When options exceed ~15, offer search instead of scanning

**Common mistake:** Showing everything "for transparency." Users don't want transparency; they want to accomplish their goal. Show what's relevant.

### Fitts's Law

> The time to reach a target is a function of target size and distance.

**In practice:**
- Bigger targets are faster to hit
- Closer targets are faster to reach
- Corners and edges of screens are effectively infinite size (cursor stops there)

**Design applications:**
- **Primary actions**: Large buttons, prominent placement
- **Touch targets**: Minimum 44×44px (WCAG), ideally 48×48px
- **Mobile**: Place key actions within thumb reach zone
- **Destructive actions**: Smaller and further from primary actions
- **Toolbar grouping**: Related actions close together

**Thumb zone (mobile):**
```
┌─────────────┐
│  Hard to     │
│  reach       │
│             │
│  Comfortable │
│  zone        │
│             │
│  Easy to     │
│  reach       │
└─────────────┘
```

Place primary actions in the bottom third of mobile screens.

### Miller's Law

> Working memory holds approximately 7 (±2) items.

**In practice:**
- People can process ~4-7 distinct chunks simultaneously
- More recent research suggests the effective limit is closer to 4
- This applies to navigation items, steps in a process, items in a list before grouping

**Design applications:**
- **Chunking**: Break long numbers (1234567890 → 123 456 7890)
- **Visual grouping**: Use whitespace and borders to create chunks
- **Wizard patterns**: Break 15-field forms into 3-5 steps
- **Navigation**: Keep top-level items to 5-7

**Common mistake:** Using Miller's Law as a hard rule. It's about cognitive chunks, not a literal count. Five complex items can be harder than eight simple ones.

### Peak-End Rule

> People judge experiences by the peak (most intense moment) and the end, not the average.

**In practice:**
- A terrible 2-minute wait followed by a delightful confirmation = "good experience"
- A smooth process with a confusing final step = "frustrating experience"

**Design applications:**
- **Design the peak**: What's the emotional high point? Make it memorable.
- **End well**: Confirmation screens, success messages, "what's next" guidance
- **Error recovery**: If something goes wrong, the recovery experience IS the experience
- **Onboarding**: The first completed action should feel rewarding

**Examples:**
- Mailchimp's "high five" after sending a campaign (positive peak)
- Smooth payment → confusing delivery status (bad ending ruins it)
- Hard sign-up → instant "aha moment" in product (peak redeems the pain)

### Jakob's Law

> Users spend most of their time on other websites/apps. They expect yours to work the same way.

**In practice:**
- Users bring expectations from every other digital product they use
- Breaking conventions creates friction, even if your way is "objectively better"
- This is why design consistency across an industry matters

**Design applications:**
- **Navigation**: Top bar or hamburger. Users know where to look.
- **E-commerce**: Cart icon top-right. Product grid. Filters on left.
- **Forms**: Labels above inputs. Submit button at bottom.
- **Search**: Magnifying glass icon. Top of page.

**When to break conventions:** Only when the convention actively hurts your users, and you can teach the new pattern quickly. Breaking conventions requires extra investment in discoverability.

### Aesthetic-Usability Effect

> Users perceive aesthetically pleasing designs as more usable.

**In practice:**
- Beautiful interfaces are given more patience during problems
- Users blame themselves for errors in attractive UIs ("I must have done something wrong")
- Users blame the system for errors in ugly UIs ("This thing is broken")

**Design applications:**
- Visual polish creates a trust buffer
- But aesthetics can't paper over fundamental usability problems
- Invest in visual design last, after core interactions work
- Consider it a form of emotional accessibility

**Caution:** Don't use this as an excuse to ship pretty but unusable products. The effect buys tolerance, not satisfaction.

### Doherty Threshold

> Productivity increases when response time is under 400ms.

**In practice:**
- Under 100ms: feels instantaneous
- 100-400ms: feels responsive
- Over 1000ms: user attention wanders

**Design applications:**
- **Optimistic UI**: Update the interface before the server confirms
- **Skeleton screens**: Show layout immediately, fill in data
- **Progress indicators**: For anything over 1 second
- **Chunked loading**: Load visible content first

### Von Restorff Effect (Isolation Effect)

> Items that stand out from their surroundings are more memorable.

**Design applications:**
- **CTAs**: Primary buttons should visually contrast with everything else
- **Pricing tables**: Highlight the recommended plan
- **Warnings**: Use colour and icons to distinguish from regular content
- **Onboarding**: Highlight new features distinctly

---

## Cognitive Load Theory

### Three Types of Cognitive Load

**Intrinsic load**: Inherent complexity of the task itself.
- Filing taxes is inherently complex. Can't simplify the tax code.
- Support with: scaffolding, examples, tooltips, contextual help.

**Extraneous load**: Complexity added by poor design.
- Confusing navigation, unclear labels, unnecessary animation, inconsistent patterns.
- Eliminate ruthlessly. This is the designer's primary responsibility.

**Germane load**: Effort spent building understanding.
- Learning how the interface works. Forming mental models.
- Support with: consistent patterns, clear feedback, progressive complexity.

### Reducing Extraneous Load

**Content:**
- Remove words that don't add meaning
- Use plain language (reading age 12-14)
- Front-load important information

**Visual:**
- Remove decorative elements that don't guide attention
- Use whitespace to create visual hierarchy
- Limit colour palette to functional uses

**Interaction:**
- Reduce steps to complete tasks
- Eliminate redundant confirmations
- Pre-fill what you already know

**Navigation:**
- Clear current location (breadcrumbs, active states)
- Predictable back button behaviour
- Consistent menu structure across pages

### Attention and Scanning

**People don't read; they scan.** (Steve Krug, "Don't Make Me Think")

**F-pattern scanning:** Users scan left-to-right, then down the left edge.
- Place important content top-left
- Use headings as scanning anchors
- Left-align key information

**Visual hierarchy drives scanning order:**
1. Large, high-contrast elements (headlines)
2. Images (especially faces)
3. Colour blocks (buttons, alerts)
4. Body text (only if the above caught interest)

---

## Krug's Principles

From Steve Krug's "Don't Make Me Think":

### People Satisfice

Users don't pick the best option; they pick the **first reasonable option**. This means:
- The optimal layout doesn't matter if users leave at a "good enough" option
- Clear labels are more important than clever ones
- Obvious paths beat optimal paths

### People Don't Figure Out How Things Work

Users muddle through. They find something that works and stick with it, even if it's not the intended path. This means:
- Design for the actual behaviour, not the intended behaviour
- If people misuse a feature consistently, the feature is wrong
- "The user is always right" (about what they're trying to do, not how)

### Get Rid of Half the Words, Then Get Rid of Half of What's Left

Every word competes for attention. Less text = more of it gets read.
- Instructions that nobody reads don't exist
- Error messages should be 1-2 sentences max
- If you need a paragraph to explain something, simplify the thing

---

## Emotional Design (Don Norman)

### Three Levels of Processing

**Visceral** (automatic, immediate):
- First impression of visual design
- Snap judgements about trustworthiness
- "Does this look professional?"

**Behavioural** (subconscious, during use):
- Does it work as expected?
- Is the feedback clear?
- Does interaction feel smooth?

**Reflective** (conscious, after use):
- How do I feel about using this?
- Would I recommend it?
- Does it align with my self-image?

**Design across all three:**
- Visceral: Clean, professional visual design
- Behavioural: Responsive, predictable interactions
- Reflective: Brand alignment, storytelling, social proof

---

## Decision-Making in Practice

When reviewing a design, use these as diagnostic questions:

| If you observe... | Consider... |
|-------------------|-------------|
| Users hesitate | Hick's Law — too many choices? |
| Users miss the CTA | Fitts's Law — too small/far? Von Restorff — doesn't stand out? |
| Users make errors | Extraneous cognitive load? Unclear labels? |
| Users don't complete flows | Peak-End — is the ending bad? Steps too many (Miller's)? |
| Users use workarounds | Jakob's Law — breaking conventions? |
| Users say "it feels slow" | Doherty Threshold — above 400ms? Or cognitive load (feels slow)? |
| Users say "it's confusing" | Mental model mismatch. Their model ≠ your model. |
