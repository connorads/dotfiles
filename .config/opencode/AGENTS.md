# AGENTS.md

## mise

- Prefer to use [`mise`](https://mise.jdx.dev/) to manage runtime and tool versions
- If using GHA use `jdx/mise-action@v3` (`mise generate github-action` to create a new one)

## AWS & Granted

This machine uses [Granted](https://granted.dev) (`assume`) for AWS credential management.

To check available profiles: `aws configure list-profiles`

To switch profiles mid-session, run:
```bash
assume account-dev/ReadOnlyAccess
```
If the user does not already have an active AWS session in their browser then it will open a page and they will need to login.

Then use `--profile` with AWS commands:
```bash
aws lambda list-functions --profile account-prod/ReadOnlyAccess --region eu-west-1
```

## GitHub

Use `gh` CLI to access and update issues and PRs etc.
