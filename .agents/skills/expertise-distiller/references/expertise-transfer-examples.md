# Expertise Transfer: Before & After Examples

This reference shows the difference between instruction-following and expertise transfer.

## Example 1: SQL Query Skill

### ❌ Instruction-Following Approach

```markdown
## How to Write Queries

1. First, identify the tables you need
2. Then, write the SELECT statement
3. Add appropriate JOINs
4. Include WHERE clauses for filtering
5. Don't forget to add GROUP BY if aggregating
6. Review the query for correctness
```

**Problems:**
- Reads like a checklist, not expertise
- Claude already knows SQL syntax
- Doesn't teach *when* or *why*
- Wastes tokens on process narration

### ✅ Expertise Transfer Approach

```markdown
## Query Design Principles

**Start from the answer:** What question does this query answer? Write the SELECT first.

**Join economics:** Avoid many-to-many joins - they explode row counts. If unavoidable, aggregate before joining.

**Filter early:** Push WHERE conditions into subqueries when possible. Don't filter 1M rows when you can filter 10K.

**For performance:** 
- Indexes: Filter columns, JOIN keys
- No wildcards: `SELECT *` forces Claude to read all columns
- Prefer EXISTS over IN for correlated subqueries

Example:
\`\`\`sql
-- Efficient: Filter early, aggregate, then join
SELECT u.name, COUNT(o.id) 
FROM users u
LEFT JOIN (SELECT * FROM orders WHERE status = 'complete') o
  ON u.id = o.user_id
GROUP BY u.name;
\`\`\`
```

**Why it works:**
- Teaches mental models ("join economics", "filter early")
- Focuses on non-obvious knowledge
- Includes the "why" behind practices
- Expert would recognize this thinking

---

## Example 2: Document Formatting Skill

### ❌ Instruction-Following Approach

```markdown
## Formatting Documents

You should format documents as follows:
1. Start with a title
2. Add section headers
3. Make sure to use bullet points for lists
4. Remember to check spelling
5. Ensure consistent spacing
6. Don't forget page numbers
```

**Problems:**
- Patronizing (Claude knows what a title is)
- No decision guidance
- Assumes Claude needs reminding
- Sounds like AI talking to itself

### ✅ Expertise Transfer Approach

```markdown
## Document Structure

Match structure to purpose:

**Persuasive (proposals, pitches):**
- Lead with conclusion, not methodology
- One idea per paragraph
- Bold for emphasis, not decoration

**Reference (documentation, reports):**
- Hierarchy reveals relationships
- Parallel structure for scanability
- Link terms to definitions on first use

**Quality signals:**
- White space creates hierarchy
- Consistent indentation = consistent meaning
- Numbers for sequences, bullets for sets

Example transformation:
\`\`\`
Bad: "We should do X because of Y and Z which relates to A..."
Good: "Recommendation: Do X. [paragraph] Supporting data: Y shows... Z indicates..."
\`\`\`
```

**Why it works:**
- Teaches document *thinking*, not mechanics
- Contextual guidance (persuasive vs. reference)
- Shows good/bad without being prescriptive
- Practitioner would recognize these patterns

---

## Example 3: Code Review Skill

### ❌ Instruction-Following Approach

```markdown
## Code Review Process

Follow these steps:
1. Read through the code
2. Check for syntax errors
3. Look for logic errors
4. Verify naming conventions
5. Ensure proper comments
6. Test edge cases
7. Provide feedback
```

**Problems:**
- Generic advice (what junior reviewers do)
- No prioritization
- Doesn't teach risk assessment
- Mechanical, not thoughtful

### ✅ Expertise Transfer Approach

```markdown
## Code Review Heuristics

**Risk-based scanning:**

High impact areas (scan first):
- Auth/permissions logic
- Data persistence/transactions
- Error handling in critical paths

Low impact areas (scan last):
- Styling choices
- Minor refactors
- Comment quality

**Red flags by category:**

*Logic:*
- Mutations during iteration
- Silent failures (empty catches)
- Implicit type conversions

*Maintainability:*
- Nested ternaries (rewrite as if/else)
- Magic numbers without constants
- Function names that don't match behavior

**Feedback framing:**

Risk: "This could cause X if Y" (not "this is wrong")
Suggestion: "Consider Z pattern for clarity" (not "do Z")
Nitpick: "(nitpick) Style preference: ..." (label low-priority items)
```

**Why it works:**
- Prioritization framework (risk-based)
- Specific red flags, not generic advice
- Includes social aspects (feedback framing)
- Senior engineer would recognize this approach

---

## Pattern Recognition: What Makes Expertise Transfer?

| Element | Instruction-Following | Expertise Transfer |
|---------|----------------------|-------------------|
| **Focus** | Steps to execute | Mental models to apply |
| **Language** | "You should", "Don't forget" | "Consider", "When X, typically Y" |
| **Knowledge** | Generic/obvious | Domain-specific/non-obvious |
| **Tone** | Prescriptive | Descriptive of expert thinking |
| **Structure** | Sequential steps | Principles + context |
| **Examples** | Show correct format | Show trade-offs and reasoning |

---

## Self-Check Questions

When reviewing your skill, ask:

1. **Would an expert do it this way?** If you're prescribing steps an expert would skip or combine, you're not transferring expertise.

2. **What am I teaching vs. instructing?** Teaching: patterns, mental models, trade-offs. Instructing: "do step 1, then step 2"

3. **Am I respecting Claude's intelligence?** If you're explaining what a function is, you're probably under-estimating the baseline.

4. **Could I delete this and still succeed?** If yes, the section isn't transferring unique expertise.

5. **Does this sound like documentation or like thinking out loud with a colleague?** Aim for the latter.

---

## The Litmus Test

Show your skill to a domain expert. Ask:

- "Would you approach it this way?"
- "What's missing from how you actually think about this?"
- "What here is obvious vs. insightful?"

If they say "this is how I think about it" - you've transferred expertise.
If they say "yes, those are the steps" - you've written instructions.
