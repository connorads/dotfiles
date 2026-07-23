#!/usr/bin/env python3
"""Capture first-pass brand evidence from a public URL.

The script is intentionally conservative: it gathers HTML, linked CSS, head
metadata, icons, social images, and raw style signals. It does not decide the
final brand system.
"""

from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import gzip
import hashlib
import html
import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

USER_AGENT = "Mozilla/5.0 (compatible; capture-brand/1.0; +https://agents.local/capture-brand)"

HEX_RE = re.compile(r"(?<![\w-])#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![\w-])")
FUNC_COLOUR_RE = re.compile(r"\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\([^)]{3,120}\)", re.I)
GRADIENT_RE = re.compile(r"\b(?:linear|radial|conic)-gradient\([^;}{]{3,400}\)", re.I)
FONT_FAMILY_RE = re.compile(r"font-family\s*:\s*([^;}{]+)", re.I)
FONT_FACE_RE = re.compile(r"@font-face\s*{[^}]*font-family\s*:\s*([^;}{]+)", re.I | re.S)
CSS_VAR_RE = re.compile(
    r"--([\w-]*(?:color|colour|font|radius|shadow|space|spacing)[\w-]*)\s*:\s*([^;}{]+)", re.I
)
RADIUS_RE = re.compile(r"(?:border-radius|--[\w-]*radius[\w-]*)\s*:\s*([^;}{]+)", re.I)
SHADOW_RE = re.compile(r"(?:box-shadow|--[\w-]*shadow[\w-]*)\s*:\s*([^;}{]+)", re.I)
RGB_TRIPLET_RE = re.compile(r"^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s*/\s*[\d.]+%?)?\s*$")


class HeadParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[dict[str, str]] = []
        self.metas: list[dict[str, str]] = []
        self.images: list[dict[str, str]] = []
        self.styles: list[str] = []
        self.jsonld: list[str] = []
        self.title_parts: list[str] = []
        self._in_style = False
        self._in_title = False
        self._jsonld_buffer: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {k.lower(): v or "" for k, v in attrs}
        tag = tag.lower()
        if tag == "link":
            self.links.append(data)
        elif tag == "meta":
            self.metas.append(data)
        elif tag == "img":
            self.images.append(data)
        elif tag == "style":
            self._in_style = True
        elif tag == "title":
            self._in_title = True
        elif tag == "script" and "ld+json" in data.get("type", "").lower():
            self._jsonld_buffer = []

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "style":
            self._in_style = False
        elif tag.lower() == "title":
            self._in_title = False
        elif tag.lower() == "script" and self._jsonld_buffer is not None:
            self.jsonld.append("".join(self._jsonld_buffer))
            self._jsonld_buffer = None

    def handle_data(self, data: str) -> None:
        if self._in_style:
            self.styles.append(data)
        elif self._in_title:
            self.title_parts.append(data)
        elif self._jsonld_buffer is not None:
            self._jsonld_buffer.append(data)

    @property
    def title(self) -> str:
        return " ".join(part.strip() for part in self.title_parts if part.strip())


def normalise_input(value: str) -> str:
    if value.startswith(("http://", "https://", "file://")):
        return value
    path = Path(value).expanduser()
    if path.exists():
        return path.resolve().as_uri()
    return f"https://{value}"


def request_url(url: str, timeout: int, max_bytes: int) -> tuple[bytes, str, str]:
    req = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        final_url = res.geturl()
        content_type = res.headers.get("content-type", "").split(";")[0].strip()
        content_encoding = res.headers.get("content-encoding", "").lower()
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = res.read(min(65536, max_bytes - total + 1))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > max_bytes:
                raise ValueError(f"response exceeds {max_bytes} bytes: {url}")
        data = b"".join(chunks)
        if "gzip" in content_encoding or data.startswith(b"\x1f\x8b"):
            with contextlib.suppress(OSError):
                data = gzip.decompress(data)
        return data, final_url, content_type


def decode_text(data: bytes, content_type: str) -> str:
    match = re.search(r"charset=([^;]+)", content_type, re.I)
    charset = match.group(1).strip() if match else "utf-8"
    try:
        return data.decode(charset, errors="replace")
    except LookupError:
        return data.decode("utf-8", errors="replace")


def rel_tokens(link: dict[str, str]) -> set[str]:
    return {part.strip().lower() for part in link.get("rel", "").split() if part.strip()}


def meta_key(meta: dict[str, str]) -> str:
    return (meta.get("property") or meta.get("name") or meta.get("itemprop") or "").lower()


def abs_url(base: str, value: str) -> str:
    return urllib.parse.urljoin(base, html.unescape(value.strip()))


def is_archive_chrome_asset(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc.lower()
    return host in {"web-static.archive.org", "web.archive.org"} and parsed.path.startswith(
        "/_static/"
    )


def safe_filename(url: str, fallback_ext: str = "") -> str:
    parsed = urllib.parse.urlparse(url)
    name = Path(parsed.path).name or parsed.netloc or "asset"
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip(".-") or "asset"
    if "." not in name and fallback_ext:
        name = f"{name}{fallback_ext}"
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:8]
    stem, ext = os.path.splitext(name)
    return f"{stem[:60]}-{digest}{ext[:12]}"


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def add_count(bucket: dict[str, dict[str, Any]], value: str, source: str) -> None:
    value = value.strip()
    if not value:
        return
    key = value.lower()
    item = bucket.setdefault(key, {"value": value, "count": 0, "sources": []})
    item["count"] += 1
    if source not in item["sources"]:
        item["sources"].append(source)


def expand_hex(value: str) -> str:
    value = value.lstrip("#")
    if len(value) in (3, 4):
        value = "".join(ch * 2 for ch in value)
    return f"#{value.upper()}"


def css_rgb_triplet_to_hex(value: str) -> str | None:
    match = RGB_TRIPLET_RE.match(clean_css_value(value))
    if not match:
        return None
    channels = [int(part) for part in match.groups()]
    if any(channel > 255 for channel in channels):
        return None
    return "#{:02X}{:02X}{:02X}".format(*channels)


def extract_style_signals(named_texts: list[tuple[str, str]]) -> dict[str, Any]:
    colours: dict[str, dict[str, Any]] = {}
    function_colours: dict[str, dict[str, Any]] = {}
    gradients: dict[str, dict[str, Any]] = {}
    fonts: dict[str, dict[str, Any]] = {}
    font_faces: dict[str, dict[str, Any]] = {}
    css_vars: list[dict[str, str]] = []
    radii: dict[str, dict[str, Any]] = {}
    shadows: dict[str, dict[str, Any]] = {}

    for source, text in named_texts:
        for match in HEX_RE.finditer(text):
            add_count(colours, expand_hex(match.group(1)), source)
        for match in FUNC_COLOUR_RE.finditer(text):
            add_count(function_colours, match.group(0), source)
        for match in GRADIENT_RE.finditer(text):
            add_count(gradients, clean_css_value(match.group(0)), source)
        for match in FONT_FAMILY_RE.finditer(text):
            add_count(fonts, normalise_font_list(match.group(1)), source)
        for match in FONT_FACE_RE.finditer(text):
            add_count(font_faces, clean_css_value(match.group(1)), source)
        for name, value in CSS_VAR_RE.findall(text):
            var_name = f"--{name}"
            clean_value = clean_css_value(value)
            css_vars.append({"name": var_name, "value": clean_value, "source": source})
            if ("color" in name.lower() or "colour" in name.lower()) and (
                converted := css_rgb_triplet_to_hex(clean_value)
            ):
                add_count(colours, converted, f"{source}:{var_name}")
        for match in RADIUS_RE.finditer(text):
            add_count(radii, clean_css_value(match.group(1)), source)
        for match in SHADOW_RE.finditer(text):
            add_count(shadows, clean_css_value(match.group(1)), source)

    return {
        "hex_colours": sorted(colours.values(), key=lambda item: (-item["count"], item["value"])),
        "function_colours": sorted(
            function_colours.values(), key=lambda item: (-item["count"], item["value"])
        ),
        "gradients": sorted(gradients.values(), key=lambda item: (-item["count"], item["value"])),
        "font_families": sorted(fonts.values(), key=lambda item: (-item["count"], item["value"])),
        "font_faces": sorted(font_faces.values(), key=lambda item: (-item["count"], item["value"])),
        "css_variables": css_vars,
        "radii": sorted(radii.values(), key=lambda item: (-item["count"], item["value"])),
        "shadows": sorted(shadows.values(), key=lambda item: (-item["count"], item["value"])),
    }


def clean_css_value(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().strip("\"'"))


def normalise_font_list(value: str) -> str:
    parts = [clean_css_value(part) for part in value.split(",")]
    return ", ".join(part for part in parts if part)


def google_font_families(url: str) -> list[str]:
    parsed = urllib.parse.urlparse(url)
    if parsed.netloc not in {"fonts.googleapis.com", "fonts.gstatic.com"}:
        return []
    query = urllib.parse.parse_qs(parsed.query)
    families: list[str] = []
    for raw in query.get("family", []):
        name = raw.split(":", 1)[0].replace("+", " ").strip()
        if name:
            families.append(name)
    return families


def collect_candidates(
    parser: HeadParser, base_url: str
) -> tuple[list[dict[str, str]], list[dict[str, str]], dict[str, str]]:
    css_links: list[dict[str, str]] = []
    asset_links: list[dict[str, str]] = []
    metadata: dict[str, str] = {}

    def append_asset(item: dict[str, str]) -> None:
        if not is_archive_chrome_asset(item["url"]):
            asset_links.append(item)

    for link in parser.links:
        href = link.get("href", "")
        if not href:
            continue
        rels = rel_tokens(link)
        absolute = abs_url(base_url, href)
        if is_archive_chrome_asset(absolute):
            continue
        if "stylesheet" in rels:
            css_links.append(
                {"url": absolute, "rel": link.get("rel", ""), "media": link.get("media", "")}
            )
        if rels.intersection({"icon", "shortcut", "apple-touch-icon", "mask-icon", "manifest"}):
            kind = "manifest" if "manifest" in rels else "icon"
            append_asset(
                {
                    "url": absolute,
                    "kind": kind,
                    "rel": link.get("rel", ""),
                    "sizes": link.get("sizes", ""),
                }
            )
        for family in google_font_families(absolute):
            metadata.setdefault("google_fonts", "")
            metadata["google_fonts"] += (", " if metadata["google_fonts"] else "") + family

    for meta in parser.metas:
        key = meta_key(meta)
        content = meta.get("content", "")
        if not key or not content:
            continue
        if key in {
            "description",
            "og:title",
            "og:site_name",
            "og:description",
            "og:url",
            "twitter:title",
            "twitter:description",
            "application-name",
            "apple-mobile-web-app-title",
            "theme-color",
            "msapplication-tilecolor",
        }:
            metadata[key] = content
        if key in {
            "og:image",
            "og:image:url",
            "twitter:image",
            "twitter:image:src",
            "msapplication-tileimage",
        }:
            append_asset(
                {"url": abs_url(base_url, content), "kind": "social-image", "rel": key, "sizes": ""}
            )

    logoish = re.compile(r"logo|brand|wordmark|mark", re.I)
    for image in parser.images:
        src = image.get("src") or image.get("data-src") or ""
        label = " ".join([image.get("alt", ""), image.get("class", ""), image.get("id", "")])
        image_url = abs_url(base_url, src) if src else ""
        if image_url and logoish.search(src + " " + label):
            append_asset(
                {"url": image_url, "kind": "logo-candidate", "rel": label.strip(), "sizes": ""}
            )

    for item in extract_jsonld_assets(parser.jsonld, base_url):
        append_asset(item)

    return css_links, dedupe_assets(asset_links), metadata


def dedupe_assets(items: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: dict[str, dict[str, str]] = {}
    out: list[dict[str, str]] = []
    for item in items:
        url = item["url"]
        if url in seen:
            merge_asset_fields(seen[url], item)
            continue
        copied = dict(item)
        seen[url] = copied
        out.append(copied)
    return out


def merge_asset_fields(existing: dict[str, str], incoming: dict[str, str]) -> None:
    for field in ("kind", "rel", "sizes"):
        value = incoming.get(field, "").strip()
        if not value:
            continue
        current = existing.get(field, "").strip()
        current_parts = [part.strip() for part in current.split(",") if part.strip()]
        if value not in current_parts:
            existing[field] = ", ".join([*current_parts, value])


def extract_jsonld_assets(blocks: list[str], base_url: str) -> list[dict[str, str]]:
    assets: list[dict[str, str]] = []
    for block in blocks:
        try:
            parsed = json.loads(block)
        except json.JSONDecodeError:
            continue
        walk_jsonld(parsed, base_url, assets)
    return assets


def walk_jsonld(
    value: Any, base_url: str, assets: list[dict[str, str]], key_hint: str = ""
) -> None:
    if isinstance(value, list):
        for item in value:
            walk_jsonld(item, base_url, assets, key_hint)
        return
    if isinstance(value, dict):
        direct_url = value.get("url") or value.get("contentUrl")
        if key_hint in {"logo", "image"} and isinstance(direct_url, str):
            assets.append(
                {
                    "url": abs_url(base_url, direct_url),
                    "kind": f"schema-{key_hint}",
                    "rel": "json-ld",
                    "sizes": "",
                }
            )
        for key, item in value.items():
            key_lower = str(key).lower()
            if key_lower in {"logo", "image"}:
                if isinstance(item, str):
                    assets.append(
                        {
                            "url": abs_url(base_url, item),
                            "kind": f"schema-{key_lower}",
                            "rel": "json-ld",
                            "sizes": "",
                        }
                    )
                else:
                    walk_jsonld(item, base_url, assets, key_lower)
            else:
                walk_jsonld(item, base_url, assets, key_hint)


def download_asset(
    item: dict[str, str], out_dir: Path, root_dir: Path, timeout: int, max_bytes: int
) -> dict[str, str]:
    url = item["url"]
    data, final_url, content_type = request_url(url, timeout=timeout, max_bytes=max_bytes)
    ext = (
        mimetypes.guess_extension(content_type)
        or Path(urllib.parse.urlparse(final_url).path).suffix
    )
    filename = safe_filename(final_url, ext or "")
    if ext:
        stem, _old_ext = os.path.splitext(filename)
        filename = f"{stem}{ext[:12]}"
    path = out_dir / filename
    path.write_bytes(data)
    try:
        path_label = str(path.relative_to(root_dir))
    except ValueError:
        path_label = str(path)
    return {
        **item,
        "final_url": final_url,
        "content_type": content_type,
        "bytes": str(len(data)),
        "path": path_label,
    }


def fetch_manifests(
    manifest_items: list[dict[str, str]],
    raw_dir: Path,
    timeout: int,
    max_bytes: int,
) -> tuple[list[dict[str, str]], list[dict[str, str]], dict[str, str]]:
    manifest_sources: list[dict[str, str]] = []
    manifest_assets: list[dict[str, str]] = []
    metadata: dict[str, str] = {}

    for index, item in enumerate(manifest_items, start=1):
        try:
            data, final_url, content_type = request_url(
                item["url"], timeout=timeout, max_bytes=max_bytes
            )
            text = decode_text(data, content_type)
            filename = f"manifest-{index:02d}-{safe_filename(final_url, '.json')}"
            path = raw_dir / filename
            path.write_text(text, encoding="utf-8")
            manifest_sources.append({**item, "final_url": final_url, "path": f"raw/{filename}"})
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError as exc:
                manifest_sources[-1]["error"] = f"invalid JSON: {exc}"
                continue
            for field in ("name", "short_name", "theme_color", "background_color", "description"):
                value = parsed.get(field)
                if isinstance(value, str) and value.strip():
                    metadata[f"manifest:{field}"] = value.strip()
            for icon in (
                parsed.get("icons", []) if isinstance(parsed.get("icons", []), list) else []
            ):
                if isinstance(icon, dict) and isinstance(icon.get("src"), str):
                    icon_url = abs_url(final_url, icon["src"])
                    if not is_archive_chrome_asset(icon_url):
                        manifest_assets.append(
                            {
                                "url": icon_url,
                                "kind": "manifest-icon",
                                "rel": "manifest icons",
                                "sizes": str(icon.get("sizes", "")),
                            }
                        )
        except Exception as exc:
            manifest_sources.append({**item, "error": str(exc)})

    return manifest_sources, manifest_assets, metadata


def run(args: argparse.Namespace) -> int:
    input_url = normalise_input(args.url)
    out_dir = Path(args.out).resolve()
    raw_dir = out_dir / "raw"
    css_dir = raw_dir / "css"
    asset_dir = raw_dir / "assets" / "candidates"
    css_dir.mkdir(parents=True, exist_ok=True)
    asset_dir.mkdir(parents=True, exist_ok=True)
    for asset_subdir in ("logos", "icons", "images", "screenshots"):
        (out_dir / "assets" / asset_subdir).mkdir(parents=True, exist_ok=True)

    html_bytes, final_url, content_type = request_url(
        input_url, timeout=args.timeout, max_bytes=args.max_html_bytes
    )
    html_text = decode_text(html_bytes, content_type)
    (raw_dir / "index.html").write_text(html_text, encoding="utf-8")

    parser = HeadParser()
    parser.feed(html_text)
    css_links, asset_candidates, metadata = collect_candidates(parser, final_url)

    css_texts: list[tuple[str, str]] = []
    css_fetches: list[dict[str, str]] = []
    for index, css in enumerate(css_links[: args.max_css], start=1):
        try:
            data, css_final_url, css_content_type = request_url(
                css["url"], timeout=args.timeout, max_bytes=args.max_css_bytes
            )
            text = decode_text(data, css_content_type)
            filename = f"{index:02d}-{safe_filename(css_final_url, '.css')}"
            (css_dir / filename).write_text(text, encoding="utf-8")
            css_texts.append((f"raw/css/{filename}", text))
            css_fetches.append({**css, "final_url": css_final_url, "path": f"raw/css/{filename}"})
        except Exception as exc:
            css_fetches.append({**css, "error": str(exc)})

    manifest_candidates = [item for item in asset_candidates if item["kind"] == "manifest"]
    non_manifest_candidates = [item for item in asset_candidates if item["kind"] != "manifest"]
    manifest_sources, manifest_assets, manifest_metadata = fetch_manifests(
        manifest_candidates,
        raw_dir,
        timeout=args.timeout,
        max_bytes=args.max_asset_bytes,
    )
    metadata.update(manifest_metadata)

    downloaded_assets: list[dict[str, str]] = []
    failed_assets: list[dict[str, str]] = []
    for item in dedupe_assets(non_manifest_candidates + manifest_assets)[: args.max_assets]:
        try:
            downloaded_assets.append(
                download_asset(item, asset_dir, out_dir, args.timeout, args.max_asset_bytes)
            )
        except Exception as exc:
            failed_assets.append({**item, "error": str(exc)})

    style_inputs = [("raw/index.html", html_text)]
    style_inputs.extend(
        (f"inline-style-{i}", text) for i, text in enumerate(parser.styles, start=1)
    )
    style_inputs.extend(css_texts)
    signals = extract_style_signals(style_inputs)
    for meta_name in ("theme-color", "msapplication-tilecolor"):
        if meta_name not in metadata:
            continue
        raw_value = metadata[meta_name].strip()
        # Only promote values that parse to real hex so hex_colours stays hex;
        # named colours (e.g. "white") and rgb() forms are skipped here.
        hex_match = HEX_RE.search(raw_value)
        hex_value = (
            expand_hex(hex_match.group(1)) if hex_match else css_rgb_triplet_to_hex(raw_value)
        )
        if not hex_value:
            continue
        signals["hex_colours"].insert(
            0,
            {
                "value": hex_value,
                "count": 1,
                "sources": [f"meta:{meta_name}"],
            },
        )

    tokens = {
        "brand": {
            "input": args.url,
            "resolved_url": final_url,
            "title": parser.title,
            "captured_at": dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat(),
            "confidence": "unreviewed",
        },
        "metadata": metadata,
        "sources": {
            "html": {"url": final_url, "path": "raw/index.html", "content_type": content_type},
            "css": css_fetches,
            "manifest": manifest_sources,
        },
        "signals": signals,
        "assets": {
            "downloaded": downloaded_assets,
            "failed": failed_assets,
        },
        "unknowns": [
            "Review whether assets are official and current.",
            "Review font licences before bundling font files.",
            "Promote only repeated or official signals into tokens.json.",
        ],
    }

    write_json(out_dir / "tokens.raw.json", tokens)
    write_sources(out_dir / "sources.md", tokens)
    print(f"Captured {final_url}")
    print(f"Wrote {out_dir / 'tokens.raw.json'}")
    print(f"Downloaded {len(downloaded_assets)} assets; fetched {len(css_fetches)} CSS files")
    return 0


def write_sources(path: Path, tokens: dict[str, Any]) -> None:
    lines = [
        "# Brand Capture Sources",
        "",
        f"- Captured at: `{tokens['brand']['captured_at']}`",
        f"- Input: `{tokens['brand']['input']}`",
        f"- Resolved URL: {tokens['brand']['resolved_url']}",
        f"- Title: {tokens['brand']['title'] or 'unknown'}",
        "",
        "## HTML",
        "",
        f"- {tokens['sources']['html']['url']} -> `{tokens['sources']['html']['path']}`",
        "",
        "## CSS",
        "",
    ]
    for css in tokens["sources"]["css"]:
        if "error" in css:
            lines.append(f"- {css['url']} -> ERROR: {css['error']}")
        else:
            lines.append(f"- {css['final_url']} -> `{css['path']}`")
    lines.extend(["", "## Manifests", ""])
    for manifest in tokens["sources"].get("manifest", []):
        if "error" in manifest:
            lines.append(f"- {manifest['url']} -> ERROR: {manifest['error']}")
        else:
            lines.append(f"- {manifest['final_url']} -> `{manifest['path']}`")
    lines.extend(["", "## Assets", ""])
    for asset in tokens["assets"]["downloaded"]:
        lines.append(
            f"- {asset['kind']} `{asset['path']}` from {asset['final_url']} "
            f"({asset['content_type'] or 'unknown'}, {asset['bytes']} bytes)"
        )
    for asset in tokens["assets"]["failed"]:
        lines.append(f"- FAILED {asset['kind']} {asset['url']}: {asset['error']}")
    lines.extend(["", "## Review Notes", ""])
    for note in tokens["unknowns"]:
        lines.append(f"- {note}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="URL, domain, or local HTML file to capture")
    parser.add_argument("--out", default="brand-capture", help="Output directory")
    parser.add_argument("--timeout", type=int, default=20, help="Network timeout in seconds")
    parser.add_argument("--max-css", type=int, default=12, help="Maximum stylesheets to fetch")
    parser.add_argument(
        "--max-assets", type=int, default=24, help="Maximum candidate assets to fetch"
    )
    parser.add_argument("--max-html-bytes", type=int, default=2_000_000)
    parser.add_argument("--max-css-bytes", type=int, default=1_000_000)
    parser.add_argument("--max-asset-bytes", type=int, default=5_000_000)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return run(args)
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        print(f"capture_web_brand.py: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
