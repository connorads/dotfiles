"""Unit tests for single_html_page.py's pure helpers (no monolith needed)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

import single_html_page as shp


class TestBaseUrlFor:
    def test_url_target_gets_no_base(self):
        assert shp.base_url_for("https://example.com/page") is None

    def test_stdin_target_gets_no_base(self):
        assert shp.base_url_for("-") is None

    def test_local_file_gets_parent_dir_file_uri(self, tmp_path):
        page = tmp_path / "site" / "index.html"
        page.parent.mkdir()
        page.write_text("<html></html>")
        base = shp.base_url_for(str(page))
        assert base == page.parent.as_uri() + "/"
        assert base.startswith("file://")
        assert base.endswith("/")


class TestDefaultOutput:
    def test_url_slugs_host_and_path(self):
        out = shp.default_output("https://example.com/docs/intro")
        assert out.name == "example.com-docs-intro-shareable.html"

    def test_local_file_appends_suffix(self):
        assert shp.default_output("page.html").name == "page-shareable.html"


class TestStripping:
    def test_base_tags_removed(self):
        assert shp.strip_base_tags('<head><base href="/x/"><title>t</title></head>') == (
            "<head><title>t</title></head>"
        )

    def test_network_hint_links_removed_stylesheet_kept(self):
        text = (
            '<link rel="preconnect" href="https://cdn.example.com">'
            '<link rel="stylesheet" href="data:text/css,body{}">'
        )
        result = shp.strip_network_hint_links(text)
        assert "preconnect" not in result
        assert "stylesheet" in result


class TestRemainingAssetRefs:
    def test_data_and_fragment_refs_are_safe(self):
        text = '<img src="data:image/png;base64,AAA"><a href="#top">x</a>'
        assert shp.remaining_asset_refs(text) == []

    def test_external_img_and_css_url_reported(self):
        text = (
            '<img src="https://cdn.example.com/a.png">'
            "<style>body{background:url(https://cdn.example.com/b.png)}</style>"
        )
        refs = shp.remaining_asset_refs(text)
        assert any("a.png" in r for r in refs)
        assert any("CSS url(" in r for r in refs)

    def test_srcset_candidates_parsed(self):
        assert shp.parse_srcset("a.png 1x, b.png 2x") == ["a.png", "b.png"]
