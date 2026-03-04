# Quick Reference: Core Principles

Use this as a checklist during skill creation and iteration.

## The 4 Core Truths

```
┌─────────────────────────────────────────────────────────────┐
│ 1. EXPERTISE TRANSFER, NOT INSTRUCTIONS                     │
│    Make Claude think like an expert, not follow steps       │
│    ✓ Mental models  ✓ Trade-offs  ✓ Decision frameworks    │
│    ✗ Checklists     ✗ Recipes     ✗ "Step 1, Step 2..."    │
├─────────────────────────────────────────────────────────────┤
│ 2. FLOW, NOT FRICTION                                       │
│    Produce output, not intermediate documents               │
│    ✓ Direct to deliverable  ✓ Contextual decisions         │
│    ✗ "Write a plan first"  ✗ "Now review your work"        │
├─────────────────────────────────────────────────────────────┤
│ 3. VOICE MATCHES DOMAIN                                     │
│    Sound like a practitioner, not documentation             │
│    ✓ Domain language  ✓ Natural phrasing                   │
│    ✗ "You should..."  ✗ "Make sure to..."                  │
├─────────────────────────────────────────────────────────────┤
│ 4. FOCUSED BEATS COMPREHENSIVE                              │
│    Every section must justify its token cost                │
│    ✓ Only non-obvious info  ✓ Split to references          │
│    ✗ Explaining basics     ✗ "Just in case" sections       │
└─────────────────────────────────────────────────────────────┘
```

## Progressive Disclosure Structure

```
YAML (always loaded)
├─ name: Short identifier
└─ description: When to trigger (specific!)

SKILL.md (<500 lines)
├─ Core mental model
├─ Common scenarios  
├─ Decision frameworks
└─ Links to references

references/ (load as needed)
├─ patterns.md: Detailed patterns
├─ examples.md: Complete examples
└─ advanced.md: Edge cases

scripts/ (execute, rarely read)
└─ Deterministic operations

assets/ (copy/use, never read)
└─ Templates, fonts, images
```

## Quality Checks by Truth

### Truth 1: Expertise Transfer Test
```
Read random section. Ask:
→ Does this teach HOW to think?
→ Would an expert recognize this?
→ Are we showing patterns or steps?

Red flags:
• "Follow these steps..."
• "Make sure to..."
• Explaining what Claude already knows
```

### Truth 2: Flow Test
```
Walk through skill. Ask:
→ Can we go input → output directly?
→ Do we force planning artifacts?
→ Are decisions made inline?

Red flags:
• "First, create an outline..."
• "Review your work and revise..."
• Multiple verification steps
```

### Truth 3: Voice Test
```
Read aloud. Ask:
→ Does this sound like domain docs?
→ Natural phrasing or stilted?
→ Meta-narration about process?

Red flags:
• "You should consider..."
• "This is important because..."
• "The next step is to..."
```

### Truth 4: Focus Test
```
For each section, ask:
→ Would Claude fail without this?
→ Is this addressing observed gaps?
→ Could this be a one-line reference?

Red flags:
• Sections >200 words without split
• Information "just in case"
• Repeated similar examples
```

## Token Budget Guidelines

```
SKILL.md target sizes:
┌──────────────────┬──────────┬─────────────────┐
│ Complexity       │ Target   │ If Exceeding    │
├──────────────────┼──────────┼─────────────────┤
│ Simple task      │ <200     │ Cut explanations│
│ Medium workflow  │ 200-500  │ Split references│
│ Complex domain   │ 500-800  │ Multiple refs   │
│ Multi-domain     │ 800+     │ Split skills    │
└──────────────────┴──────────┴─────────────────┘

If SKILL.md > 500 lines:
1. Move examples → references/examples.md
2. Move patterns → references/patterns.md  
3. Move edge cases → references/advanced.md
4. Keep only: core flow + decision points
```

## Common Patterns

### Decision Framework Pattern
```markdown
## When [Scenario A]
[Specific approach]

## When [Scenario B]
[Different approach]  

## Default (when unsure)
[Safe fallback]
```

### Principle + Example Pattern
```markdown
## [Principle name]

**Core idea:** [One sentence]

**In practice:**
- [Specific application]
- [Specific application]

**Example:**
[Concrete demonstration]
```

### Quality Checklist Pattern
```markdown
## Quality Check

Before finishing:
- [ ] [Specific, measurable criterion]
- [ ] [Specific, measurable criterion]
- [ ] [Specific, measurable criterion]
```

## Red Flag Phrases

If you see these, revise:

```
INSTRUCTION LANGUAGE:
✗ "You should..."
✗ "Make sure to..."
✗ "Don't forget..."
✗ "Remember that..."
✗ "It's important to..."

REVISION →
✓ Just state it: "Use X for Y"
✓ Or explain why: "X prevents Y"
```

```
PROCESS NARRATION:
✗ "The first step is..."
✗ "Now that you've..."
✗ "Next, you need to..."
✗ "After completing..."

REVISION →
✓ Direct: "Extract text"
✓ Conditional: "If X, then Y"
```

```
VAGUE GUIDANCE:
✗ "Choose appropriately"
✗ "Use best practices"
✗ "Ensure quality"
✗ "Optimize as needed"

REVISION →
✓ Criteria: "Use X when Y"
✓ Examples: "Like this: [example]"
```

## Iteration Triggers

Revise the skill when you observe:

```
CLAUDE BEHAVIOR:
• Asks questions skill should answer
• Ignores parts of skill
• Inconsistent output quality
• Rewrites code scripts should handle

SYMPTOM → LIKELY CAUSE:
• Questions → Missing decision criteria
• Ignores → Too much text / buried info
• Inconsistent → Vague quality criteria  
• Rewrites → Scripts unclear / not trusted
```

## Pre-Package Checklist

```
Structure:
[ ] SKILL.md exists with valid frontmatter
[ ] name and description are present
[ ] No README, CHANGELOG, or meta-docs

Content:
[ ] SKILL.md <500 lines (split if larger)
[ ] Imperative mood throughout
[ ] All references are linked from SKILL.md
[ ] No "you should" or instruction language
[ ] Examples show patterns, not just format

Quality:
[ ] Tested on 3+ realistic scenarios
[ ] Addresses observed failure modes
[ ] Every section justified by need
[ ] Would pass the 4 truth tests

References:
[ ] Split by use case, not type
[ ] Include grep patterns for large files
[ ] Referenced from SKILL.md with "when to use"

Scripts:
[ ] Tested and working
[ ] Clear when to use them
[ ] Include basic usage examples

Assets:
[ ] Only files used in output
[ ] No examples unless they're templates
```

## The One-Minute Test

Read your skill. Time yourself. After one minute, can you:
1. Explain the core approach in one sentence?
2. Recall two key decision points?
3. Remember when to use a reference vs. SKILL.md?

If no → Too unfocused, needs ruthless editing
If yes → Probably well-structured

## Final Self-Check

The best skills feel invisible. Ask:

```
Does Claude sound like it:
[ ] Has expertise in this domain?
OR
[ ] Is following an instruction manual?

If it sounds like Claude is:
• "Checking the manual" → Too procedural
• "Thinking through it" → Good expertise transfer
• "An expert who knows" → Excellent
```

---

## Emergency Simplification

If skill isn't working and you're stuck:

1. **Delete everything**
2. **Write 3 sentences:**
   - What's the core mental model?
   - What's the most common scenario?
   - What's the biggest gotcha?
3. **Add minimal examples**
4. **Test**
5. **Only then add back what's missing**

Simple skills that work > complex skills that don't.
