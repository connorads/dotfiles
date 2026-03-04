# Diagnosing and Fixing Skill Problems

When a skill isn't working well, the issue usually falls into one of these categories.

## Problem: Claude Ignores Parts of the Skill

### Symptoms
- Skill is loaded but Claude doesn't follow guidance
- Claude asks questions the skill should answer
- Output quality is inconsistent

### Diagnosis
```
Why does Claude ignore instructions?
├─ Too much text → Claude skips walls of text
├─ Wrong abstraction → Instructions don't map to actual task
├─ Buried information → Key info hidden in middle
└─ Conflicting guidance → Multiple valid interpretations
```

### Fixes

**If text wall:**
```markdown
❌ Bad:
## Formatting Guidelines
When formatting documents, you should ensure that all headers 
are properly capitalized and that... [500 words]

✅ Good:
## Format Standards
- Headers: Title case
- Lists: Parallel structure  
- See references/style-guide.md for edge cases
```

**If wrong abstraction:**
```markdown
❌ Bad (organized by file type):
## For JSON files
[instructions]
## For YAML files  
[instructions]

✅ Good (organized by task):
## When validating config
[applies to JSON, YAML, TOML]
## When generating config
[applies to JSON, YAML, TOML]
```

**If buried information:**
```markdown
❌ Bad:
We recommend various approaches depending on context. 
Sometimes it's useful to consider alternative methods, 
especially when... [critical info in paragraph 3]

✅ Good:
**Critical: Always validate inputs before processing**

Context and alternatives: [...]
```

---

## Problem: Claude Asks Too Many Questions

### Symptoms
- Constant "should I..." or "what format..." questions
- Claude hesitates on decisions it should make
- Flow is interrupted by clarifications

### Diagnosis
```
Why the questions?
├─ Missing decision criteria → No framework for choices
├─ False choices → Offering options that have defaults
├─ Uncertainty language → "Consider" without clear defaults
└─ Under-specified → Genuinely ambiguous requirements
```

### Fixes

**If missing decision criteria:**
```markdown
❌ Bad:
"Choose an appropriate data structure"

✅ Good:
**Data structure selection:**
- <1K items, frequent lookup → dict
- >1K items, frequent insertion → deque
- Need ordering + uniqueness → OrderedDict
- Default if unsure → list (it's fine)
```

**If false choices:**
```markdown
❌ Bad:
"Would you like me to include error handling?"

✅ Good:
"Always include error handling. Use try/except for I/O, 
check for None on optional params."
```

**If uncertain language:**
```markdown
❌ Bad:
"You might want to consider adding tests"

✅ Good:
"Include tests for:
- Edge cases (empty, single item, max size)
- Error conditions
Skip tests for: obvious getters/setters"
```

---

## Problem: Output Quality Varies Unexpectedly

### Symptoms
- Sometimes great, sometimes poor
- Different users get different results
- Hard to predict when it works

### Diagnosis
```
What causes inconsistency?
├─ Context-dependent behavior → Works for some inputs only
├─ Missing examples → Claude guesses format
├─ Vague quality criteria → "Good" means different things
└─ Hidden assumptions → Works when Claude happens to guess right
```

### Fixes

**If context-dependent:**
```markdown
❌ Bad:
"Generate appropriate documentation"

✅ Good:
**Documentation by context:**

API functions:
\`\`\`python
def process(data: List[str]) -> Dict:
    """
    Args: data - Non-empty list of strings
    Returns: Dict with keys 'processed', 'failed'
    Raises: ValueError if data is empty
    """
\`\`\`

Internal helpers: Brief docstring only
\`\`\`python
def _normalize(s: str) -> str:
    """Convert to lowercase, strip whitespace"""
\`\`\`
```

**If missing examples:**
```markdown
❌ Bad:
"Create a well-structured report"

✅ Good:
**Report format (use exactly):**

# [Title]

## Summary  
[2-3 sentences with key finding]

## Recommendations
1. [Specific action] - Expected impact: [X]
2. [Specific action] - Expected impact: [Y]

See references/report-examples.md for 5 complete examples
```

**If vague quality criteria:**
```markdown
❌ Bad:
"Ensure high code quality"

✅ Good:
**Code quality checklist:**
- [ ] No magic numbers (use constants)
- [ ] Functions <50 lines (split if larger)
- [ ] Error messages include context
- [ ] No commented-out code in final version
```

---

## Problem: Skill Works But Wastes Tokens

### Symptoms
- Skill loads 2K+ tokens every time
- Much of loaded content is unused
- Context fills up quickly

### Diagnosis
```
Why the bloat?
├─ Everything in SKILL.md → Should split to references
├─ Verbose explanations → Claude already knows basics
├─ Repeated examples → One example + pattern > many examples
└─ No progressive disclosure → Everything loads upfront
```

### Fixes

**If everything in SKILL.md:**
```markdown
❌ Bad: 800-line SKILL.md with all info

✅ Good:
SKILL.md (200 lines):
## Core workflow
[Essential steps]

## Detailed references
- **API patterns:** references/patterns.md
- **Full examples:** references/examples.md  
- **Troubleshooting:** references/debug.md

Claude loads references only when needed
```

**If verbose explanations:**
```markdown
❌ Bad:
"A function is a reusable block of code that performs a 
specific task. Functions are important because they help 
organize code and reduce repetition..."

✅ Good:
"Use functions for repeated logic (>2 times)"
```

**If repeated examples:**
```markdown
❌ Bad: 10 examples showing slight variations

✅ Good: 
**Pattern:**
\`\`\`
[Type] [Name]: [Description]
- Key point 1
- Key point 2
\`\`\`

**Examples:**
Feature Login: Adds OAuth authentication
- Implements token refresh
- Includes session management

Fix ProfilePage: Corrects avatar upload bug  
- Validates image format
- Adds error messaging
```

---

## Problem: Claude Reinvents Solutions

### Symptoms
- Claude writes code that scripts should handle
- Redoes work on every invocation
- Ignores provided scripts/templates

### Diagnosis
```
Why not using resources?
├─ Scripts unclear → Doesn't know what they do
├─ Scripts fragile → Doesn't trust them
├─ Templates hidden → Doesn't know they exist
└─ Instructions unclear → Doesn't know when to use them
```

### Fixes

**If scripts unclear:**
```markdown
❌ Bad:
"See scripts/ for utilities"

✅ Good:
**PDF operations (use scripts, don't rewrite):**

Rotation: `python scripts/rotate_pdf.py input.pdf 90`
Merging: `python scripts/merge_pdfs.py file1.pdf file2.pdf`  
Forms: `python scripts/fill_form.py template.pdf data.json`

These scripts handle edge cases and validation.
Writing custom PDF code usually introduces bugs.
```

**If templates hidden:**
```markdown
❌ Bad:
"Templates are in assets/"

✅ Good:
**Component templates (copy and customize):**

\`\`\`bash
cp assets/react-component-template.tsx components/MyComponent.tsx
\`\`\`

Template includes:
- TypeScript types
- Props interface  
- Basic styling structure
- Standard exports

Modify the template, don't write from scratch.
```

**If instructions unclear:**
```markdown
❌ Bad:
"Use the template when appropriate"

✅ Good:
**When to use vs. write from scratch:**

Use template when:
- Standard CRUD operation
- Follows existing patterns
- <50 lines of custom logic

Write from scratch when:
- Novel integration
- Complex state management
- Template would need 50%+ changes
```

---

## Diagnostic Process

When a skill isn't working:

1. **Observe failure mode**
   - What specifically goes wrong?
   - Is it consistent or intermittent?
   - Which part of the skill is involved?

2. **Form hypothesis**
   - Which category above?
   - What evidence supports it?
   - What would disprove it?

3. **Test with minimal change**
   - Change one thing
   - Try the task again
   - Did it improve, worsen, or stay same?

4. **Iterate**
   - If better: commit change, look for similar issues
   - If worse: revert, try different hypothesis
   - If same: hypothesis was wrong, try different category

---

## Prevention: Design Patterns That Work

These patterns reduce common problems:

**Decision framework pattern:**
```markdown
## When [Scenario A]
[Specific guidance]

## When [Scenario B]  
[Specific guidance]

## When unsure
[Safe default]
```

**Quality checklist pattern:**
```markdown
Before finishing:
- [ ] [Specific criterion]
- [ ] [Specific criterion]
- [ ] [Specific criterion]
```

**Progressive detail pattern:**
```markdown
## Quick start (most common case)
[Minimal viable guidance]

## Advanced scenarios
See references/advanced.md for:
- [Specific scenario]
- [Specific scenario]
```

**Script-first pattern:**
```markdown
## [Task name]

\`\`\`bash
python scripts/task.py [args]
\`\`\`

Script handles: [what's automated]  
You provide: [what needs customization]

Manual approach only if: [specific exception]
```

---

## Quick Diagnostic Questions

When skill isn't working, ask:

1. **Is Claude reading it?** Check: Is skill triggered? Add logging in thinking.

2. **Is it too much?** Check: Token count. If >500 in SKILL.md, likely too much.

3. **Is it too little?** Check: Does Claude ask for information skill should provide?

4. **Is it wrong level?** Check: Are instructions for novices when Claude is advanced?

5. **Is it the right structure?** Check: Do sections map to how Claude needs to think?

Most problems fall into one of the five categories above. Start there before rewriting.
