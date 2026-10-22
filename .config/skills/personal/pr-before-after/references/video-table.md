# Video comparison table

The table cells need hosted video URLs. A temporary PR comment gets them:
`gh` uploads its attachments, and the comment body then holds the asset URLs.
Run every command from the repo root, with `S` set to the skill directory and
`B` and `A` set to the `./`-relative before and after videos.

Invariant: the temporary comment is deleted last, and only after the PR body
passes its check. On any failure, resume at the first state whose exit check
fails.

**uploaded**. Exit check: gh prints a URL ending `#issuecomment-<id>`.

```sh
python3 "$S/scripts/evidence-block.py" files --pair "$B" "$A" > .pr-evidence/comment.md
gh pr comment "$PR" --body-file .pr-evidence/comment.md --attach "$B" --attach "$A"
```

**harvested**. Exit check: `urls.txt` has 2 lines, before first, then after.

```sh
gh api "repos/{owner}/{repo}/issues/comments/<id>" --jq .body |
  grep -o 'https://github.com/user-attachments/assets/[A-Za-z0-9-]*' > .pr-evidence/urls.txt
```

**published**. Pass no `--attach`; the URLs are already hosted.

```sh
gh pr view "$PR" --json body | jq -j .body > .pr-evidence/body.md
python3 "$S/scripts/evidence-block.py" hosted --pair $(cat .pr-evidence/urls.txt) \
  --body .pr-evidence/body.md > .pr-evidence/new-body.md
gh pr edit "$PR" --body-file .pr-evidence/new-body.md
```

Exit check, on the body fetched again with `gh pr view "$PR" --json body -q .body`:

- `grep -oFf .pr-evidence/urls.txt | sort -u | wc -l` prints 2.
- `grep -c 'src="\./'` prints 0.
- On the rendered PR, `document.querySelectorAll('table video').length` is 2.

**cleaned**. Exit check: `gh api` on the same comment path returns 404.

```sh
gh api -X DELETE "repos/{owner}/{repo}/issues/comments/<id>"
```
