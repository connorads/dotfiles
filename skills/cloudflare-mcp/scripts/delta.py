#!/usr/bin/env python3
"""List upstream changes since the watermarks in sources.json, and bump them.

Usage:
  delta.py [check] [--source ID ...] [--json] [--out FILE]
  delta.py bump REPORT.json (--source ID ... | --all)
  delta.py list

`--source` takes one or more ids and may be repeated; the ids accumulate.

Source statuses: changed, unchanged, error, deferred. `deferred` means an rss or
url-hash source hit HTTP 429 (rate limited) and no hard error; it has no observed
head, so `bump` refuses it, and the next check retries it.

Exit codes for `check`:
  0   no source changed and none errored (deferred sources may remain)
  10  at least one source changed and none errored (deferred sources may remain)
  1   at least one source errored (the report still lists what did change)
  2   usage error (argparse)
`bump` and `list` exit 0 on success and 1 on any refused or unknown source.

Python 3.11+ stdlib only. GitHub calls go through `gh api` when `gh` is on PATH,
else unauthenticated HTTPS (60 requests/hour; GITHUB_TOKEN or GH_TOKEN raises it).
No prompts. Paths resolve relative to this file, so the script runs from any cwd.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import email.utils
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent
SOURCES_FILE = SKILL_ROOT / "sources.json"
USER_AGENT = "cloudflare-mcp-skill-delta/1 (python-urllib)"
MAX_ITEM_LINES = 12
COMPARE_FILE_CAP = 300
MAX_PATH_QUERIES = 30
EXIT_OK, EXIT_ERROR, EXIT_CHANGED = 0, 1, 10


class FetchError(Exception):
    pass


# --------------------------------------------------------------------------- transport


class Transport:
    """Network access. Tests replace this with a fake exposing the same two methods."""

    def __init__(self) -> None:
        self.gh = shutil.which("gh")

    def github(self, path: str):
        if self.gh:
            env = {
                **os.environ,
                "GH_PROMPT_DISABLED": "1",
                "GH_NO_UPDATE_NOTIFIER": "1",
            }
            proc = subprocess.run(
                [self.gh, "api", "-H", "Accept: application/vnd.github+json", path],
                capture_output=True,
                text=True,
                timeout=120,
                env=env,
                check=False,
            )
            if proc.returncode != 0:
                msg = (proc.stderr or proc.stdout).strip().splitlines()
                msg = msg[-1] if msg else f"gh exited {proc.returncode}"
                if "rate limit" in msg.lower():
                    msg = f"GitHub rate limit hit via gh: {msg}"
                raise FetchError(f"gh api {path}: {msg}")
            return json.loads(proc.stdout)
        headers = {"Accept": "application/vnd.github+json"}
        token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        status, resp_headers, body = self.get("https://api.github.com/" + path, headers)
        if status in (403, 429) and resp_headers.get("x-ratelimit-remaining") == "0":
            reset = resp_headers.get("x-ratelimit-reset", "")
            when = (
                dt.datetime.fromtimestamp(int(reset), dt.UTC).isoformat()
                if reset.isdigit()
                else "unknown"
            )
            raise FetchError(
                "GitHub API rate limit exhausted (unauthenticated limit is 60/hour). "
                f"Install and log in to gh, or set GITHUB_TOKEN. Resets at {when}."
            )
        if status != 200:
            raise FetchError(f"GET api.github.com/{path}: HTTP {status}")
        return json.loads(body)

    def get(self, url: str, headers: dict | None = None):
        """Return (status, lower-cased headers, body bytes). Never raises on HTTP status."""
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
        except urllib.error.HTTPError as e:
            return (
                e.code,
                {k.lower(): v for k, v in (e.headers or {}).items()},
                e.read() or b"",
            )
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise FetchError(f"GET {url}: {e}") from e


# --------------------------------------------------------------------------- helpers


def now_iso() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_date(text: str) -> dt.datetime:
    text = (text or "").strip()
    try:
        d = email.utils.parsedate_to_datetime(text)
    except (TypeError, ValueError):
        d = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=dt.UTC)


def iso(d: dt.datetime) -> str:
    return d.astimezone(dt.UTC).isoformat().replace("+00:00", "Z")


def strip_html(text: str) -> str:
    text = re.sub(r"<(script|style)\b.*?</\1>", " ", text, flags=re.DOTALL | re.IGNORECASE)
    return html.unescape(re.sub(r"<[^>]+>", " ", text))


def prefix_matcher(prefixes: list[str]):
    """Prefixes match by string start; a `*` matches one path segment."""
    pats = [
        re.compile("^" + "[^/]*".join(re.escape(part) for part in pre.split("*")))
        for pre in prefixes
    ]
    return lambda name: bool(name) and any(p.match(name) for p in pats)


def tag_key(tag: str):
    """Numbers in order; a prerelease suffix sorts before the final tag of the same numbers."""
    nums = tuple(int(n) for n in re.findall(r"\d+", tag))
    pre = 0 if re.search(r"-(rc|beta|alpha|next|canary|pre)", tag, re.IGNORECASE) else 1
    return nums, pre


def is_prerelease(version: str) -> bool:
    return "-" in version


def result(source, status, head=None, items=None, info=None, error=None, links=None):
    return {
        "id": source["id"],
        "kind": source["kind"],
        "status": status,
        "base": source["watermark"]["value"],
        "head": head,
        "items": items or [],
        "info": info or [],
        "links": links or [],
        "error": error,
        "informs": source.get("informs", []),
    }


# --------------------------------------------------------------------------- kinds


def list_commits(t: Transport, repo: str, head: str, since: str, path: str):
    out = []
    for page in range(1, 6):
        q = {"sha": head, "since": since, "per_page": "100", "page": str(page)}
        if path:
            q["path"] = path
        batch = t.github(f"repos/{repo}/commits?{urllib.parse.urlencode(q)}")
        out += batch
        if len(batch) < 100:
            break
    return out


def query_paths(t: Transport, repo: str, head: str, prefix: str) -> list[str]:
    """Expand a prefix into paths the commits API can filter on ("" = whole repo)."""
    if "*" in prefix:
        parent, rest = prefix.split("*", 1)
        return [
            p
            for c in list_dir(t, repo, head, parent.rstrip("/"))
            if c["type"] == "dir"
            for p in query_paths(t, repo, head, c["path"] + rest)
        ]
    if prefix == "" or prefix.endswith("/"):
        return [prefix.rstrip("/")]
    parent = prefix.rsplit("/", 1)[0] if "/" in prefix else ""
    return [c["path"] for c in list_dir(t, repo, head, parent) if c["path"].startswith(prefix)]


def list_dir(t: Transport, repo: str, head: str, path: str):
    return t.github(f"repos/{repo}/contents/{urllib.parse.quote(path)}?ref={head}")


def check_github_paths(source, t: Transport):
    repo, ref, base = source["repo"], source["ref"], source["watermark"]["value"]
    matches = prefix_matcher(source["paths"])
    head = t.github(f"repos/{repo}/commits/{urllib.parse.quote(ref, safe='')}")["sha"]
    if head == base:
        return result(source, "unchanged", head=head)
    cmp = t.github(f"repos/{repo}/compare/{base}...{head}")
    if cmp.get("status") not in ("ahead", "identical"):
        return result(
            source,
            "error",
            error=f"watermark {base[:12]} is not an ancestor of {ref} "
            f"(compare status {cmp.get('status')}); history was rewritten, pick a new base",
        )
    link = f"https://github.com/{repo}/compare/{base[:12]}...{head[:12]}"
    all_files = cmp.get("files") or []
    files = [
        f for f in all_files if matches(f["filename"]) or matches(f.get("previous_filename", ""))
    ]
    commits_in_range = {c["sha"] for c in cmp.get("commits") or []}
    truncated = (
        cmp.get("total_commits", 0) > len(commits_in_range) or len(all_files) >= COMPARE_FILE_CAP
    )
    file_items = [
        {
            "type": "file",
            "path": f["filename"],
            "change": f.get("status", ""),
            "line": f"{f.get('status', '?')[:1].upper()} {f['filename']}",
        }
        for f in files
    ]
    items = []
    if files or truncated:
        base_date = cmp["base_commit"]["commit"]["committer"]["date"]
        names = sorted({f["filename"] for f in files})
        if not truncated and len(names) <= MAX_PATH_QUERIES:
            paths = names
        else:
            paths = sorted({q for p in source["paths"] for q in query_paths(t, repo, head, p)})
        commits = {}
        for path in paths:
            for c in list_commits(t, repo, head, base_date, path):
                if not c["sha"].startswith(base) and (truncated or c["sha"] in commits_in_range):
                    commits[c["sha"]] = c
        for c in sorted(
            commits.values(),
            key=lambda c: c["commit"]["committer"]["date"],
            reverse=True,
        ):
            date = c["commit"]["committer"]["date"]
            subject = c["commit"]["message"].split("\n", 1)[0]
            items.append(
                {
                    "type": "commit",
                    "sha": c["sha"],
                    "date": date,
                    "subject": subject,
                    "line": f"{c['sha'][:8]} {date[:10]} {subject}",
                }
            )
    info = []
    if truncated:
        info.append(
            f"compare truncated ({cmp.get('total_commits')} commits, {len(all_files)} files); "
            "commits come from the commits API by path and committer date; the file list is partial"
        )
    items += file_items
    status = "changed" if items else "unchanged"
    return result(source, status, head=head, items=items, info=info, links=[link] if items else [])


def check_github_tags(source, t: Transport):
    repo, pattern, base = (
        source["repo"],
        re.compile(source["regex"]),
        source["watermark"]["value"],
    )
    tags = []
    for page in range(1, 11):
        refs = t.github(f"repos/{repo}/git/matching-refs/tags?per_page=100&page={page}")
        tags += [r["ref"].removeprefix("refs/tags/") for r in refs]
        if len(refs) < 100:
            break
    tags = [x for x in tags if pattern.search(x)]
    new = sorted((x for x in tags if tag_key(x) > tag_key(base)), key=tag_key)
    head = max([*tags, base], key=tag_key)
    items = [{"type": "tag", "tag": x, "line": x} for x in new]
    links = [f"https://github.com/{repo}/releases/tag/{urllib.parse.quote(x)}" for x in new]
    return result(source, "changed" if new else "unchanged", head=head, items=items, links=links)


def check_npm(source, t: Transport):
    base, head, items, info, errors = source["watermark"]["value"], {}, [], [], []
    for pkg in source["packages"]:
        status, _, body = t.get(
            "https://registry.npmjs.org/" + pkg.replace("/", "%2f"),
            {"Accept": "application/json"},
        )
        if status != 200:
            errors.append(f"{pkg}: registry HTTP {status}")
            continue
        doc = json.loads(body)
        times = doc.get("time", {})
        wm = base.get(pkg)
        if wm is None or wm not in times:
            errors.append(f"{pkg}: watermark version {wm!r} not found in registry time map")
            continue
        t0 = times[wm]
        stable = {
            v: ts
            for v, ts in times.items()
            if v not in ("created", "modified") and not is_prerelease(v)
        }
        new = sorted((v for v, ts in stable.items() if ts > t0), key=lambda v: stable[v])
        head[pkg] = new[-1] if new else wm
        for v in new:
            items.append(
                {
                    "type": "version",
                    "package": pkg,
                    "version": v,
                    "published": stable[v],
                    "line": f"{pkg} {v} {stable[v][:10]}",
                }
            )
        peer_filter = source.get("peer_report", {}).get(pkg)
        if peer_filter:
            latest = doc.get("dist-tags", {}).get("latest")
            peers = doc.get("versions", {}).get(latest, {}).get("peerDependencies", {})
            shown = {k: v for k, v in sorted(peers.items()) if re.search(peer_filter, k)}
            info.append(f"{pkg}@{latest} peers: " + ", ".join(f"{k} {v}" for k, v in shown.items()))
    if errors:
        return result(source, "error", items=items, info=info, error="; ".join(errors))
    return result(source, "changed" if items else "unchanged", head=head, items=items, info=info)


ATOM = "{http://www.w3.org/2005/Atom}"
CONTENT = "{http://purl.org/rss/1.0/modules/content/}encoded"


def parse_feed(body: bytes):
    root = ET.fromstring(body)
    out = []
    for i in root.iter("item"):
        text = " ".join(
            [
                i.findtext("title") or "",
                i.findtext("description") or "",
                i.findtext(CONTENT) or "",
            ]
            + [c.text or "" for c in i.findall("category")]
        )
        out.append(
            (
                i.findtext("pubDate") or i.findtext("{http://purl.org/dc/elements/1.1/}date") or "",
                i.findtext("link") or "",
                i.findtext("title") or "",
                text,
            )
        )
    for e in root.iter(ATOM + "entry"):
        link = e.find(ATOM + "link")
        text = " ".join(
            [
                e.findtext(ATOM + "title") or "",
                e.findtext(ATOM + "summary") or "",
                e.findtext(ATOM + "content") or "",
            ]
            + [c.get("term", "") for c in e.findall(ATOM + "category")]
        )
        out.append(
            (
                e.findtext(ATOM + "published") or e.findtext(ATOM + "updated") or "",
                link.get("href", "") if link is not None else "",
                e.findtext(ATOM + "title") or "",
                text,
            )
        )
    return out


def check_rss(source, t: Transport):
    since = parse_date(source["watermark"]["value"])
    include = re.compile(source["include"])
    newest, found, errors, limited = since, {}, [], []
    for url in source["feeds"]:
        status, headers, body = t.get(
            url,
            {"Accept": "application/rss+xml, application/atom+xml, application/xml"},
        )
        if status == 429:
            limited.append(rate_limited(url, headers))
            continue
        if status != 200:
            errors.append(f"{url}: HTTP {status}")
            continue
        try:
            entries = parse_feed(body)
        except ET.ParseError:
            errors.append(
                f"{url}: response is not XML ({headers.get('content-type', '?')}), likely a bot challenge"
            )
            continue
        for date, link, title, text in entries:
            try:
                d = parse_date(date)
            except ValueError:
                continue
            newest = max(newest, d)
            if d > since and link not in found and include.search(strip_html(text)):
                found[link] = {
                    "type": "post",
                    "date": iso(d),
                    "title": title.strip(),
                    "url": link,
                    "line": f"{iso(d)[:10]} {title.strip()} {link}",
                }
    items = sorted(found.values(), key=lambda x: x["date"], reverse=True)
    if errors or limited:
        return incomplete(source, errors, limited, items)
    return result(
        source,
        "changed" if items else "unchanged",
        head=iso(newest),
        items=items,
        links=[x["url"] for x in items],
    )


def rate_limited(url: str, headers: dict) -> str:
    after = headers.get("retry-after")
    return f"{url}: HTTP 429 rate limited" + (f" (Retry-After {after})" if after else "")


def incomplete(source, errors, limited, items):
    """A hard error wins over a rate limit; a rate limit alone defers the source."""
    if errors:
        return result(source, "error", items=items, error="; ".join(errors + limited))
    return result(source, "deferred", items=items, info=limited)


def normalise_text(body: bytes, content_type: str) -> str:
    text = body.decode("utf-8", errors="replace")
    if "html" in content_type or text.lstrip().startswith("<"):
        text = strip_html(text)
    return " ".join(text.split())


def check_url_hash(source, t: Transport):
    base, head, items, errors, limited = source["watermark"]["value"], {}, [], [], []
    for url in source["urls"]:
        status, headers, body = t.get(url)
        if status == 429:
            limited.append(rate_limited(url, headers))
            continue
        if status != 200:
            errors.append(f"{url}: HTTP {status}")
            continue
        digest = hashlib.sha256(
            normalise_text(body, headers.get("content-type", "")).encode()
        ).hexdigest()[:16]
        head[url] = digest
        if base.get(url) != digest:
            items.append(
                {
                    "type": "url",
                    "url": url,
                    "old": base.get(url),
                    "new": digest,
                    "line": f"changed {url} ({base.get(url)} -> {digest})",
                }
            )
    if errors or limited:
        return incomplete(source, errors, limited, items)
    return result(
        source,
        "changed" if items else "unchanged",
        head=head,
        items=items,
        links=[x["url"] for x in items],
    )


KINDS = {
    "github-paths": check_github_paths,
    "github-tags": check_github_tags,
    "npm": check_npm,
    "rss": check_rss,
    "url-hash": check_url_hash,
}


def check_source(source, t: Transport):
    try:
        return KINDS[source["kind"]](source, t)
    except FetchError as e:
        return result(source, "error", error=str(e))
    except (KeyError, ValueError, TypeError, json.JSONDecodeError) as e:
        return result(source, "error", error=f"{type(e).__name__}: {e}")


# --------------------------------------------------------------------------- output


def render(report) -> str:
    lines = []
    for r in report["results"]:
        lines.append(f"[{r['status']}] {r['id']} ({r['kind']}) informs: {', '.join(r['informs'])}")
        if r["error"]:
            lines.append(f"  error: {r['error']}")
        if r["status"] == "deferred":
            lines.append(
                "  deferred: retry later (rate limited; do not route through a scraping proxy)"
            )
        lines += [f"  {x}" for x in r["info"]]
        if r["links"] and r["kind"] == "github-paths":
            lines.append(f"  {r['links'][0]}")
        shown = r["items"][:MAX_ITEM_LINES]
        lines += [f"  {x['line']}" for x in shown]
        if len(r["items"]) > len(shown):
            lines.append(
                f"  ... {len(r['items']) - len(shown)} more (use --json or --out for the full list)"
            )
    counts = {
        s: sum(r["status"] == s for r in report["results"])
        for s in ("changed", "unchanged", "error", "deferred")
    }
    lines.append(
        f"{counts['changed']} changed, {counts['unchanged']} unchanged, {counts['error']} errors, "
        f"{counts['deferred']} deferred "
        f"(checked {report['generated_at']})"
    )
    return "\n".join(lines)


def exit_code(report) -> int:
    statuses = {r["status"] for r in report["results"]}  # "deferred" alone never fails
    if "error" in statuses:
        return EXIT_ERROR
    return EXIT_CHANGED if "changed" in statuses else EXIT_OK


# --------------------------------------------------------------------------- commands


def load_sources(path: Path):
    return json.loads(path.read_text())


def select(sources, ids):
    if not ids:
        return sources["sources"], []
    known = {s["id"]: s for s in sources["sources"]}
    return [known[i] for i in ids if i in known], [i for i in ids if i not in known]


def cmd_check(args, t: Transport, sources_path: Path, out=None, err=None) -> int:
    out, err = out or sys.stdout, err or sys.stderr
    sources = load_sources(sources_path)
    chosen, unknown = select(sources, args.source)
    if unknown:
        print(f"unknown source id(s): {', '.join(unknown)}", file=err)
        return EXIT_ERROR
    if any(s["kind"].startswith("github") for s in chosen) and not getattr(t, "gh", True):
        print(
            "note: gh not found; using unauthenticated GitHub API (60 requests/hour)",
            file=err,
        )
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda s: check_source(s, t), chosen))
    report = {"schema": 1, "generated_at": now_iso(), "results": results}
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2) if args.json else render(report), file=out)
    return exit_code(report)


def cmd_bump(args, sources_path: Path, out=None, err=None) -> int:
    out, err = out or sys.stdout, err or sys.stderr
    if not args.source and not args.all:
        print(
            "bump needs --source ID ... or --all; bump only sources you have processed",
            file=err,
        )
        return EXIT_ERROR
    report = json.loads(Path(args.report).read_text())
    sources = load_sources(sources_path)
    by_id = {s["id"]: s for s in sources["sources"]}
    results = {r["id"]: r for r in report["results"]}
    ids = args.source or list(results)
    code = EXIT_OK
    for sid in ids:
        r, s = results.get(sid), by_id.get(sid)
        if s is None or r is None:
            print(
                f"skip {sid}: not in {'sources.json' if s is None else 'report'}",
                file=err,
            )
            code = EXIT_ERROR
        elif r["status"] == "deferred":
            print(
                f"skip {sid}: deferred in report (rate limited), run check again later",
                file=err,
            )
            code = EXIT_ERROR
        elif r["status"] == "error" or r["head"] is None:
            print(f"skip {sid}: errored in report, no observed head", file=err)
            code = EXIT_ERROR
        elif r["base"] != s["watermark"]["value"]:
            print(
                f"skip {sid}: sources.json watermark moved since this report; run check again",
                file=err,
            )
            code = EXIT_ERROR
        else:
            s["watermark"] = {"value": r["head"], "observed_at": report["generated_at"]}
            print(f"bumped {sid}", file=out)
    sources_path.write_text(json.dumps(sources, indent=2, ensure_ascii=False) + "\n")
    return code


def short(value) -> str:
    if isinstance(value, dict):
        return ", ".join(f"{k.rsplit('/', 1)[-1]}={v}" for k, v in value.items())
    return value[:12] if re.fullmatch(r"[0-9a-f]{40}", str(value)) else str(value)


def cmd_list(sources_path: Path, out=None) -> int:
    out = out or sys.stdout
    for s in load_sources(sources_path)["sources"]:
        print(
            f"{s['id']} ({s['kind']}) @ {short(s['watermark']['value'])} observed {s['watermark']['observed_at']}",
            file=out,
        )
        print(f"  informs: {', '.join(s['informs'])}", file=out)
        print(f"  why: {s['why']}", file=out)
    return EXIT_OK


def build_parser():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = p.add_subparsers(dest="cmd")
    c = sub.add_parser("check", help="list upstream changes since the watermarks (default)")
    c.add_argument(
        "--source",
        nargs="+",
        metavar="ID",
        action="extend",
        help="only these source ids (repeatable)",
    )
    c.add_argument("--json", action="store_true", help="print the full report as JSON")
    c.add_argument(
        "--out",
        metavar="FILE",
        help="write the full JSON report, incl. observed heads, to FILE",
    )
    b = sub.add_parser("bump", help="write a report's observed heads into sources.json watermarks")
    b.add_argument("report", metavar="REPORT.json")
    g = b.add_mutually_exclusive_group()
    g.add_argument(
        "--source",
        nargs="+",
        metavar="ID",
        action="extend",
        help="only these source ids (repeatable)",
    )
    g.add_argument(
        "--all",
        action="store_true",
        help="every source in the report; refuses errored and deferred ones",
    )
    sub.add_parser("list", help="show sources, watermarks and the skill files each informs")
    return p


def main(argv=None, transport=None, sources_path: Path = SOURCES_FILE) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] not in ("check", "bump", "list", "-h", "--help"):
        argv = ["check", *argv]
    args = build_parser().parse_args(argv)
    if args.cmd == "list":
        return cmd_list(sources_path)
    if args.cmd == "bump":
        return cmd_bump(args, sources_path)
    return cmd_check(args, transport or Transport(), sources_path)


if __name__ == "__main__":
    sys.exit(main())
