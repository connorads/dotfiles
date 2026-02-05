#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
Groksearch - search X and the web using Grok (xAI) tools.

Usage:
    uv run groksearch.py "your query" [--sources x|web|both]
    uv run groksearch.py "your query" --days 14
    uv run groksearch.py "your query" --from-date 2026-01-01 --to-date 2026-01-31
    uv run groksearch.py "your query" --no-date
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import urllib.error
import urllib.request


XAI_RESPONSES_URL = "https://api.x.ai/v1/responses"
DEFAULT_MODEL = "grok-4-1-fast"
USER_AGENT = "groksearch-skill/1.0"

CONFIG_DIR = Path.home() / ".config" / "groksearch"
CONFIG_FILE = CONFIG_DIR / ".env"


class HTTPError(Exception):
    def __init__(
        self,
        message: str,
        status_code: Optional[int] = None,
        body: Optional[str] = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


def load_env_file(path: Path) -> Dict[str, str]:
    env: Dict[str, str] = {}
    if not path.exists():
        return env
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip()
                if value and value[0] in ('"', "'") and value[-1] == value[0]:
                    value = value[1:-1]
                if key and value:
                    env[key] = value
    return env


def get_api_key(provided_key: Optional[str]) -> Optional[str]:
    if provided_key:
        return provided_key
    file_env = load_env_file(CONFIG_FILE)
    return os.environ.get("XAI_API_KEY") or file_env.get("XAI_API_KEY")


def parse_date(date_str: str) -> datetime:
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        raise ValueError(f"Invalid date: {date_str} (expected YYYY-MM-DD)")


def compute_date_range(
    days: int,
    from_date: Optional[str],
    to_date: Optional[str],
    no_date: bool,
) -> Tuple[Optional[str], Optional[str], str]:
    if no_date:
        return None, None, "any time"

    now = datetime.now(timezone.utc)
    if from_date:
        start = parse_date(from_date)
    else:
        start = now - timedelta(days=days)

    if to_date:
        end = parse_date(to_date)
    else:
        end = now

    if start > end:
        raise ValueError("from-date must be on or before to-date")

    return (
        start.strftime("%Y-%m-%d"),
        end.strftime("%Y-%m-%d"),
        f"{start.strftime('%Y-%m-%d')} to {end.strftime('%Y-%m-%d')}",
    )


def build_tools(
    sources: str, from_date: Optional[str], to_date: Optional[str]
) -> List[Dict[str, Any]]:
    tools: List[Dict[str, Any]] = []

    if sources in ("x", "both"):
        tool: Dict[str, Any] = {"type": "x_search"}
        if from_date:
            tool["from_date"] = from_date
        if to_date:
            tool["to_date"] = to_date
        tools.append(tool)

    if sources in ("web", "both"):
        tools.append(
            {
                "type": "web_search",
                "excluded_domains": ["reddit.com", "x.com", "twitter.com"],
            }
        )

    return tools


def build_prompt(query: str, sources: str, date_range: str) -> str:
    if sources == "x":
        source_desc = "X posts"
    elif sources == "web":
        source_desc = "web pages"
    else:
        source_desc = "X posts and web pages"

    return (
        "You are a research assistant. Use the available search tools to answer the user.\n"
        f"Query: {query}\n"
        f"Sources: {source_desc}.\n"
        f"Date range: {date_range}. Prefer recent sources when possible.\n\n"
        "Return the answer in this format:\n"
        "SUMMARY: 2-4 sentences.\n"
        "KEY POINTS: 3-5 bullet points.\n"
        "TOP SOURCES: 5-10 items with title and URL.\n"
        "Keep it concise and factual."
    )


def http_post(
    url: str, payload: Dict[str, Any], headers: Dict[str, str], timeout: int = 120
) -> Dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        body = None
        try:
            body = e.read().decode("utf-8")
        except Exception:
            pass
        raise HTTPError(f"HTTP {e.code}: {e.reason}", e.code, body)
    except urllib.error.URLError as e:
        raise HTTPError(f"URL Error: {e.reason}")
    except json.JSONDecodeError as e:
        raise HTTPError(f"Invalid JSON response: {e}")


def extract_output_text(response: Dict[str, Any]) -> str:
    if "error" in response and response["error"]:
        error = response["error"]
        message = (
            error.get("message", str(error)) if isinstance(error, dict) else str(error)
        )
        raise HTTPError(f"API error: {message}")

    output_text = ""
    output = response.get("output")
    if isinstance(output, str):
        output_text = output
    elif isinstance(output, list):
        for item in output:
            if isinstance(item, dict):
                if item.get("type") == "message":
                    content = item.get("content", [])
                    for c in content:
                        if isinstance(c, dict) and c.get("type") == "output_text":
                            output_text = c.get("text", "")
                            break
                    if output_text:
                        break
                elif "text" in item:
                    output_text = item.get("text", "")
            elif isinstance(item, str):
                output_text = item
            if output_text:
                break

    if not output_text and "choices" in response:
        for choice in response["choices"]:
            if "message" in choice:
                output_text = choice["message"].get("content", "")
                break

    return output_text.strip()


def extract_citations(response: Dict[str, Any]) -> List[str]:
    citations = response.get("citations", [])
    if not isinstance(citations, list):
        return []
    seen = set()
    result = []
    for url in citations:
        if not isinstance(url, str):
            continue
        url_key = url.strip()
        if not url_key or url_key in seen:
            continue
        seen.add(url_key)
        result.append(url_key)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Search X and the web using Grok (xAI) tools"
    )
    parser.add_argument("query", nargs="+", help="Search query")
    parser.add_argument("--sources", choices=["x", "web", "both"], default="both")
    parser.add_argument(
        "--days", type=int, default=30, help="Default lookback window in days"
    )
    parser.add_argument("--from-date", help="Start date (YYYY-MM-DD)")
    parser.add_argument("--to-date", help="End date (YYYY-MM-DD)")
    parser.add_argument("--no-date", action="store_true", help="Disable date filtering")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Grok model ID")
    parser.add_argument(
        "--max-sources", type=int, default=8, help="Max sources to print"
    )
    parser.add_argument("--api-key", help="xAI API key (overrides XAI_API_KEY)")

    args = parser.parse_args()
    query = " ".join(args.query).strip()
    if not query:
        print("Error: query cannot be empty", file=sys.stderr)
        sys.exit(1)

    if args.days < 1:
        print("Error: --days must be >= 1", file=sys.stderr)
        sys.exit(1)

    try:
        from_date, to_date, range_label = compute_date_range(
            days=args.days,
            from_date=args.from_date,
            to_date=args.to_date,
            no_date=args.no_date,
        )
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    api_key = get_api_key(args.api_key)
    if not api_key:
        print("Error: No API key provided.", file=sys.stderr)
        print(
            "Provide --api-key or set XAI_API_KEY (or ~/.config/groksearch/.env).",
            file=sys.stderr,
        )
        sys.exit(1)

    tools = build_tools(args.sources, from_date, to_date)
    if not tools:
        print("Error: no tools configured for sources selection", file=sys.stderr)
        sys.exit(1)

    prompt = build_prompt(query, args.sources, range_label)

    payload = {
        "model": args.model,
        "tools": tools,
        "input": [
            {
                "role": "user",
                "content": prompt,
            }
        ],
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
    }

    try:
        response = http_post(XAI_RESPONSES_URL, payload, headers=headers)
        output_text = extract_output_text(response)
        citations = extract_citations(response)
    except HTTPError as e:
        print(f"Error: {e}", file=sys.stderr)
        if e.body:
            print(e.body[:1000], file=sys.stderr)
        sys.exit(1)

    print(f"Query: {query}")
    print(f"Sources: {args.sources}")
    print(f"Date range: {range_label}")
    print("")

    if output_text:
        print(output_text)
    else:
        print("No response text returned by Grok.")

    print("")
    print("Top sources:")
    if citations:
        for i, url in enumerate(citations[: args.max_sources], start=1):
            print(f"{i}. {url}")
    else:
        print("(No citations returned)")


if __name__ == "__main__":
    main()
