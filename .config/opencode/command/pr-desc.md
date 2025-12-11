---
description: Update current PR description based on conversation context
---

Fetch the current PR and update its description based on our conversation.

Current PR details:
!`gh pr view --json title,body,number`

Based on the context of our conversation, update the PR title and/or body while:
1. Preserving the existing template structure (headers like # What, # Why, # Testing)
2. Filling in or updating sections based on what we discussed
3. Keeping any existing content that's still relevant

Additional instructions: $ARGUMENTS

After generating the updated content, use `gh pr edit` to apply the changes.
Use a HEREDOC to pass the body to ensure correct formatting:

```
gh pr edit --body "$(cat <<'EOF'
<body content here>
EOF
)"
```

If the title also needs updating, include `--title "..."` as well.
