---
name: github-images
description: Download images from GitHub issues and PRs using authenticated signed URLs. Use when a user shares a GitHub issue/PR URL and the agent needs to view screenshots or image attachments, especially from private repos, or asks to "grab the screenshots from that issue" or similar.
---

# github-images

Download image attachments from GitHub issues and pull requests, including private repos that require authentication.

## Usage

```bash
# From a full GitHub URL
ghimg https://github.com/owner/repo/issues/39

# From a PR URL
ghimg https://github.com/owner/repo/pull/42

# Using owner/repo and number separately
ghimg owner/repo 39

# Custom output directory
ghimg owner/repo 39 -o ./screenshots

# Print signed URLs only (pipe-friendly)
ghimg owner/repo 39 --urls-only
```

Default output: `/tmp/ghimg/<owner>/<repo>/<number>/`

After downloading, use `Read` to view the images (Claude Code supports image files).

## Manual fallback

If `ghimg` is unavailable, use `gh api` directly:

```bash
# Fetch body_html with signed image URLs (valid ~5 min)
gh api repos/owner/repo/issues/39 \
  -H "Accept: application/vnd.github.full+json" \
  --jq '.body_html'

# Fetch comment images too
gh api repos/owner/repo/issues/39/comments \
  -H "Accept: application/vnd.github.full+json" \
  --paginate --jq '.[].body_html'

# Download a signed URL
curl -sL -o image.png "https://private-user-images.githubusercontent.com/..."
```

The key insight: `application/vnd.github.full+json` returns `body_html` containing JWT-signed URLs for private image attachments. These URLs expire after ~5 minutes.
