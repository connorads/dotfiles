---
name: pr-before-after
description: >-
  When a pull request changes UI and a reviewer needs to see it, captures the
  base and head side by side and splices the screenshots or recordings into
  the PR body as one marked block that later runs replace. Use when asked to
  show a UI change in a PR, add before and after screenshots or a comparison
  table, put a demo video in the PR body, or refresh visual evidence on an
  existing PR. Not for recording or checking a video itself (browser-video),
  or for general browser automation and one-off PR comment attachments
  (playwright-cli).
---

# PR Before/After

A reviewer must see the old and new UI side by side, aligned, from the same
state. Each rule below fixes a run where every step looked done and the
rendered PR was still wrong.

Jobs are split. `playwright-cli` captures. `gh` uploads and rewrites local
references. `scripts/evidence-block.py` (EXECUTE) renders rows of captures,
lists the files to upload and splices the result into a body. Do not
hand-write the table or the marker lines.

## Authorisation

Upload only inside an authorised PR create or update task. Local testing or
the existence of a PR does not authorise an upload. This is the playwright-cli
publication rule; its `references/pr-attachments.md` has the gh limits.

## 1. Get the before state

The before side is the base branch, running beside the head branch:

```sh
git fetch origin "$BASE"
wt=$(mktemp -d)/base
git worktree add --detach "$wt" "$(git merge-base HEAD "origin/$BASE")"
```

- Install and start it on a second loopback port, for example head on
  `127.0.0.1:4100` and base on `127.0.0.1:4101`.
- Give both sides the same env, seed data, feature flags, auth fixture, locale
  and clock. A difference here shows up as a false diff.

## 2. Capture

`gh` matches an upload to a reference by its exact relative path, and a space
breaks the match. So save captures under the repo root, at paths without
spaces. Run `echo /.pr-evidence/ >> "$(git rev-parse --git-common-dir)/info/exclude"`
so they never get committed.

Use one named session per side. Other agents may hold sessions too, so add
an id unique to this run (`<run>` below). `playwright-cli list` shows the
names in use. Set the same viewport and motion on both:

```sh
playwright-cli -s=pba-before-<run> open http://127.0.0.1:4101/settings
playwright-cli -s=pba-after-<run> open http://127.0.0.1:4100/settings
for s in pba-before-<run> pba-after-<run>; do
  playwright-cli -s=$s resize 1280 800
  playwright-cli -s=$s set-reduced-motion reduce
done
```

Reach the same state on both sides before capture: same route, tab, dialog,
form input and scroll offset. Dismiss banners the same way.

Pick the capture scope first. Use `screenshot <target>` with one target on
both sides when the diff is confined to one subtree, or when the two pages
differ a lot in height. Element shots need no height step.

**Equal heights.** Inside a table cell, two images of unequal height leave
their top edges offset. For full-page pairs:

1. Run `eval "() => document.documentElement.scrollHeight"` on each side.
   A page shorter than the viewport reports the viewport height; that is fine.
2. On the shorter side, set `T` in the shell to the taller value and run the
   snippet. It adds a spacer after the last child of `body`, never above
   the content, and returns the new height:

   ```sh
   T=2180
   playwright-cli -s=pba-before-<run> eval "() => { const s = document.createElement('div'); document.body.appendChild(s); s.style.height = Math.max(0, $T - (s.getBoundingClientRect().top + scrollY)) + 'px'; return document.documentElement.scrollHeight }"
   ```

3. Confirm the returned height equals `T`. Then take both shots with
   `screenshot --full-page --filename=.pr-evidence/<name>.png`.
4. Do not trust the eval alone. This one-liner must print identical width
   and height for each pair:

   ```sh
   python3 -c "import struct,sys;[print(f,*struct.unpack('>II',open(f,'rb').read()[16:24])) for f in sys.argv[1:]]" .pr-evidence/*.png
   ```

For a second viewport, such as mobile at 390x844, resize both sessions,
reload both, then redo the height step. Each viewport is its own pair.

Capture every artefact from the final page state. After any page, fixture or
padding change, recapture all screenshots and recordings, not only the one
that looked wrong. For recordings, follow the browser-video skill. Never merge
two videos into one side-by-side file; use the video table (step 5).

A Chromium mach port or bootstrap error means the agent sandbox blocked it.
Rerun the capture unsandboxed through the normal permission path.

## 3. Format and place

Run the helper and `gh` from the repo root. The helper prints paths relative
to its working directory, and `gh` matches them as exact strings. `S` is this
skill's directory. Each `--pair OLD NEW` or `--new NEW` adds a row; a
`--caption` labels the row just before it:

```sh
gh pr view "$PR" --json body | jq -j .body > .pr-evidence/body.md
rows=(--pair .pr-evidence/before-desktop.png .pr-evidence/after-desktop.png --caption Desktop
      --pair .pr-evidence/before-mobile.png  .pr-evidence/after-mobile.png  --caption Mobile)
python3 "$S/scripts/evidence-block.py" files "${rows[@]}" --body .pr-evidence/body.md > .pr-evidence/new-body.md
python3 "$S/scripts/evidence-block.py" uploads "${rows[@]}" > .pr-evidence/attach.txt
```

`--help` lists every flag. Image rows become Markdown tables. Local video rows
become stacked clips: each video sits under a plain lead-in line, one below
the other. Paths print `./`-relative to
the working directory. With `--body`, the helper replaces the lines between
the markers. Lines outside the markers are copied verbatim, line endings
included. With no markers in the body, the block goes at the end. `jq -j`
writes the body with no added newline; `gh -q` appends one, so each cycle
would grow the body by one line. A rerun rewrites the whole block, so pass every row again, changed or not.

**First insert.** The default place is the end of the body. To choose
another place, insert the two marker lines from the `files` output as two
adjacent lines at the anchor, then rerun with `--body`. These two lines are
the only edit to the body text. A valid anchor:

- Sits above anything that explains how the code changed.
- Is a blank line between two top-level blocks that the body already has.
- For a block that exists, is the new spot for both marker lines and all
  lines between them. The helper rewrites only the lines between the markers.

Rows render in argument order. The first `--pair` in `rows` is the headline
comparison: the one that shows the change most directly.

## 4. Publish images and stacked clips

Fetch the body straight before rendering and edit straight after. An edit made
by someone else in between is lost.

```sh
sed 's/^/--attach=/' .pr-evidence/attach.txt | tr '\n' '\0' |
  xargs -0 gh pr edit "$PR" --body-file .pr-evidence/new-body.md
```

`gh` documents rewriting `![alt](./file)` references to uploaded asset URLs.
Every run uploads fresh copies, and old assets stay reachable. Republish only
when a capture changed.

## 5. Video comparison table

Videos side by side need an HTML table, and `gh` rewrites only Markdown image
references, so the table needs hosted URLs. When the PR needs one, read
[references/video-table.md](references/video-table.md). The `hosted` block
replaces the whole marked block, image rows included. If the PR also needs
image pairs, publish the videos as stacked clips instead.

## 6. Verify the published PR

- `gh pr view "$PR" --json body -q .body` shows one marked block and no `](./`
  or `src="./` inside it.
- Two consecutive publishes leave the body byte-identical outside the block.
  Compare the `jq -j` fetch before and after the second publish.
- Open the PR page with playwright-cli. Read image `top` values in each table
  row with `eval`; paired images must match. Each `video` must have
  `error === null` and a `readyState` above 0. In table mode,
  `document.querySelectorAll('table video').length` must equal 2.
- The first image or video in the rendered body comes from the first `--pair`
  in `rows`.
- A private repo's PR page needs a signed-in browser state. Without one, run
  only the API body checks above.

Close every session you opened (`playwright-cli -s=<name> close`). Stop both
servers, then `git worktree remove "$wt"`.

## Secret hygiene

Uploaded assets are hard to revoke. Before any upload, look at every frame
and at the body text. Check the URL bar for signed or token-bearing links,
network panels for request headers, and dev overlays for env values. Keep
saved browser-state files outside `.pr-evidence/` and out of git.

`tests/` covers the helper: `uv run --with pytest python -m pytest -q tests`.
