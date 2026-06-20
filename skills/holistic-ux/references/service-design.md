# Service Design

Designing beyond the screen. Every digital interaction exists within a larger service ecosystem.

---

## Service Blueprints

### What Is a Service Blueprint?

A service blueprint maps the **full service delivery** — what the user sees, what happens behind the scenes, and what systems support it all.

### Structure

```
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
| **Evidence** | Google listing, website | Booking form | Email, SMS | Signage, host | Menu, table | Bill | Review request |
| **Customer** | Search, browse menu | Select date/time/party | Read confirmation | Walk in, give name | Order, eat | Request bill, pay | Rate experience |
| **Frontstage** | Website loads | Availability shown | Auto-email sent | Host greets | Server takes order | POS terminal | Auto-email sent |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Backstage** | SEO, content management | Check table inventory | Email service triggers | Staff notified via tablet | Kitchen receives order | Process payment | CRM tags customer |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Support** | Google Business, hosting | Booking DB | SendGrid, Twilio | Staff scheduling app | POS, kitchen display | Payment processor | CRM, review platform |
```

### When to Use a Service Blueprint

- Designing a **new service** end-to-end
- Finding **failure points** in an existing service
- Understanding **operational impact** of design changes
- Communicating with **non-design stakeholders** (ops, engineering, business)

### How to Build One

1. **Start with customer actions** — walk through the user's journey left to right
2. **Add physical evidence** — what do they see/receive at each point?
3. **Map frontstage** — what visible interactions support each action?
4. **Map backstage** — what invisible work enables the frontstage?
5. **Add support processes** — what systems/tools/services power the backstage?
6. **Identify pain points** — where do things break? Where are the delays?
7. **Mark fail points** — use ⚠ symbols where things commonly go wrong

---

## Jobs to Be Done (JTBD)

### Core Concept

People don't buy products; they **hire** them to make progress in their lives.

> "People don't want a quarter-inch drill bit. They want a quarter-inch hole."
> — Theodore Levitt

> "They don't want the hole either. They want the shelf on the wall. Actually, they want their books organised."
> — Further refinement

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

> When I'm booking a flight and see the total price jump at checkout, I want to understand exactly what changed, so I can decide whether to proceed or go back.

> When I receive an error after filling out a long form, I want to know exactly which field needs fixing without losing my work, so I can complete the task without starting over.

> When I'm comparing subscription plans, I want to see a clear difference between them, so I can pick the right one without second-guessing.

### Applying JTBD to Design

1. **Identify the job** — What progress is the user trying to make?
2. **Map the full job** — Not just the functional task but emotional and social dimensions
3. **Find the struggling moment** — Where is current progress blocked?
4. **Design for the switch** — What would make someone switch from their current solution to yours?

### Forces of Progress

```
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

Design must: amplify push + pull, reduce anxiety + habit.

---

## Ecosystem Mapping

### Stakeholder Map

Before designing, understand who's involved:

```
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

**Journey map**: Focuses on user's emotional experience.
- What are they feeling at each stage?
- Where are the pain points?
- Where are the moments of delight?

**Service blueprint**: Focuses on operational delivery.
- What systems support each interaction?
- Where are the failure points?
- What's the operational cost?

Use journey maps to understand the problem. Use service blueprints to design the solution.

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
