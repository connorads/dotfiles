# Service Design

## Contents

- Evidence-First Use
- Service Blueprints
  - What Is a Service Blueprint?
  - Structure
  - Example: Restaurant Booking
  - When to Use a Service Blueprint
  - How to Build One
  - Co-Creation, Failure Modes, and Ownership
- Jobs to Be Done (JTBD)
  - Core Concept
  - Three Dimensions of Every Job
  - Job Story Format
  - Applying JTBD to Design
  - JTBD Nuance
  - Forces of Progress
- Ecosystem Mapping
  - Stakeholder Map
  - Touchpoint Inventory
- When to Use What
  - Journey Map vs Experience Map
  - Journey Map vs Service Blueprint
- Service Design Principles
- Source Anchors

Designing beyond the screen. Every digital interaction exists within a larger service ecosystem.

---

## Evidence-First Use

Service maps are hypotheses until grounded in evidence.

- Label each claim: observed, measured, reported, inferred, or assumed
- Keep raw evidence separate from interpretation and recommendations
- Prefer recent task evidence over stakeholder memory when they conflict
- Mark confidence where evidence is thin, then design the next research step
- Do not let a workshop artefact become "truth" without checking it against real operations

For interview or observation-heavy work, use [research-synthesis.md](research-synthesis.md) before turning findings into journeys, jobs, or blueprints.

---

## Service Blueprints

### What Is a Service Blueprint?

A service blueprint maps the **full service delivery** — what the user sees, what happens behind the scenes, and what systems support it all.

### Structure

```text
┌─────────────────────────────────────────────────────────┐
│ PHYSICAL EVIDENCE                                       │
│ (What users see/touch: website, emails, physical items) │
├─────────────────────────────────────────────────────────┤
│ CUSTOMER ACTIONS                                        │
│ (What users do at each stage)                           │
╞═════════════════════════════════════════════════════════╡
│                 Line of Interaction                      │
├─────────────────────────────────────────────────────────┤
│ FRONTSTAGE                                              │
│ (Staff/system interactions users can see)               │
╞═════════════════════════════════════════════════════════╡
│                 Line of Visibility                       │
├─────────────────────────────────────────────────────────┤
│ BACKSTAGE                                               │
│ (Staff/system work users can't see)                     │
╞═════════════════════════════════════════════════════════╡
│                 Line of Internal Interaction             │
├─────────────────────────────────────────────────────────┤
│ SUPPORT PROCESSES                                       │
│ (Systems, databases, third-party services)              │
└─────────────────────────────────────────────────────────┘
```

### Example: Restaurant Booking

```markdown
| Stage | Discover | Book | Confirm | Arrive | Dine | Pay | Follow-up |
|-------|----------|------|---------|--------|------|-----|-----------|
| **Physical evidence** | Google listing, website | Booking form | Email, SMS | Signage, host | Menu, table | Bill | Review request |
| **Customer** | Search, browse menu | Select date/time/party | Read confirmation | Walk in, give name | Order, eat | Request bill, pay | Rate experience |
| **Frontstage** | Website loads | Availability shown | Auto-email sent | Host greets | Server takes order | POS terminal | Auto-email sent |
| **Backstage** | SEO, content management | Check table inventory | Email service triggers | Staff notified via tablet | Kitchen receives order | Process payment | CRM tags customer |
| **Support** | Google Business, hosting | Booking DB | SendGrid, Twilio | Staff scheduling app | POS, kitchen display | Payment processor | CRM, review platform |
```

Use labelled notes for the line of interaction, line of visibility, and line of
internal interaction when they help readers see boundaries. Do not render them as
ambiguous table rows.

### When to Use a Service Blueprint

- Designing a **new service** end-to-end
- Finding **failure points** in an existing service
- Understanding **operational impact** of design changes
- Communicating with **non-design stakeholders** (ops, engineering, business)

### How to Build One

1. **Start with customer actions**: walk through the user's journey left to right
2. **Co-create with operators**: include support, ops, engineering, policy, and third parties
3. **Add physical evidence**: what do users see, receive, or keep at each point?
4. **Map frontstage**: what visible interactions support each action?
5. **Map backstage**: what invisible work enables the frontstage?
6. **Add support processes**: what systems/tools/services power the backstage?
7. **Identify pain points**: where do things break? Where are the delays?
8. **Mark fail points**: capture trigger, detection signal, user impact, recovery path, owner

Add optional rows when they materially affect delivery:

- **Channel**: web, mobile, email, SMS, phone, in-person, paper, or partner route
- **Assisted/offline route**: how someone completes the service without using the
  primary digital path alone
- **Policy/legal constraint**: eligibility, deadlines, refund rules, consent,
  retention, or regulatory limits
- **Privacy/security risk**: sensitive data, identity checks, data sharing, or
  account access risk
- **Measurement**: success measure, guardrail, instrumentation gap, or signal
  that would change the recommendation

### Co-Creation, Failure Modes, and Ownership

- Build blueprints with the people who deliver the service, not only product/design
- Treat disagreements as evidence gaps: check logs, tickets, call recordings, or observed work
- Assign an owner for each touchpoint, backstage step, support process, and recovery path
- For each fail point, define who notices, who can fix it, who tells the user, and what happens if recovery fails
- Include operational constraints: staffing, SLAs, legal/policy limits, system latency, batch jobs, vendor dependencies
- Review the blueprint after launch; ownership and failure modes drift as teams and systems change

---

## Jobs to Be Done (JTBD)

### Core Concept

People often **hire** products or services to make progress in a specific situation.

JTBD is a lens for understanding progress. It does not replace segmentation, personas, analytics, accessibility work, or usability findings.

Quote: "People don't want a quarter-inch drill bit. They want a quarter-inch hole." - Theodore Levitt

Refinement: "They don't want the hole either. They want the shelf on the wall. Actually, they want their books organised."

### Three Dimensions of Every Job

| Dimension | What it means | Example: Choosing a restaurant |
|-----------|---------------|-------------------------------|
| **Functional** | The practical task | Find food near my location |
| **Emotional** | How I want to feel | Feel like I'm making a good choice |
| **Social** | How others perceive me | Impress my date |

### Job Story Format

Better than user stories for UX because they focus on **situation** rather than persona:

> When [situation], I want to [motivation], so I can [expected outcome].

**Examples:**

- When I'm booking a flight and see the total price jump at checkout, I want to
  understand exactly what changed, so I can decide whether to proceed or go
  back.
- When I receive an error after filling out a long form, I want to know exactly
  which field needs fixing without losing my work, so I can complete the task
  without starting over.
- When I'm comparing subscription plans, I want to see a clear difference
  between them, so I can pick the right one without second-guessing.

### Applying JTBD to Design

1. **Identify the job**: What progress is the user trying to make?
2. **Map the full job**: Not just the functional task but emotional and social dimensions
3. **Find the struggling moment**: Where is current progress blocked?
4. **Study current alternatives**: What workaround, competitor, spreadsheet, person, or habit do they use today?
5. **Design for the switch**: What would make someone trust a new solution enough to change?

### JTBD Nuance

- A job is not a feature request, persona, task, or market segment
- The same person can have different jobs in different situations
- Different people can share a job but need different interfaces, language, or support
- Progress can mean reducing risk, avoiding embarrassment, staying compliant, or keeping things the same
- Validate jobs with behaviour: switching stories, workarounds, purchase/support data, and observed struggle
- Pair each job statement with source evidence and confidence; do not invent jobs from stakeholder preference alone

### Forces of Progress

```text
                    ┌────────────────────┐
  Push of current   │                    │  Pull of new
  situation         │     SWITCHING      │  solution
  ──────────►      │     DECISION       │  ◄──────────
                    │                    │
  Anxiety of new    │                    │  Habit of current
  solution          │                    │  solution
  ◄──────────      └────────────────────┘  ──────────►
```

- **Push**: Pain with current situation (motivation to change)
- **Pull**: Attraction of new solution (what draws them)
- **Anxiety**: Fear of the new (what stops them)
- **Habit**: Comfort of the familiar (inertia)

Design usually works by strengthening push/pull while reducing anxiety and habit. If the evidence shows users value stability more than change, design for confidence rather than persuasion.

---

## Ecosystem Mapping

### Stakeholder Map

Before designing, understand who's involved:

```text
                    ┌──────────┐
                    │  End User │
                    └────┬─────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
        ┌─────┴─────┐ ┌─┴────┐ ┌──┴─────┐
        │ Customer   │ │ Admin│ │ Support│
        │ Success    │ │      │ │  Agent │
        └─────┬─────┘ └──┬───┘ └──┬─────┘
              │          │        │
              └──────────┼────────┘
                         │
                    ┌────┴─────┐
                    │ Business │
                    │ Owner    │
                    └──────────┘
```

For each stakeholder ask:

- What's their goal?
- What do they need from this service?
- How do they interact with other stakeholders?
- What constraints do they impose?

### Touchpoint Inventory

List every point of contact between user and service:

| Touchpoint | Channel | Owner | Quality |
|------------|---------|-------|---------|
| Google search result | Web | Marketing | Good |
| Landing page | Web | Product | Needs work |
| Sign-up email | Email | Growth | Good |
| Onboarding wizard | App | Product | Poor |
| First support ticket | Chat | Support | Good |
| Monthly invoice | Email | Billing | Poor |
| Cancellation flow | App | Product | Missing |

**Look for:**

- Gaps (missing touchpoints)
- Inconsistencies (different tone/quality across touchpoints)
- Handoff failures (one team's touchpoint clashes with another's)

---

## When to Use What

| Tool | Best for | Scope |
|------|----------|-------|
| **User Flow** | Single task completion | One user, one goal |
| **Journey Map** | Understanding emotional experience | One user, one scenario, over time |
| **Experience Map** | Understanding behaviour in a domain (no specific product) | One persona, broad context |
| **Service Blueprint** | Designing/fixing service delivery | Full system including backstage |
| **Ecosystem Map** | Understanding stakeholder relationships | Multiple actors and their connections |

### Journey Map vs Experience Map

**Journey map**: How does a user experience *our product/service*?

- Has specific stages related to our service
- Includes our touchpoints
- Helps improve our experience

**Experience map**: How does a person experience *this domain* in general?

- Not tied to our product
- Includes competitor and offline touchpoints
- Helps find opportunities

### Journey Map vs Service Blueprint

**Journey map**: Foregrounds the user's experience over time.

- What are they feeling at each stage?
- Where are the pain points?
- Where are the moments of delight?

**Service blueprint**: Foregrounds operational delivery.

- What systems support each interaction?
- Where are the failure points?
- What's the operational cost?

Use journey maps and blueprints as companion lenses. A journey map is usually
better when emotions, expectations, and cross-touchpoint perception matter most.
A blueprint is usually better when the decision depends on backstage
dependencies, ownership, policy, channels, support, or failure recovery. Both can
be used diagnostically and both should be revised as evidence changes.

---

## Service Design Principles

1. **Human-centred**: Start with people, not technology
2. **Collaborative**: Include all stakeholders in the design process
3. **Iterative**: Expect to get it wrong and improve
4. **Sequential**: Visualise the service as a sequence of interrelated actions
5. **Real**: Prototype with real-world conditions, not just screens
6. **Holistic**: Consider the complete environment of the service

> "A service is a chain of activities that form a process and have value for the end user."
> — If one link in the chain breaks, the experience breaks regardless of how good the UI is.

---

## Source Anchors

- Service blueprint lanes: Lynn Shostack's service blueprinting work and Nielsen Norman Group service blueprint guidance.
- Service design principles: Marc Stickdorn and Jakob Schneider, *This is Service Design Thinking* and *This is Service Design Doing*.
- JTBD and forces of progress: Clayton Christensen, Bob Moesta, Tony Ulwick, and the Job Stories format from Intercom/JTBD Toolkit.
- Public-service access and assisted routes: GOV.UK Service Manual and Service Standard.
