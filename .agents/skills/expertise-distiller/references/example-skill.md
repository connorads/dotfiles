# Example Skill: Commit Messages

This is a minimal but complete skill demonstrating the four core truths.

## The Skill

```markdown
---
name: commit-messages
description: Generate clear, contextual git commit messages following conventional commits format. Use when writing commits, reviewing commit history, or explaining changes in git workflows.
---

# Commit Messages

Write commits that communicate intent, not just what changed.

## Format

[type]([scope]): [subject]

[body - optional but recommended for non-trivial changes]

## Type Selection

**Think about impact:**

fix → Code is broken, now it works  
feat → Users can do something new
refactor → Same behavior, better internals
perf → Same behavior, measurably faster
docs → Changed documentation only
test → Changed tests only
chore → Build/tooling, not affecting users

If uncertain: `feat` for additions, `fix` for corrections, `refactor` for changes

## Subject Line Rules

**Imperative mood:** "Add feature" not "Added feature" or "Adds feature"
**No period:** Subjects are titles, not sentences
**50 chars:** Force clarity

Bad: "Updated the user authentication system to use JWT tokens instead of sessions"
Good: "feat(auth): replace session auth with JWT"

## Body (When to Include)

Skip body for:
- One-line changes
- Obvious modifications  
- Isolated fixes

Include body when:
- Change affects multiple areas
- Context isn't obvious from diff
- Breaking changes or migrations

Body structure:
- What changed (if not obvious)
- Why (most important)
- Side effects or considerations

## Examples

**Feature:**
```
feat(api): add rate limiting to public endpoints

Implements token bucket algorithm with 100 req/min limit.
Prevents abuse while allowing normal usage patterns.
Redis stores rate limit state across instances.
```

**Bug fix:**
```
fix(reports): correct timezone conversion in date filters

UTC timestamps were compared to local datetime objects,
causing off-by-one errors for users in negative UTC zones.
```

**Refactor:**
```
refactor(db): replace ORM queries with raw SQL for reports

ORM generated inefficient joins causing 5s+ response times.
Raw SQL with proper indexing reduces to ~200ms.
```

**Trivial change:**
```
docs: fix typo in README installation section
```

## Quality Check

Before committing, ask:
- Can someone understand what I did without seeing the diff?
- Is the type accurate for the impact?
- Would I understand this in 6 months?
```

---

## Analysis: How This Skill Demonstrates Core Truths

### Truth 1: Expertise Transfer, Not Instructions

**What it does:**
- Teaches *thinking*: "Think about impact" when choosing type
- Includes *why*: "Force clarity" for 50-char limit
- Shows *trade-offs*: When to skip vs include body

**What it doesn't do:**
- List steps: "Step 1: Choose type, Step 2: Write subject..."
- Over-explain: Doesn't explain what git commits are
- Dictate: Doesn't mandate every field always

**Expert recognition:** A senior engineer would say "yes, that's how I think about commits"

### Truth 2: Flow, Not Friction

**What it does:**
- Direct to output: Type → subject → body → commit
- No intermediate artifacts: Doesn't say "first make a plan"
- Contextual decisions: "If X, skip body; if Y, include it"

**What it doesn't do:**
- Force planning: "Before writing, create an outline..."
- Require verification: "Now review your commit message..."
- Add ceremony: "Fill out this commit template..."

**Flow check:** User goes from "I made changes" to "I have a good commit" with no stops

### Truth 3: Voice Matches Domain

**What it does:**
- Developer language: "off-by-one errors", "ORM generated joins"
- Natural phrasing: "Code is broken, now it works"
- Tool-specific context: "Redis stores rate limit state"

**What it doesn't do:**
- Meta-narration: "You should write commits that..."
- AI-speak: "According to best practices..."
- Over-formality: "It is recommended that one should..."

**Voice check:** Reads like internal developer documentation, not AI instructions

### Truth 4: Focused Beats Comprehensive

**Token count:** ~500 words in full skill

**What it includes:**
- Type selection (non-obvious, Claude might guess wrong)
- Subject line rules (specific constraints)
- When to include body (decision framework)
- 4 complete examples (showing patterns)

**What it excludes:**
- Git basics (Claude knows how to use git)
- Why commits matter (not needed for task execution)
- Advanced features like trailers (rarely used)
- Team-specific conventions (those go in custom skills)

**Focus check:** Every section addresses a decision point or common mistake

---

## What Makes This Skill Effective

1. **Loaded only when relevant**
   - Description triggers on "commit", "git", "changes"
   - ~500 words total, reasonable token cost
   - No references needed (domain is small enough)

2. **Decisions are clear**
   - Type selection has framework, not exhaustive list
   - "If uncertain" fallback provided
   - Examples show pattern, not every variation

3. **Respects intelligence**
   - Doesn't explain what git is
   - Doesn't list every commit type
   - Trusts Claude to apply patterns

4. **Sound like practitioner**
   - "Force clarity" not "brevity is important"
   - "Code is broken, now it works" not "repairs defects"
   - Shows real scenarios with technical context

5. **Enables flow**
   - Read skill → write commit → done
   - No "now review", "now edit", "now verify"
   - Includes quality check, but as self-check not gate

---

## Contrast With Poor Version

For comparison, here's what this skill might look like without the core truths:

```markdown
❌ Poor Version:
---
name: commit-messages
description: Help with git commits
---

# How to Write Git Commit Messages

Git commit messages are important for tracking changes in your codebase. This guide will help you write good commit messages.

## What is a Commit Message?

A commit message is text that describes the changes you made in a commit. It helps other developers (and your future self) understand what you did and why.

## Steps to Write a Commit Message

1. First, think about what you changed
2. Then, decide on an appropriate type
3. Write a short subject line describing the change
4. If needed, write a longer body explaining the details
5. Review your message to make sure it's clear
6. Make any necessary edits
7. Finally, commit your changes

## Types of Commits

Here are all the types you might use:

- feat: A new feature
- fix: A bug fix  
- docs: Documentation changes
- style: Formatting, no code change
- refactor: Code restructuring
- perf: Performance improvement
- test: Adding tests
- build: Build system changes
- ci: CI configuration changes
- chore: Other changes
- revert: Reverting a commit

You should choose the type that best matches your change.

## Subject Line

The subject line should be clear and concise. Try to keep it under 50 characters if possible. Don't use a period at the end.

## Body (Optional)

You can add a body to provide more details about your change. This is optional but can be helpful for complex changes.

## Examples

Here's an example of a commit message:
\`\`\`
feat: add user login
\`\`\`

Here's another example:
\`\`\`
fix: correct database query
\`\`\`
```

**Problems with poor version:**
- **Instructions, not expertise:** "Steps to write" is mechanical
- **Friction:** Forces process (think → decide → write → review → edit)
- **Wrong voice:** "This guide will help you" is AI-speak
- **Unfocused:** Explains what commits are (not needed), lists all types (overwhelming)
- **Missing decisions:** "Choose the type that best matches" (no framework)
- **Weak examples:** Don't show *why* or *how* to think

---

## Key Takeaway

The effective version:
- Takes ~2 minutes to read
- Produces good commits on first try
- Feels like Claude "knows" how to write commits

The poor version:
- Takes ~3 minutes to read
- Requires iteration and review
- Feels like Claude is "following instructions"

That difference — between knowing and following — is expertise transfer.
