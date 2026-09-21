Attach the screenshots and videos Playwright Test already saves under `test-results` (`screenshot: 'only-on-failure'`, `video: 'retain-on-failure'`) with the same command:

```yaml
permissions:
  pull-requests: write
steps:
  - run: npx playwright test
  - name: Attach failure screenshots and videos to the PR
    if: failure() && github.event_name == 'pull_request'
    env:
      GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    run: |
      files=$(find test-results -name '*.png' -o -name '*.webm' | head -20)
      if [ -n "$files" ]; then
        gh pr comment ${{ github.event.pull_request.number }} \
          --body "Failure screenshots and videos from run ${{ github.run_id }}." \
          $(printf -- '--attach %s ' $files)
      fi
```
