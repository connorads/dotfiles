---
name: github-images
description: Downloads images from GitHub issue and PR comments via the API.
---

# GitHub Images

Download images attached to GitHub issue and PR comments with the GitHub API.

## Workflow

1. Parse the issue or PR URL.
2. Fetch comments with `gh api`.
3. Extract image links from Markdown.
4. Download each image into the current working directory.
