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
