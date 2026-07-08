# Design Psychology

Psychological principles that inform good UX decisions. These aren't rules to blindly apply — they're lenses for understanding why designs work or fail.

---

## Evidence-First Cautions

Use psychology principles as diagnostic hypotheses, not proof.

- Start with observed behaviour, task context, and user goals
- Treat thresholds and named laws as defaults to test, not universal rules
- When evidence conflicts with a principle, trust the evidence and investigate why
- Do not optimise one principle in isolation; good UX balances clarity, control, trust, accessibility, and business constraints
- Document whether a recommendation comes from research, analytics, accessibility requirements, domain convention, or expert judgement

---

## Laws of UX

These "laws" describe tendencies. They help spot likely problems, but they do not decide the design by themselves.

### Hick's Law

> The time to make a decision increases logarithmically with the number of options.

**In practice:**

- Decision time tends to increase with the number and complexity of choices.
- Grouping, recommendation, familiar labels, and task context can make larger
  sets usable.
- This applies to navigation menus, settings pages, product listings, form
  dropdowns, and any point where users must compare options.

**Design applications:**

- **Progressive disclosure**: Show the most relevant options first, reveal more
  on demand
- **Smart defaults**: Pre-select the most common option
- **Categorisation**: Group options by the user's decision, not the database
- **Search/filtering**: Offer it when scanning becomes slow or error-prone

**Common mistake:** Hiding complexity in the name of simplicity. Users need the right transparency at the right time: enough context to decide, without every option competing at once.

### Fitts's Law

> The time to reach a target is a function of target size and distance.

**In practice:**

- Bigger targets are faster to hit
- Closer targets are faster to reach
- Corners and edges of screens are effectively infinite size (cursor stops there)

**Design applications:**

- **Primary actions**: Large buttons, prominent placement
- **Touch targets**: WCAG 2.2 AA uses a 24x24 CSS pixel minimum with exceptions;
  44/48-ish targets are better comfort targets where layout allows. Use an
  accessibility skill for exact conformance work.
- **Mobile**: Consider reach zones for frequent primary actions
- **Destructive actions**: Smaller and further from primary actions
- **Toolbar grouping**: Related actions close together

**Thumb zone (mobile):**

```text
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

Do not force every primary action into the bottom third. Device size, grip,
handedness, scroll position, and task context vary. Use reachable controls,
adequate spacing, and sticky actions only when they do not obscure content or
recovery.

### Miller's Law

> Working memory holds approximately 7 (±2) items.

**In practice:**

- People can hold only a few chunks in working memory at once.
- Later research often points closer to 3-5 chunks, depending on context.
- The UX implication is to reduce memory dependence, not to cap every visible
  menu or process at seven items.

**Design applications:**

- **Chunking**: Break long numbers (1234567890 → 123 456 7890)
- **Visual grouping**: Use whitespace and borders to create chunks
- **Wizard patterns**: Break long or risky forms when grouping reduces effort or
  gives reassurance
- **Navigation**: Test findability and comprehension instead of applying a fixed
  item count

**Common mistake:** Using Miller's Law as a hard rule. It's about cognitive chunks, not a literal count. Five complex items can be harder than eight simple ones.

### Peak-End Rule

> People judge experiences by the peak (most intense moment) and the end, not the average.

**In practice:**

- Peaks and endings disproportionately shape remembered experience.
- A confusing or harmful ending can undermine an otherwise smooth flow.
- A positive ending does not excuse avoidable pain, task failure, or loss of
  trust.

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

### Response Time and the Doherty Threshold

> Fast feedback supports flow; delayed feedback requires expectation-setting.

**In practice:**

- Around 100ms feels directly connected to the user's action.
- Around 1 second keeps the user's flow if feedback is clear.
- Longer waits need progress, explanation, or a recovery path, especially when
  the operation is risky.

**Design applications:**

- **Optimistic UI**: Update the interface before the server confirms
- **Skeleton screens**: Show layout immediately, fill in data
- **Progress indicators**: When progress is measurable or the task has clear
  stages
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
- Eliminate deliberately. This is the designer's primary responsibility.

**Germane load**: Effort spent building understanding.

- Learning how the interface works. Forming mental models.
- Support with: consistent patterns, clear feedback, progressive complexity.

### Cautions

- "Reduce cognitive load" means remove unnecessary effort, not remove necessary information
- Some load is useful when users need to compare, learn, verify, or feel in control
- Dense expert interfaces can be appropriate when structure, labels, and shortcuts match the user's mental model
- Measure load through behaviour: hesitation, errors, rereading, backtracking, abandoned flows, support contacts
- Do not use cognitive load as a veto against transparency, accessibility text, safety checks, or domain complexity users must understand

### Reducing Extraneous Load

**Content:**

- Remove words that don't add meaning
- Use plain language: familiar words, short sentences, clear headings, and
  explained terms. For public services, a lower reading-age benchmark may be
  appropriate, but user-tested comprehension matters more than a raw score.
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

**People often scan before reading**, especially when they are goal-oriented. (Steve Krug, "Don't Make Me Think")

**Scanning patterns:** Users scan according to task, layout, language direction,
information scent, and content structure. The F-pattern is common on weakly
structured, text-heavy pages, but it is only one pattern.

- Use headings, summaries, lists, and visual hierarchy as scanning anchors
- Front-load labels and headings with the words users seek
- Group related content so users can inspect chunks without reading everything

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
| Users say "it feels slow" | Response timing, missing feedback, or cognitive load? |
| Users say "it's confusing" | Mental model mismatch. Their model does not match your model. |

---

## Source Anchors

- Hick's Law and long menus: Nielsen Norman Group, "Hick's Law: Making the choice easier for users".
- Fitts's Law and touch targets: W3C WCAG 2.2 target-size guidance; Nielsen Norman Group touch-target guidance.
- Miller's Law: George Miller, "The Magical Number Seven, Plus or Minus Two"; Nelson Cowan, "The magical number 4 in short-term memory"; Nielsen Norman Group commentary on the UX myth.
- Peak-End Rule: Daniel Kahneman and later UX summaries from Nielsen Norman Group.
- Response-time thresholds: Jakob Nielsen, "Response Times: The 3 Important Limits".
- Scanning patterns: Nielsen Norman Group eye-tracking work on F-pattern, layer-cake, spotted, and commitment patterns.
- Cognitive load: John Sweller's cognitive load theory; apply here as a diagnostic lens, not a single-cause explanation.
