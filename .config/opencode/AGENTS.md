# AGENTS.md

## mise

- Prefer to use [`mise`](https://mise.jdx.dev/) to manage runtime and tool versions
- If using GHA use `jdx/mise-action@v3` (`mise generate github-action` to create a new one)

## AWS & Granted

This machine uses [Granted](https://granted.dev) (`assume`) for AWS credential management.

**Important:** `assume <profile>` does NOT work inside AI agent sessions (Claude Code, OpenCode, etc.) because each command runs in a new subprocess - environment variables don't persist between commands.

**Two options that work:**

1. **Pass `--profile` to each AWS command** (most flexible, allows switching profiles):
   ```bash
   aws s3 ls --profile dev
   aws ec2 describe-instances --profile prod
   ```

2. **Assume before starting the session** (simpler if staying in one account):
   ```bash
   # In your terminal BEFORE starting the agent:
   assume dev
   opencode  # or claude
   # All AWS commands now work without --profile
   ```

**If the user needs to switch profiles mid-session**, use option 1.

**To check available profiles:** `aws configure list-profiles`
