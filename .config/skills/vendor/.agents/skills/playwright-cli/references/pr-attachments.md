# Attaching Screenshots and Videos to Pull Requests

`gh` 2.99+ uploads local images and videos with the repeatable `--attach` flag on `gh pr create`, `gh pr comment`, `gh pr edit`, `gh issue create`, `gh issue comment` and `gh issue edit`. PNG, JPEG, GIF, WebP, SVG, MP4, MOV and WebM are accepted, so `playwright-cli screenshot` and `video-start` output can be attached as is.

## When to attach

<!-- LOCAL PATCH (connorads dotfiles): attachment examples require publication scope and preserve filenames as shell arguments -->

Attach relevant visual evidence as part of an authorised PR creation or update task, or an authorised issue publication task. Inspect each capture first and omit unrelated content, credentials and personal data. Local testing and the mere existence of a PR do not authorise an upload. Keep evidence local when publication is outside the task.

## From a local session

```bash
# capture the evidence
playwright-cli open http://localhost:3000/settings
playwright-cli screenshot --filename=settings-after.png
playwright-cli video-start settings-flow.webm
playwright-cli click e5
playwright-cli fill e7 "New name" --submit
playwright-cli video-stop

# attach when creating the PR; alt text goes after "#" (images only)
gh pr create --title "fix(settings): keep name after save" --body-file body.md \
  --attach './settings-after.png#Settings page after saving' --attach ./settings-flow.webm

# or comment on an existing PR / issue
gh pr comment 123 --body "Recorded the new flow end to end." --attach ./settings-flow.webm
gh issue comment 456 --body "Failure state after submitting the form." --attach ./failure.png
```

Reference the file in the body as `![alt](./settings-after.png)` to place it inline and `gh` rewrites the path to the uploaded URL. Unreferenced attachments are appended at the end in flag order.

## Limits

- Images up to 10 MB, videos up to 10 MB on free plans and 100 MB on paid plans, so keep recordings short.
- Alt text is not supported on videos.
- Uploads need push access to the repository.
- Available on GitHub.com and GitHub Enterprise Cloud only.

## From CI

Use this only in an authorised CI publication workflow. The repository owner enables `PLAYWRIGHT_PR_ATTACHMENTS=true` after reviewing what the configured tests capture. Restrict uploads to the agreed screenshot/video artefacts; disabled is the default.

```yaml
permissions:
  pull-requests: write
steps:
  - run: pnpm exec playwright test
  - name: Attach failure screenshots and videos to the PR
    if: failure() && github.event_name == 'pull_request' && vars.PLAYWRIGHT_PR_ATTACHMENTS == 'true'
    shell: bash
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      GH_PR_NUMBER: ${{ github.event.pull_request.number }}
      GH_RUN_ID: ${{ github.run_id }}
    run: |
      attachments=()
      while IFS= read -r -d '' file; do
        attachments+=(--attach "$file")
        if [ "${#attachments[@]}" -ge 40 ]; then
          break
        fi
      done < <(find test-results -type f \( -name '*.png' -o -name '*.webm' \) -print0)
      if [ "${#attachments[@]}" -gt 0 ]; then
        gh pr comment "$GH_PR_NUMBER" \
          --body "Failure screenshots and videos from run $GH_RUN_ID." \
          "${attachments[@]}"
      fi
```

For a polished walkthrough of a new feature, record a hero script as described in [video-recording.md](video-recording.md) and attach the resulting WebM the same way.
