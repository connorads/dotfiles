# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest"]
# ///
"""Tests for the _ghapi shared core."""

import pytest
from _ghapi import gh_api_decision


class TestIsMutatingGhApi:
    @pytest.mark.parametrize(
        "command",
        [
            # Explicit -X / --method with mutating verbs
            "gh api repos/foo/bar -X POST",
            "gh api repos/foo/bar -XPOST",
            "gh api repos/foo/bar -X PUT",
            "gh api repos/foo/bar -X PATCH",
            "gh api repos/foo/bar -X DELETE",
            "gh api repos/foo/bar --method POST",
            "gh api repos/foo/bar --method=POST",
            "gh api repos/foo/bar --method PUT",
            "gh api repos/foo/bar --method=DELETE",
            "gh api repos/foo/bar -X post",
            "gh api repos/foo/bar --method=patch",
            'gh api repos/foo/bar -X POST -f body="hello"',
            'gh api -X POST repos/foo/bar -f body="hello"',
            # Implicit POST via -f / -F / --raw-field / --field / --input
            "gh api repos/foo/bar/issues/1/comments -f body='hello'",
            "gh api repos/foo/bar/issues -f title='bug' -f body='desc'",
            "gh api gists -F 'files[f.txt][content]=@f.txt'",
            "gh api repos/foo/bar/issues --field title=bug",
            "gh api repos/foo/bar/issues --field=title=bug",
            "gh api repos/foo/bar/issues --raw-field body=hello",
            "gh api repos/foo/bar/issues --raw-field=body=hello",
            "gh api repos/foo/bar/rulesets --input payload.json",
            "gh api repos/foo/bar/rulesets --input=payload.json",
            "gh api repos/foo/bar/issues/1/comments --input -",
            # A GET in one sub-command must not mask an implicit POST in another
            "gh api /user -X GET && gh api repos/foo/bar/issues -f body=hi",
            "gh api /user --method GET; gh api repos/foo/bar/issues --field title=bug",
            "gh api /user -X GET | gh api repos/foo/bar/issues -f body=hi",
            # An explicit mutating method anywhere in a compound line is flagged
            "gh api /user -X GET && gh api repos/foo/bar -X POST",
            "gh api -X GET search/issues -f q=foo && gh api repos/foo/bar -X POST",
            # A method substring inside a quoted value is not a flag
            "gh api repos/foo/bar/issues -f body='see -X GET docs'",
            'gh api repos/foo/bar/issues -f body="use --method GET"',
            # Body-param flag glued to its value (pflag shorthand) still POSTs
            "gh api repos/foo/bar/issues -fbody=hi",
            # Flags before the gh invocation do not matter; flags after it still do.
            'repo=$(echo "$f" | cut -d/ -f1-2); gh api repos/foo/bar/issues -f body=hi',
            # GraphQL: a top-level mutation operation
            "gh api graphql -f query='mutation { addStar(input:{}){ id } }'",
            # GraphQL: multi-op document containing a mutation
            "gh api graphql -f query='query A { viewer { login } } mutation B { addStar(input:{}){ id } }'",
            # GraphQL: uninspectable documents err safe -> flagged
            "gh api graphql -f query=@query.graphql",
            "gh api graphql -f query=@-",
            # GraphQL: no query field to inspect -> flagged
            "gh api graphql -f variables='{}'",
            # GraphQL read alongside a REST POST in another segment
            "gh api graphql -f query='{ viewer { login } }' && gh api repos/foo/bar -f body=hi",
            # GraphQL: an explicit -X POST override is still a write
            "gh api graphql -X POST -f query='{ viewer { login } }'",
        ],
    )
    def test_detects_mutating_calls(self, command: str) -> None:
        assert gh_api_decision(command) is not None

    @pytest.mark.parametrize(
        "command",
        [
            "gh api repos/foo/bar/releases --jq '.[0].tag_name'",
            "gh api repos/foo/bar",
            "gh api /user",
            "gh api repos/foo/bar -X GET",
            "gh api repos/foo/bar --method GET",
            # Explicit GET overrides implicit-POST inference from body params
            "gh api repos/foo/bar -X GET -f ref=v1",
            "gh api -X GET repos/foo/bar -f ref=v1",
            "gh api repos/foo/bar -XGET -f ref=v1",
            "gh api repos/foo/bar --method GET -f ref=v1",
            "gh api repos/foo/bar --method=GET --field ref=v1",
            "echo x; gh api /user; gh api -X GET search/issues -f q=foo",
            "echo '=== issue 41102 ==='; gh api repos/anthropics/claude-code/issues/41102 --jq '{number,title,state}' 2>&1 | head -5; echo '=== issue 49180 ==='; gh api repos/anthropics/claude-code/issues/49180 --jq '{number,title,state}' 2>&1 | head -5; echo '=== search computer-use ==='; gh api -X GET search/issues -f q='repo:anthropics/claude-code computer-use mcp' --jq '.total_count' 2>&1 | head -5",
            "gh api -X GET search/issues -f q=foo | jq .total_count",
            "gh api --help",
            "gh api repos/foo/bar --paginate",
            "gh api repos/foo/bar -H 'Accept: application/json'",
            'repo=$(echo "$f" | cut -d/ -f1-2); gh api "repos/$f" -H "Accept: application/vnd.github.raw" | grep -nE "child_process|execSync|spawn|eval\\(|fetch\\(|https?://|require\\(|process\\.env" | head -15',
            'for f in "owner/repo/contents/file"; do repo=$(echo "$f" | cut -d/ -f1-2); gh api "repos/$f" -H "Accept: application/vnd.github.raw" | grep -nE "child_process|execSync|spawn|eval\\(|fetch\\(|https?://|require\\(|process\\.env" | head -15; done',
            # GraphQL reads: graphql always POSTs, but these are read operations
            "gh api graphql -f query='{ viewer { login } }'",
            "gh api graphql -f query='query Me { viewer { login } }'",
            "gh api graphql -f query='query($n:String!){ user(login:$n){ id } }' -f n=connorads",
            "gh api graphql -f query='fragment F on User { login } query { viewer { ...F } }'",
            "gh api graphql -f query='subscription { onEvent { id } }'",
            # GraphQL read across -F / glued / long body-param forms
            "gh api graphql -F query='{ viewer { login } }'",
            "gh api graphql -fquery='{ viewer { login } }'",
            "gh api graphql --field=query='{ viewer { login } }'",
            # GraphQL read with an explicit GET override
            "gh api graphql --method GET -f query='{ viewer { login } }'",
            # GraphQL read with extra operationName / variables fields
            "gh api graphql -f query='query Q { viewer { login } }' -f operationName=Q -F variables='{}'",
            # A field literally named `mutation` inside a selection set is a read
            "gh api graphql -f query='{ repository { mutation } }'",
            # The originally reported account-stats command
            "gh api graphql -f query='{ user(login:\"connorads\"){ createdAt contributionsCollection { ... } } }'",
        ],
    )
    def test_allows_read_only_calls(self, command: str) -> None:
        assert gh_api_decision(command) is None

    @pytest.mark.parametrize(
        "command",
        [
            "git commit -m 'fix'",
            "ls -la",
            "echo hello",
            "gh pr view 123",
            "gh issue list",
        ],
    )
    def test_ignores_non_gh_api_commands(self, command: str) -> None:
        assert gh_api_decision(command) is None

    @pytest.mark.parametrize(
        "command",
        [
            # Commit messages mentioning gh api flags should not trigger
            'git commit -m "allow gh api, gate -f and --field flags"',
            'dotfiles commit -m "hook for gh api -X POST and --input"',
            "git commit -m \"$(cat <<'EOF'\nallow gh api, gate -f and --raw-field\nEOF\n)\"",
        ],
    )
    def test_ignores_gh_api_in_commit_messages(self, command: str) -> None:
        assert gh_api_decision(command) is None
