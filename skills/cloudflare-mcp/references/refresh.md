# Refreshing this skill

Use this procedure to bring the skill up to date with upstream changes.
`sources.json` records a high watermark per upstream source: the last commit, tag, version, post date or page hash the skill has absorbed.
`scripts/delta.py` lists only what changed after those watermarks, so a refresh reads the delta, not the whole upstream.

All paths below are relative to the skill root.
Requirements: Python 3.11+ (stdlib only). `gh` logged in is optional but avoids GitHub's 60 requests/hour unauthenticated limit; `GITHUB_TOKEN` also works. `pnpm` is needed for step 4.

## Kick-off prompt

Paste this to start a refresh in any agent:

```text
Refresh the cloudflare-mcp skill: follow references/refresh.md in that skill's directory.
Process every changed source, bump only what you fully processed or judged irrelevant,
and end with the summary described in step 6.
```

## 1. Check

```sh
python3 scripts/delta.py check --out "$(mktemp -d)/delta-report.json"
```

- Keep the report path. It holds each source's full change list and its observed `head`, which step 5 writes back.
- Exit codes:

  | Exit | Meaning | Action |
  | --- | --- | --- |
  | 0 | Nothing changed and nothing errored | Stop, unless a source is `deferred`. |
  | 10 | Changes found and nothing errored | Continue. |
  | 1 | At least one source errored | Process the rest. Leave errored sources alone. |
  | 2 | Usage error | Fix the command. |

  A `deferred` source does not change the exit code on its own. The script header documents the codes.
- Human output shows at most 12 change items per source. Read the full list from the report file (`--json` prints it instead).
- `python3 scripts/delta.py list` shows every source, its watermark and the skill files it informs.
- `--source` takes one or more ids and may be repeated: `--source A B` and `--source A --source B` both check A and B.
- An errored source keeps its old watermark, so the next check retries it.
- An `rss` or `url-hash` source that gets HTTP 429 and no hard error is `deferred`. The output prints `deferred: retry later`. It has no observed head, so `bump` refuses it and it keeps its old watermark. `cloudflare-blog` often answers scripts with HTTP 429. Retry later with `check --source ID`, or read the feed in a browser. Do not route it through a scraping proxy. Record a deferred source in the step 6 summary.

## 2. Read the real change and triage it

For each changed source, read the upstream change itself, not only the file list.

| Kind | How to read the change |
| --- | --- |
| `github-paths` | Open the compare link in the report, or `gh api repos/OWNER/REPO/compare/BASE...HEAD` and read `files[].patch` for the listed paths. For big ranges: `git clone --filter=blob:none` then `git diff BASE..HEAD -- <paths>`. For cloudflare-docs, read the rendered page: `src/content/docs/X/page.mdx` renders at `https://developers.cloudflare.com/X/page/index.md` (an `index.mdx` at `.../X/index.md`). |
| `github-tags` | Read the tagged spec revision and its changelog page (`https://modelcontextprotocol.io/specification/<tag>/changelog`). |
| `npm` | Read the release notes (GitHub release or `CHANGELOG.md`) for each listed version. The report also prints the current `agents` peer pins for the MCP SDK and zod. Recheck them with `pnpm view agents@latest peerDependencies`. |
| `rss` | Read each listed post. |
| `url-hash` | Only a hash is stored, so there is no diff. Re-read the whole page and compare it with what the informed files claim. |

Triage every change into one bucket:

| Bucket | Meaning | Action |
| --- | --- | --- |
| Irrelevant | Typos, other products, client-side-only changes, CI, formatting | No edit. Bump. |
| Fact drift | A version, option name, default, URL or error text the skill states has changed | Correct the claim. |
| New capability | Something a server builder should use or know | Add it where the routing table says it belongs. Keep it short. |
| Deprecation or removal | Something the skill teaches is deprecated or gone | Update the teaching. Add the old form to the stale-to-current table in `references/migrate.md`. |

Scope stays fixed: the skill covers building remote MCP servers on Cloudflare, not consuming Cloudflare's own MCP servers. Drop changes that only affect consumption.

## 3. Edit the informed files

- Edit only the files in that source's `informs` list. If a change genuinely belongs in another file, add that file to `informs` in `sources.json` as part of the same refresh.
- Each rule or table lives in one file. Update the owner, and keep other files to a one-line pointer.
- Verify every changed claim live before writing it. Run the code, query the registry or read the source at the new head. Do not copy a claim from a docs diff without checking the shipped package when the two can disagree.
- Claims the skill marks as not verified at runtime are the first to re-test when their source changes.
- Version literals and dates are snapshots. Give each an as-of caveat (`verified YYYY-MM-DD against <source>`) or a live-query command.
- Write in the skill's style: British English, present tense, no dashes other than `-`, no "recently" or "now".

## 4. Re-run the checks

1. Template test, when any change touched versions or APIs the template uses:

   ```sh
   cd assets/stateless-server && pnpm install && pnpm test && pnpm typecheck
   ```

   If a dependency bump is involved, update `assets/stateless-server/package.json` first. Respect `agents`' exact MCP peer pins.
2. Script tests, when `scripts/delta.py` or `sources.json` changed:

   ```sh
   uv run --with pytest pytest -q tests   # or: python3 -m pytest -q tests
   ```

3. Skill checker: run the `writing-skills` skill's `scripts/check.sh <skill-dir>` if it is installed. Without it, check by hand that `SKILL.md` frontmatter parses and every relative link resolves.

Report each check as passed, failed or skipped with the reason.

## 5. Bump the watermarks

```sh
python3 scripts/delta.py bump <report.json> --source ID [ID ...]
```

- Name only the sources whose changes you fully processed or judged irrelevant. `--all` exists, but use it only when every source in the report is done.
- Bump reads each head from the report, not from upstream. Anything published after the check is left for the next run.
- Bump refuses a source that errored or was deferred in the report, or whose watermark in `sources.json` moved after the report was written. Run `check` again in that case.
- A source you could not finish keeps its old watermark. Record why in the summary.

## 6. Summarise

For each source report: bumped or not, the triage bucket of each change, the files edited, the claims re-verified and how, and anything deferred. List the checks from step 4 with their results.

## Fanning out

When more than about three sources changed, or one source has a large range, give each changed source to its own sub-agent. Use your client's sub-agent tool if it has one; otherwise work through the sources one at a time in separate sessions.

- Give each sub-agent: the source's entry from the report (items, links, base and head), its `informs` list, and steps 2 and 3 of this file.
- Each sub-agent returns proposed edits plus its triage and verification evidence. It does not bump.
- The coordinator merges edits. Sources that inform the same file need one owner for that file, so hand overlapping edits to one agent or merge them by hand.
- The coordinator then runs step 4 once, bumps the finished sources in one `bump` call, and writes the step 6 summary.

## Adding a source

Add a source when the skill states something whose upstream no existing source watches.

1. Append an entry to `sources.json` with `id`, `kind`, the locator fields for that kind, `watermark` (`value` and `observed_at`), `informs` and a one-line `why`.
2. Locator fields per kind:

   | Kind | Locator fields | Watermark value |
   | --- | --- | --- |
   | `github-paths` | `repo`, `ref` (branch), `paths` (prefixes; `""` = whole repo; `*` = one path segment) | commit sha |
   | `github-tags` | `repo`, `regex` | newest matching tag |
   | `npm` | `packages`, optional `peer_report` (`{package: regex}`) | `{package: version}` |
   | `rss` | `feeds`, `include` (regex over title, body and categories) | ISO 8601 datetime |
   | `url-hash` | `urls` | `{url: first 16 hex of sha256 of whitespace-normalised text}` |

3. Set the watermark to the state the skill already reflects, not to today's upstream head. If unsure, use an older value and process the delta.
4. For `url-hash`, leave the value `{}`, run `check --source ID --out <file>`, confirm the page content matches the skill, then `bump` it.
5. Run `python3 scripts/delta.py check --source ID` and the script tests.

A new kind needs a `check_<kind>` function registered in `KINDS` in `scripts/delta.py` and offline tests in `tests/test_delta.py`.
