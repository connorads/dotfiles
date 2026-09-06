# Service mapping

Read this for journey maps and service blueprints.

Maps are models of evidence, not containers to fill. Every populated cell needs
a source. Use `Unknown` where the current state is not established, and separate
current state from a proposed future state.

## Journey map

Use a journey map when the decision depends on an evidenced experience over
time. Use one user or evidenced segment, one scenario and a defined start and
end. Do not manufacture a persona to decorate the map.

```markdown
## Journey map: [task and context]

**User or segment:** [source]
**Scenario:** [source]
**Decision supported:**

| Phase | Phase 1 | Phase 2 | Phase 3 |
| --- | --- | --- | --- |
| Doing |  |  |  |
| Thinking |  |  |  |
| Feeling |  |  |  |
| Touchpoint |  |  |  |
| Problem or support |  |  |  |
| Evidence |  |  |  |
| Unknown |  |  |  |
```

Populate thoughts and feelings only from direct participant reports or observed
behaviour whose interpretation is explicitly labelled. An analytics event does
not reveal either. When these rows are unknown, leave them unknown and design
the research that would fill them.

Do not force a universal emotional curve. Compare segments when their evidence
differs instead of producing an average fictional journey.

## Service blueprint

Use a service blueprint when the decision depends on how customer actions
connect to visible delivery, backstage work, support processes, recovery and
ownership.

```markdown
## Current-state service blueprint: [service and journey]

**Decision supported:**
**Evidence base:**

| Layer | Stage 1 | Stage 2 | Stage 3 |
| --- | --- | --- | --- |
| Physical evidence |  |  |  |
| Customer action |  |  |  |
| Frontstage interaction |  |  |  |
| Backstage work |  |  |  |
| Support process or system |  |  |  |
| Failure and recovery |  |  |  |
| Owner |  |  |  |
| Evidence or unknown |  |  |  |
```

The core lane boundaries are:

- **Physical evidence**: what the customer encounters or keeps.
- **Customer action**: what the customer does.
- **Frontstage**: service activity visible to the customer.
- **Backstage**: delivery work hidden from the customer.
- **Support process**: internal or third-party capability enabling delivery.

Add policy, channel, privacy, measurement or assisted-route rows only when the
decision and evidence require them. Never invent a named system, actor or policy
because a complete blueprint would usually contain one.

For each evidenced failure, state who detects it, who can recover it, what the
customer sees and what happens when recovery fails. Mark unowned recovery as an
observed gap only when the evidence establishes that no owner exists.

## Current state and future state

Do not mix them in one table. A current-state map records what evidence says
happens. A future-state map records a proposal and carries a rationale and
measure for each changed stage.

Before proposing a future state:

1. Resolve or expose contradictions between customer and operator accounts.
2. Identify the failure or handoff the change addresses.
3. State the assumption the change relies on.
4. Name the outcome and guardrail that test it.

## Inclusive service access

Map the channels and support routes people actually use, including offline or
assisted routes when evidence establishes them. When an inclusive route is
missing, describe it as a proposal until policy, operations and affected users
have validated it.

Code conformance is one input. Completion also depends on notices, language,
documents, device access, identity rules, deadlines, support and recovery where
those are part of the evidenced journey.
