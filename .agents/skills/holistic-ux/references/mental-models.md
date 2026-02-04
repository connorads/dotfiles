# Mental Models & Systems Thinking

Deep-dive reference for the thinking frameworks in SKILL.md.

---

## The Iceberg Model

Most design problems surface as events (what happened). Effective design addresses deeper levels.

### Level 1: Events (Surface)

What we observe. Symptoms, metrics, complaints.

| Event | Tempting Fix |
|-------|-------------|
| Users abandon checkout at step 3 | Redesign step 3 |
| Support tickets spike after release | Add FAQ page |
| Users can't find settings | Make settings icon bigger |

Events are where stakeholders start conversations. Don't stop here.

### Level 2: Patterns (Trends)

What recurs over time. Trends, correlations, repeated behaviours.

| Event | Pattern |
|-------|---------|
| Abandonment at step 3 | Always on mobile, always address entry |
| Support ticket spike | Spikes follow every release, same confusion |
| Can't find settings | New users only; power users know the path |

Patterns reveal whether this is isolated or systemic.

### Level 3: Structures (Systems)

What enables the patterns. Processes, architectures, incentive structures.

| Pattern | Structure |
|---------|-----------|
| Mobile address entry fails | Form was designed for desktop; mobile keyboard covers input fields |
| Every release causes confusion | No onboarding update process when features change |
| New users get lost | IA designed by engineering teams, maps to codebase not mental model |

Structures are where design interventions have lasting impact.

### Level 4: Mental Models (Assumptions)

What beliefs created the structures. Organisational assumptions, cultural norms.

| Structure | Mental Model |
|-----------|-------------|
| Desktop-first forms | "Most users are on desktop" (2015 assumption, now wrong) |
| No onboarding updates | "Users will figure it out" (engineer's curse of knowledge) |
| Engineering-driven IA | "Logical structure = usable structure" |

Changing mental models is the hardest but most impactful intervention.

### Applying the Iceberg

When handed a design problem:
1. **Name the event** — What specifically happened?
2. **Find the pattern** — Has this happened before? Under what conditions?
3. **Identify the structure** — What system enables this?
4. **Examine the assumption** — Why was it built this way?

Then decide: Do you need a quick fix (event level) or a systemic change (structure level)?

---

## Cynefin Framework for Design

Developed by Dave Snowden. Helps match your approach to the type of problem.

### Clear (formerly "Obvious")

**Characteristics:** Cause and effect obvious. Best practices exist.
**Approach:** Sense → Categorise → Respond

**UX examples:**
- Button placement for conversion optimisation
- Standard form layouts
- Applying an existing design system

**What to do:** Apply known patterns. Don't reinvent. Use UI pattern libraries and accessibility checklists.

### Complicated

**Characteristics:** Cause and effect discoverable with expertise. Multiple valid solutions.
**Approach:** Sense → Analyse → Respond

**UX examples:**
- Information architecture restructure
- Complex dashboard design
- Multi-step onboarding flow

**What to do:** Research first. Card sorts, user interviews, competitive analysis. Analyse, then design.

### Complex

**Characteristics:** Cause and effect only visible in retrospect. Emergent behaviour.
**Approach:** Probe → Sense → Respond

**UX examples:**
- "Why don't users trust our brand?"
- "How should we enter a new market?"
- "Why is engagement declining despite good usability metrics?"

**What to do:** Run safe experiments. Prototype and test. Look for patterns that emerge. Don't try to plan your way to certainty.

### Chaotic

**Characteristics:** No discernible cause and effect. Urgent.
**Approach:** Act → Sense → Respond

**UX examples:**
- Production outage with user impact
- Security breach affecting user data
- Critical accessibility lawsuit

**What to do:** Stabilise first. Fix the immediate problem. Learn from it later.

### The Disorder Zone

When you don't know which domain you're in, you're in disorder. The danger is applying your favourite approach regardless.

**Common mistakes:**
- Treating complex problems as complicated (over-planning)
- Treating complicated problems as clear (under-researching)
- Treating clear problems as complex (over-thinking)

---

## Systems Thinking Concepts

### Feedback Loops

**Reinforcing (positive) loops** amplify change:
```
Good reviews → More users → More reviews → Even more users
```
Design implication: Identify virtuous cycles and design to strengthen them.

**Balancing (negative) loops** resist change:
```
More features → More complexity → Harder to use → Fewer users → Demand for simplicity
```
Design implication: Feature creep has natural consequences. Design constraints are a feature.

### Leverage Points

Small changes with big effects. Donella Meadows' hierarchy (simplified for UX):

1. **Paradigm** (most powerful): Changing what the organisation believes about users
2. **Goals**: Changing success metrics from "engagement" to "task completion"
3. **Rules**: Changing what's allowed (e.g., "no feature ships without accessibility audit")
4. **Information flow**: Making user pain visible to decision-makers
5. **Parameters** (least powerful): Changing a button colour

Most UX work happens at the parameter level. The biggest impact is at the information flow and goals level.

### Conway's Law

> Organisations design systems that mirror their communication structures.

**Implication for UX:** If the billing team and account team don't talk to each other, the user will experience a disjointed billing-to-account flow. You can redesign the interface all you like — the seams will reappear unless the org changes.

**When you spot a UX seam:** Ask whether it mirrors an organisational boundary. If so, the fix is coordination, not just design.

### Second-Order Effects

Every design decision has consequences beyond the immediate:

| Decision | First-order effect | Second-order effect |
|----------|-------------------|---------------------|
| Add social login | Easier registration | Less control over user data |
| Gamify with points | Higher engagement | Users game the system |
| Auto-play videos | More views | User annoyance, accessibility issues |
| Infinite scroll | More time on site | Harder to find specific content |

**Before committing to a design:** Ask "and then what?" at least twice.

---

## Applying These Models Together

**Example: "Users aren't completing onboarding"**

1. **Iceberg:** Event (drop-off at step 4) → Pattern (happens with enterprise users) → Structure (onboarding assumes individual use, not team setup) → Mental model ("users are individuals")

2. **Cynefin:** This is complicated (multiple valid approaches, needs analysis). Don't just A/B test step 4 — that treats it as clear.

3. **Systems:** The enterprise sales team promises "easy setup" → Creates expectations that onboarding can't meet → This is a feedback loop between sales and product.

4. **Leverage point:** Not in the UI. In the information flow between sales and product teams about what "easy" means.

**The right design intervention:** Might be a different onboarding path for enterprise, or it might be changing what sales promises. Either way, the answer wasn't "make step 4 better."
