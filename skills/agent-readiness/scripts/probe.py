#!/usr/bin/env python3
"""probe: deterministic agent-readiness checks over a git repository.

Usage:
    probe.py <repo> [--json] [--judged FILE] [--previous FILE]
    probe.py --criteria-md

Reads tracked paths (`git ls-files`), recent history (`git log`) and bounded
contents of a fixed set of config and doc files. It never runs project code,
never prompts and never touches the network.

Each criterion ends as pass, fail, judge (the agent decides, reading the cited
files) or skip (not applicable, or needs an environment such as `gh`).
`--judged` folds the agent's decisions back in; `--previous` diffs against an
earlier `--json` snapshot.

Exit codes: 0 ok; 2 not a git repository, bad arguments or unreadable input.

Layout: functional core (types, REGISTRY, evaluate, score, renderers) with no
I/O, then a thin shell (gather, main) that is the only code touching git or
the filesystem.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field, replace
from datetime import date, datetime
from fnmatch import fnmatch
from pathlib import Path
from typing import Literal

# --- domain types -------------------------------------------------------------

Method = Literal["probe", "judge", "env"]
Scope = Literal["repository", "application"]
Origin = Literal["core", "extension"]
Status = Literal["pass", "fail", "judge", "skip"]
SkipCause = Literal["not_applicable", "environment"]


@dataclass(frozen=True)
class Snapshot:
    """What the shell observed. Built only by `gather`; tests build it directly."""

    paths: frozenset[str]
    texts: Mapping[str, str] = field(default_factory=dict)
    doc_dates: Mapping[str, date] = field(default_factory=dict)
    commit_lines: tuple[str, ...] = ()
    today: date = date(1970, 1, 1)

    def match(self, *globs: str) -> tuple[str, ...]:
        return tuple(
            sorted(
                p
                for p in self.paths
                if not NOT_PROJECT.search(p) and any(_glob(p, g) for g in globs)
            )
        )

    def grep(self, globs: Iterable[str], pattern: str) -> tuple[str, ...]:
        rx = re.compile(pattern, re.I | re.M)
        return tuple(p for p in self.match(*globs) if rx.search(self.texts.get(p, "")))

    def text(self, *globs: str) -> str:
        return "\n".join(self.texts.get(p, "") for p in self.match(*globs))


# Test fixtures and vendored code describe someone else's project, not this one.
NOT_PROJECT = re.compile(
    r"(^|/)(fixtures|__fixtures__|testdata|test-corpus|vendor|vendored|third_party|node_modules)/"
)


def _glob(path: str, pattern: str) -> bool:
    """Globs match the whole path; a leading `**/` also matches at any depth."""
    if pattern.startswith("**/"):
        rest = pattern[3:]
        return fnmatch(path, rest) or fnmatch(path, "*/" + rest)
    return fnmatch(path, pattern)


@dataclass(frozen=True)
class Pass:
    evidence: tuple[str, ...]


@dataclass(frozen=True)
class Fail:
    reason: str


@dataclass(frozen=True)
class NeedsJudgement:
    question: str
    candidates: tuple[str, ...] = ()


@dataclass(frozen=True)
class Skip:
    reason: str
    cause: SkipCause


Verdict = Pass | Fail | NeedsJudgement | Skip


@dataclass(frozen=True)
class Criterion:
    id: str
    name: str
    category: str
    level: int
    scope: Scope
    method: Method
    skippable: bool
    outcome: str
    examples: tuple[str, ...]
    check: Callable[[Snapshot], Verdict]
    origin: Origin = "core"
    needs_approval: bool = False


@dataclass(frozen=True)
class Result:
    id: str
    level: int
    origin: Origin
    status: Status
    numerator: float
    denominator: int
    detail: str
    evidence: tuple[str, ...]
    skip_cause: SkipCause | None = None


@dataclass(frozen=True)
class Score:
    flat_pct: float
    flat_level: int
    checks_to_next_level: int | None
    gated_level: int
    gate_gap: int | None
    per_level: Mapping[int, tuple[float, int]]
    pending: int
    env_skipped: int
    flat_pct_range: tuple[float, float] | None


# --- file families (examples of mechanisms, never requirements) ---------------

MANIFESTS = (
    "**/package.json", "**/pyproject.toml", "**/requirements*.txt", "**/Pipfile",
    "**/Cargo.toml", "**/go.mod", "**/Gemfile", "**/composer.json", "**/pom.xml",
    "**/build.gradle", "**/build.gradle.kts", "**/deno.json", "**/deno.jsonc",
    "**/*.csproj", "**/Package.swift", "**/mix.exs",
)  # fmt: skip
CI = (
    ".github/workflows/*.yml", ".github/workflows/*.yaml", ".gitlab-ci.yml",
    ".circleci/config.yml", "azure-pipelines.yml", "bitbucket-pipelines.yml",
    "Jenkinsfile", ".buildkite/*", ".woodpecker.yml", ".drone.yml",
)  # fmt: skip
GIT_HOOKS = (
    ".husky/*", ".pre-commit-config.yaml", "lefthook.yml", "lefthook.yaml",
    ".lefthook.yml", ".lefthook.yaml", "hk.pkl", ".githooks/*", ".hk-hooks/*",
    ".overcommit.yml", ".git-hooks/*",
)  # fmt: skip
AGENT_HOOK_CONFIGS = (
    ".claude/settings.json", ".codex/hooks.json", ".cursor/hooks.json",
    ".gemini/settings.json", ".factory/settings.json",
)  # fmt: skip
ROOT_DOCS = ("README*", "AGENTS.md", "CLAUDE.md", "GEMINI.md", "CONTRIBUTING.md",
             ".github/copilot-instructions.md")  # fmt: skip
TASK_FILES = ("Makefile", "makefile", "GNUmakefile", "justfile", "Justfile", "Taskfile.yml")
LINTER_CONFIGS = (
    "**/.eslintrc*", "**/eslint.config.*", "**/biome.json", "**/biome.jsonc",
    "**/.oxlintrc.json", "**/oxlintrc.json", "**/ruff.toml", "**/.ruff.toml",
    "**/.flake8", "**/.pylintrc", "**/pylintrc", "**/.golangci.y*ml",
    "**/.golangci.toml", "**/clippy.toml", "**/.rubocop.yml", "**/.swiftlint.yml",
    "**/checkstyle*.xml", "**/pmd*.xml", "**/detekt*.yml", "**/.credo.exs",
    "sonar-project.properties", ".sonarcloud.properties", "**/.shellcheckrc",
    "**/.stylelintrc*", "**/.markdownlint*", "**/.rumdl.toml",
)  # fmt: skip
FORMATTER_CONFIGS = (
    "**/.prettierrc*", "**/prettier.config.*", "**/.oxfmtrc.json", "**/biome.json",
    "**/biome.jsonc", "**/dprint.json", "**/.dprint.json", "**/rustfmt.toml",
    "**/.rustfmt.toml", "**/.clang-format", "**/.editorconfig-checker.json",
    "**/.scalafmt.conf", "**/.swiftformat", "**/stylua.toml", "**/.stylua.toml",
    "**/treefmt.toml",
)  # fmt: skip

DB_LIBS = (
    "pg", "postgres", "mysql", "mysql2", "sqlite3", "better-sqlite3", "@prisma/client",
    "prisma", "typeorm", "sequelize", "mongoose", "mongodb", "knex", "drizzle-orm",
    "kysely", "sqlalchemy", "psycopg", "psycopg2", "psycopg2-binary", "asyncpg",
    "django", "peewee", "tortoise-orm", "diesel", "sqlx", "sea-orm", "gorm.io/gorm",
    "github.com/jackc/pgx", "activerecord", "spring-boot-starter-data-jpa",
    "hibernate-core", "ecto_sql",
)  # fmt: skip
SERVICE_LIBS = (
    *DB_LIBS, "redis", "ioredis", "kafkajs", "amqplib", "bullmq", "celery",
    "@elastic/elasticsearch", "elasticsearch", "nats", "pika", "confluent-kafka",
)  # fmt: skip
WEB_LIBS = (
    "express", "fastify", "koa", "hono", "@nestjs/core", "next", "nuxt",
    "@remix-run/node", "@sveltejs/kit", "flask", "fastapi", "django", "starlette",
    "github.com/gin-gonic/gin", "github.com/labstack/echo", "github.com/gofiber/fiber",
    "actix-web", "axum", "rocket", "spring-boot-starter-web", "rails", "sinatra",
    "laravel/framework", "phoenix",
)  # fmt: skip
BUNDLERS = ("vite", "webpack", "next", "rollup", "esbuild", "parcel", "@sveltejs/kit",
            "nuxt", "astro", "@rsbuild/core", "@rspack/core")  # fmt: skip


def _dep_hits(s: Snapshot, names: Iterable[str]) -> tuple[str, ...]:
    """Library names that appear as tokens in any manifest."""
    text = s.text(*MANIFESTS)
    return tuple(
        n for n in names if re.search(r"(?<![\w.@/-])" + re.escape(n) + r"(?![\w-])", text)
    )


# Permission allowlists name commands an agent may run, not commands that run.
AGENT_SETTINGS = (".claude/settings*.json", ".codex/config.toml", ".gemini/settings.json",
                  ".factory/settings.json", "opencode.json", ".cursor/*.json")  # fmt: skip


def _config_files(s: Snapshot, *, include_toolchain: bool = False) -> tuple[str, ...]:
    """Files that show what the project runs. Prose, agent allowlists and (by
    default) toolchain manifests are out: a mention there is not a mechanism."""
    skip = set(s.match(*AGENT_SETTINGS))
    if not include_toolchain:
        skip |= set(s.match(*TOOLCHAIN_FILES))
    return tuple(
        p for p in s.texts
        if p not in skip and not NOT_PROJECT.search(p)
        and not p.lower().endswith((".md", ".mdx", ".rst", ".txt"))
    )  # fmt: skip


def _mentions(s: Snapshot, pattern: str, *, include_toolchain: bool = False) -> tuple[str, ...]:
    rx = re.compile(pattern, re.I | re.M)
    files = _config_files(s, include_toolchain=include_toolchain)
    return tuple(sorted(p for p in files if rx.search(s.texts[p])))


def _doc_mentions(s: Snapshot, pattern: str) -> tuple[str, ...]:
    return s.grep(ALL_DOCS, pattern)


# --- check combinators ---------------------------------------------------------


def _first(*verdicts: Callable[[], Verdict | None], otherwise: Verdict) -> Verdict:
    for v in verdicts:
        got = v()
        if got is not None:
            return got
    return otherwise


def _paths(*globs: str) -> Callable[[Snapshot], Pass | None]:
    def f(s: Snapshot) -> Pass | None:
        hits = s.match(*globs)
        return Pass(hits[:5]) if hits else None

    return f


def _config(pattern: str) -> Callable[[Snapshot], Pass | None]:
    def f(s: Snapshot) -> Pass | None:
        hits = _mentions(s, pattern)
        return Pass(hits[:5]) if hits else None

    return f


def _deps(*names: str) -> Callable[[Snapshot], Pass | None]:
    def f(s: Snapshot) -> Pass | None:
        hits = _dep_hits(s, names)
        return Pass(tuple(f"dependency: {h}" for h in hits[:5])) if hits else None

    return f


def _docs(pattern: str) -> Callable[[Snapshot], Pass | None]:
    def f(s: Snapshot) -> Pass | None:
        hits = _doc_mentions(s, pattern)
        return Pass(hits[:5]) if hits else None

    return f


def any_of(
    *probes: Callable[[Snapshot], Verdict | None], fail: str = ""
) -> Callable[[Snapshot], Verdict]:
    """First probe with a verdict wins, else Fail with `fail`. A last probe may judge."""

    def check(s: Snapshot) -> Verdict:
        for p in probes:
            got = p(s)
            if got is not None:
                return got
        return Fail(fail)

    return check


def or_skip_env(check: Callable[[Snapshot], Verdict], why: str) -> Callable[[Snapshot], Verdict]:
    """File evidence can pass; its absence is unknown without forge access."""

    def wrapped(s: Snapshot) -> Verdict:
        got = check(s)
        return got if isinstance(got, Pass) else Skip(why, "environment")

    return wrapped


def only_if(
    applies: Callable[[Snapshot], bool], reason: str, check: Callable[[Snapshot], Verdict]
) -> Callable[[Snapshot], Verdict]:
    def wrapped(s: Snapshot) -> Verdict:
        return check(s) if applies(s) else Skip(reason, "not_applicable")

    return wrapped


def _has_ci(s: Snapshot) -> bool:
    return bool(s.match(*CI))


def _multi_package(s: Snapshot) -> bool:
    return len(s.match(*MANIFESTS)) > 1 or bool(s.match("go.work"))


def _uses(names: tuple[str, ...]) -> Callable[[Snapshot], bool]:
    return lambda s: bool(_dep_hits(s, names))


def _is_infra(s: Snapshot) -> bool:
    return bool(
        s.match("**/Dockerfile*", "**/*.tf", "**/Chart.yaml", "k8s/**", "**/kustomization.y*ml",
                "fly.toml", "render.yaml", "app.yaml", "serverless.y*ml", "wrangler.toml",
                "wrangler.json*", "vercel.json", "netlify.toml")
        or _mentions(s, r"\b(deploy|kubectl|helm upgrade|terraform apply)\b")
    )  # fmt: skip


# --- individual checks -----------------------------------------------------------


def c_lint_config(s: Snapshot) -> Verdict:
    return _first(
        lambda: _paths(*LINTER_CONFIGS)(s),
        lambda: _config(r"^\[tool\.(ruff|pylint|flake8)|\b(eslint|oxlint|biome (lint|check)|ruff check|golangci-lint|clippy|rubocop|checkstyle|spotbugs|errorprone|detekt|ktlint|swiftlint|shellcheck|deno lint)\b")(s),
        otherwise=Fail("no linter config or lint command found"),
    )  # fmt: skip


def c_type_check(s: Snapshot) -> Verdict:
    return _first(
        lambda: _paths("**/tsconfig*.json", "**/jsconfig.json", "**/mypy.ini", "**/.mypy.ini",
                       "**/pyrefly.toml", "**/pyrightconfig.json", "**/go.mod", "**/Cargo.toml",
                       "**/pom.xml", "**/build.gradle", "**/build.gradle.kts", "**/*.csproj",
                       "**/Package.swift", "**/deno.json", "**/deno.jsonc")(s),
        lambda: _config(r"^\[tool\.(mypy|pyright|basedpyright|pyrefly)\]|\b(flow check|sorbet|dialyzer|mypy|pyright|ty check)\b")(s),
        otherwise=Fail("no type checker config and no statically typed build"),
    )  # fmt: skip


def c_formatter(s: Snapshot) -> Verdict:
    return _first(
        lambda: _paths(*FORMATTER_CONFIGS)(s),
        lambda: _config(r"^\[tool\.(black|ruff\.format|yapf)\]|\b(prettier|oxfmt|biome format|ruff format|black|gofmt|goimports|rustfmt|cargo fmt|spotless|google-java-format|ktfmt|shfmt|nixfmt|dprint|deno fmt|mix format|swiftformat|clang-format)\b")(s),
        lambda: Pass(("go.mod: gofmt is the language default",)) if s.match("**/go.mod") else None,
        otherwise=Fail("no formatter config or format command found"),
    )  # fmt: skip


def c_pre_commit_hooks(s: Snapshot) -> Verdict:
    return _first(
        lambda: _paths(*GIT_HOOKS)(s),
        lambda: (lambda h: Pass(h) if h else None)(
            s.grep(("**/package.json",), r'"(simple-git-hooks|husky|lint-staged|pre-commit)"\s*:')
        ),
        lambda: (lambda h: Pass(h) if h else None)(s.grep(AGENT_HOOK_CONFIGS, r'"hooks"\s*:')),
        otherwise=Fail("no local gate: no git hook manager, hook scripts or agent edit hooks (CI-only checks do not count)"),
    )  # fmt: skip


BUILD_CMD = (
    r"(?:^\s*|`|\$\s)((npm|pnpm|yarn|bun) (run )?(build|compile|install|i)\b|make( \w+)?\b|cargo (build|check)"
    r"|go (build|install)|\./gradlew|\./mvnw|mvn |gradle |uv (sync|build|run)|pip install"
    r"|poetry (install|build)|mise run|just \w+|task \w+|nix (build|develop)|deno task"
    r"|dotnet build|swift build|mix compile|bundle install|docker (compose )?build)"
)


def c_build_cmd_doc(s: Snapshot) -> Verdict:
    docs = s.match(*ROOT_DOCS)
    if not docs:
        return Fail("no README or agent instructions to document a build command")
    hits = s.grep(ROOT_DOCS, BUILD_CMD)
    if hits:
        return Pass(hits)
    return NeedsJudgement(
        "Do the docs say how to build or install, or state that no build step exists?", docs
    )


LOCKS = {
    "package.json": ("package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock",
                     "bun.lockb", "npm-shrinkwrap.json", "deno.lock"),
    "pyproject.toml": ("uv.lock", "poetry.lock", "pdm.lock", "Pipfile.lock", "pylock.toml",
                       "requirements*.txt"),
    "Pipfile": ("Pipfile.lock",),
    "Cargo.toml": ("Cargo.lock",),
    "go.mod": ("go.sum",),
    "Gemfile": ("Gemfile.lock",),
    "composer.json": ("composer.lock",),
    "flake.nix": ("flake.lock",),
    "deno.json": ("deno.lock",),
    "mix.exs": ("mix.lock",),
    "Package.swift": ("Package.resolved",),
}  # fmt: skip


def _loose_requirements(s: Snapshot) -> tuple[str, ...]:
    """requirements files with a line that is not pinned with ==."""
    rx = re.compile(r"^[A-Za-z0-9_.\-\[\]]+\s*(>=|~=|>|<|$)", re.M)
    return tuple(r for r in s.match("**/requirements*.txt") if rx.search(s.texts.get(r, "")))


def c_deps_pinned(s: Snapshot) -> Verdict:
    ecosystems = sorted(m for m in LOCKS if s.match("**/" + m))
    java = s.match("**/pom.xml", "**/build.gradle", "**/build.gradle.kts")
    reqs = s.match("**/requirements*.txt")
    if not ecosystems and not java and not reqs:
        return Skip("no dependency manifests", "not_applicable")
    unpinned = [m for m in ecosystems if not s.match(*("**/" + lock for lock in LOCKS[m]))]
    python_locked = s.match(
        "**/uv.lock", "**/poetry.lock", "**/pdm.lock", "**/pylock.toml", "**/Pipfile.lock"
    )
    if reqs and not python_locked:
        unpinned.extend(f"{r} (not pinned with ==)" for r in _loose_requirements(s))
    if unpinned:
        return Fail("dependencies not locked: " + ", ".join(unpinned))
    if java:
        dynamic = _mentions(
            s, r"<version>(LATEST|RELEASE)</version>|-SNAPSHOT|['\":]\d+(\.\d+)*\.\+"
        )
        if dynamic:
            return Fail("dynamic dependency versions: " + ", ".join(dynamic[:3]))
        if not ecosystems:
            return NeedsJudgement(
                "Are all Maven/Gradle dependency and plugin versions fixed (BOM, catalog or locking), with the wrapper committed?",
                java[:5],
            )
    evidence = s.match(*(("**/" + lock) for m in ecosystems for lock in LOCKS[m])) or reqs
    return Pass(evidence[:5])


def c_vcs_cli_tools(s: Snapshot) -> Verdict:
    return Skip(
        "forge CLI state is not a repo property; check `gh auth status` if wanted", "environment"
    )


TEST_FILES = (
    "**/*.test.*", "**/*.spec.*", "**/__tests__/*", "**/test_*.py", "**/*_test.py",
    "**/*_test.go", "**/src/test/**", "**/*Test.java", "**/*Tests.java", "**/*Test.kt",
    "**/*_spec.rb", "**/*.bats", "**/tests/*.rs", "**/*Tests.swift", "**/*Test.php",
    "**/*_test.exs", "**/t/*.t",
)  # fmt: skip


def c_unit_tests_exist(s: Snapshot) -> Verdict:
    hits = s.match(*TEST_FILES)
    return Pass(hits[:5]) if hits else Fail("no test files found by common naming patterns")


def c_integration_tests_exist(s: Snapshot) -> Verdict:
    separate = tuple(
        p for p in s.match(*TEST_FILES) if p.startswith(("tests/", "test/", "spec/", "e2e/"))
    )
    return _first(
        lambda: _paths("**/*.integration.*", "**/*.int.test.*", "**/*_integration_test.*",
                       "**/integration_test*", "**/*.e2e-spec.*", "**/playwright.config.*", "**/cypress.config.*", "cypress/**",
                       "**/tests/integration/**", "**/test/integration/**", "**/integration/**",
                       "**/e2e/**", "**/*.e2e.*", "**/*.feature", "**/*IT.java",
                       "**/src/integrationTest/**", "**/tests/*.rs", "**/*.bats")(s),
        lambda: _deps("testcontainers", "@testcontainers/postgresql", "supertest",
                      "maven-failsafe-plugin")(s),
        lambda: NeedsJudgement(
            "Do any of these tests exercise components together (CLI end to end, real database, HTTP, subprocesses)?",
            separate[:5],
        ) if separate else None,
        otherwise=Fail("no integration or end-to-end tests found"),
    )  # fmt: skip


def _collect_command(s: Snapshot) -> str | None:
    """A runner-native list/collect command: proves tests load without running them."""
    deps = set(_dep_hits(s, ("vitest", "jest", "pytest", "mocha", "playwright")))
    if "vitest" in deps:
        return "vitest list"
    if "jest" in deps:
        return "jest --listTests"
    if "pytest" in deps or s.match("**/test_*.py", "**/*_test.py"):
        return "python -m pytest --collect-only -q <one test file>"
    if s.match("**/go.mod"):
        return "go test -list . ./<one package>"
    if s.match("**/Cargo.toml"):
        return "cargo test --no-run"
    if s.match("**/*.bats"):
        return "bats --count <one .bats file>"
    if s.match("**/bun.lock", "**/bun.lockb"):
        return "bun test <one test file> (bun has no list mode; this runs one file)"
    return None


def c_unit_tests_runnable(s: Snapshot) -> Verdict:
    if not s.match(*TEST_FILES):
        return Skip("no tests to run", "not_applicable")
    cmd = _collect_command(s)
    hint = f"suggested: `{cmd}`" if cmd else "pick the runner's list or collect mode"
    return NeedsJudgement(
        f"With the user's approval, run a collect-only command for one test file ({hint}). Pass if it loads tests without running the suite.",
        s.match("**/package.json", "**/pyproject.toml", *TASK_FILES)[:5],
    )


def c_test_performance_tracking(s: Snapshot) -> Verdict:
    return any_of(
        _config(r"--durations|--reporter[= ](junit|json)|junit(\.xml|-report|reporter)|test-results|buildpulse|datadog-ci junit|dorny/test-reporter|mikepenz/action-junit-report|--test-timings|--verbose.*time"),
        fail="no test timing output, report upload or test analytics found",
    )(s)  # fmt: skip


def c_flaky_test_detection(s: Snapshot) -> Verdict:
    return or_skip_env(
        any_of(
            _config(r"\bretries\s*[:=]|\bretry\s*:\s*\d|\b(rerunFailingTestsCount|testRetry|pytest-rerunfailures|flaky|vitest-retry|retryTimes)\b|--reruns"),
            fail="",
        ),
        "no retry or flake tooling in files; CI rerun history needs forge access",
    )(s)  # fmt: skip


def c_agents_md(s: Snapshot) -> Verdict:
    for p in ("AGENTS.md", "CLAUDE.md", "GEMINI.md", ".github/copilot-instructions.md"):
        if p in s.paths and len(s.texts.get(p, "").strip()) > 100:
            return Pass((p,))
    if s.match("AGENTS.md", "CLAUDE.md"):
        return Fail("root agent instructions file is under 100 characters")
    return Fail("no agent instructions file at the repo root")


def c_readme(s: Snapshot) -> Verdict:
    readmes = s.match("README*", "readme*")
    if not readmes:
        return Fail("no README at the repo root")
    if max(len(s.texts.get(r, "").strip()) for r in readmes) < 100:
        return Fail("README is under 100 characters")
    return Pass(readmes)


def c_devcontainer(s: Snapshot) -> Verdict:
    return any_of(
        _paths(".devcontainer/devcontainer.json", ".devcontainer/*/devcontainer.json",
               ".devcontainer.json", "flake.nix", "shell.nix", "devbox.json", ".gitpod.yml",
               "Dockerfile.dev", "**/dev.Dockerfile", ".idx/dev.nix"),
        fail="no declared development environment (devcontainer, nix, devbox or similar)",
    )(s)  # fmt: skip


def c_structured_logging(s: Snapshot) -> Verdict:
    return any_of(
        _deps("winston", "pino", "bunyan", "log4js", "consola", "@logtape/logtape", "structlog",
              "loguru", "python-json-logger", "go.uber.org/zap", "github.com/rs/zerolog",
              "github.com/sirupsen/logrus", "tracing", "slog", "log4j-core", "logback-classic",
              "slf4j-api", "serilog", "semantic_logger", "lograge"),
        _paths("**/logger.*", "**/logging.*", "**/log.ts", "**/log.py"),
        fail="no logging library or dedicated logger module",
    )(s)  # fmt: skip


def c_distributed_tracing(s: Snapshot) -> Verdict:
    return any_of(
        _deps("@opentelemetry/api", "@opentelemetry/sdk-node", "opentelemetry-api",
              "opentelemetry-sdk", "go.opentelemetry.io/otel", "opentelemetry", "dd-trace",
              "ddtrace", "micrometer-tracing", "spring-cloud-starter-sleuth", "@sentry/tracing",
              "tracing-opentelemetry"),
        _config(r"x-request-id|traceparent|correlation[-_]id"),
        fail="no trace or request-ID propagation found",
    )(s)  # fmt: skip


def c_metrics_collection(s: Snapshot) -> Verdict:
    return any_of(
        _deps("prom-client", "prometheus_client", "prometheus-client", "hot-shots",
              "node-statsd", "statsd", "datadog", "@datadog/datadog-api-client",
              "@opentelemetry/sdk-metrics", "micrometer-core", "micrometer-registry-prometheus",
              "spring-boot-starter-actuator", "newrelic", "@axiomhq/js", "prometheus",
              "github.com/prometheus/client_golang"),
        fail="no metrics or telemetry instrumentation found",
    )(s)  # fmt: skip


def c_code_quality_metrics(s: Snapshot) -> Verdict:
    return or_skip_env(
        any_of(
            _paths("codecov.yml", ".codecov.yml", ".coveralls.yml", "sonar-project.properties",
                   ".sonarcloud.properties", ".codeclimate.yml", ".deepsource.toml", ".qlty/**"),
            _config(r"--coverage|coverage\s*:\s*\{|\bcoverage\b.*provider|jacoco|codecov|coveralls|sonar|--cov\b"),
            fail="",
        ),
        "no coverage or quality config in files; code-scanning state needs forge admin access",
    )(s)  # fmt: skip


def c_branch_protection(s: Snapshot) -> Verdict:
    return Skip("branch rules live on the forge and need admin access to read", "environment")


def c_secret_scanning(s: Snapshot) -> Verdict:
    return or_skip_env(
        any_of(
            _config(r"gitleaks|trufflehog|detect-secrets|ggshield|secretlint|ripsecrets|trivy.*secret|kingfisher"),
            _paths(".gitleaks.toml", ".secrets.baseline", ".secretlintrc*"),
            fail="",
        ),
        "no secret scanner in files; native forge scanning needs admin access",
    )(s)  # fmt: skip


def c_codeowners(s: Snapshot) -> Verdict:
    hits = s.grep(("CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS", ".gitlab/CODEOWNERS"),
                  r"^\s*[^#\s]\S*\s+@\S+")  # fmt: skip
    return Pass(hits) if hits else Fail("no CODEOWNERS file with owner assignments")


def c_automated_pr_review(s: Snapshot) -> Verdict:
    return or_skip_env(
        any_of(
            _config(r"claude-code-action|codex-action|coderabbit|danger(js)?\b|reviewdog|droid exec|pr-agent|copilot.*review|sourcery|ellipsis|greptile|cubic"),
            _paths(".coderabbit.y*ml", "dangerfile.*", "Dangerfile", ".github/copilot-instructions.md"),
            fail="",
        ),
        "no review bot in files; bot comments on PRs need forge access to see",
    )(s)  # fmt: skip


AGENT_TRAILER = re.compile(
    r"co-authored-by:.*\b(claude|anthropic|codex|openai|copilot|cursor|aider|devin|droid|factory|gemini|amp|jules|opencode)\b"
    r"|generated with \[?claude|\b(claude|codex|copilot|devin|droid|factory-droid|cursor-agent|jules|gemini)[-\w]*\[bot\]",
    re.I,
)
DEP_BOTS = re.compile(r"dependabot|renovate|github-actions|pre-commit-ci|snyk-bot", re.I)


def c_agentic_development(s: Snapshot) -> Verdict:
    trailers = [ln for ln in s.commit_lines if AGENT_TRAILER.search(ln) and not DEP_BOTS.search(ln)]
    if trailers:
        return Pass(tuple(f"git log: {t.strip()[:80]}" for t in trailers[:2]))
    return any_of(
        _paths(".claude/**", ".codex/**", ".factory/**", ".agents/**", ".cursor/**", ".gemini/**",
               ".opencode/**", ".pi/**"),
        _config(r"claude-code-action|codex-action|droid exec|claude -p|codex exec"),
        fail="no agent co-authors in the last 100 commits and no agent config or CI invocations",
    )(s)  # fmt: skip


def c_fast_ci_feedback(s: Snapshot) -> Verdict:
    if not _has_ci(s):
        return Fail("no CI configuration, so there is no CI feedback at all")
    return Skip("CI duration needs run history from the forge", "environment")


def c_build_performance_tracking(s: Snapshot) -> Verdict:
    return or_skip_env(
        any_of(
            _paths("turbo.json", "nx.json", "gradle.properties"),
            _config(r"actions/cache|cache-from|--build-cache|org\.gradle\.caching|configuration-cache|sccache|ccache|buildx.*cache|develocity|gradle-enterprise|turbo run|nx affected"),
            fail="",
        ),
        "no build cache or build metrics in files; build timings need forge run history",
    )(s)  # fmt: skip


def c_deployment_frequency(s: Snapshot) -> Verdict:
    return Skip("deploy cadence needs release or run history from the forge", "environment")


def c_automated_security_review(s: Snapshot) -> Verdict:
    return or_skip_env(
        any_of(
            _config(r"codeql|semgrep|snyk|trivy|grype|osv-scanner|zizmor|bandit|gosec|brakeman|njsscan|checkov|sonar|dependency-review-action"),
            fail="",
        ),
        "no SAST or audit report job in files; forge code-scanning needs admin access",
    )(s)  # fmt: skip


def c_automated_doc_generation(s: Snapshot) -> Verdict:
    return any_of(
        _paths("typedoc.json", "mkdocs.y*ml", "docs/conf.py", "docusaurus.config.*",
               "**/astro.config.*", ".readthedocs.y*ml", "cliff.toml", ".changeset/config.json",
               "release-please-config.json", "Doxyfile", "book.toml", "antora.yml"),
        _config(r"typedoc|sphinx|javadoc|dokka|swagger-jsdoc|openapi-generator|redocly|cargo doc|pdoc|mkdocs|docusaurus|starlight|terraform-docs|git-cliff|conventional-changelog"),
        fail="no configured doc or changelog generation",
    )(s)  # fmt: skip


SKILL_DIRS = (".agents/skills/*/SKILL.md", ".claude/skills/*/SKILL.md", ".factory/skills/*/SKILL.md",
              ".skills/*/SKILL.md", ".codex/skills/*/SKILL.md", ".opencode/skills/*/SKILL.md",
              ".cursor/skills/*/SKILL.md", "skills/*/SKILL.md")  # fmt: skip


ALL_DOCS = (*ROOT_DOCS, "docs/*.md", "docs/**/*.md")


def _valid_skill(text: str) -> bool:
    m = re.match(r"---\n(.*?)\n---\n(.*)", text, re.S)
    if not m:
        return False
    front, body = m.groups()
    return bool(
        re.search(r"^name:\s*\S", front, re.M)
        and re.search(r"^description:\s*\S", front, re.M)
        and body.strip()
    )


def c_skills(s: Snapshot) -> Verdict:
    found = s.match(*SKILL_DIRS)
    valid = tuple(p for p in found if _valid_skill(s.texts.get(p, "")))
    if valid:
        return Pass(valid[:5])
    if found:
        return Fail("SKILL.md files lack name/description frontmatter or a body")
    return Fail("no agent skills directory with a SKILL.md")


def c_documentation_freshness(s: Snapshot) -> Verdict:
    dated = {
        p: d
        for p, d in s.doc_dates.items()
        if p in ("README.md", "AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md")
    }
    fresh = sorted(p for p, d in dated.items() if (s.today - d).days <= 180)
    if fresh:
        return Pass(tuple(f"{p}: {dated[p].isoformat()}" for p in fresh))
    if not dated:
        return Fail("no README, AGENTS.md, CLAUDE.md or CONTRIBUTING.md in history")
    newest = max(dated.values())
    return Fail(f"key docs last changed {newest.isoformat()}, over 180 days ago")


def c_strict_typing(s: Snapshot) -> Verdict:
    tsconfigs = s.match("**/tsconfig*.json")
    strict = _mentions(
        s,
        r'"strict"\s*:\s*true|^\s*strict\s*=\s*true|preset\s*=\s*"strict"|typeCheckingMode"?\s*[:=]\s*"strict"|--strict\b|disallow_untyped_defs\s*=\s*(true|True)',
    )
    if strict:
        return Pass(strict[:5])
    if tsconfigs and any('"extends"' in s.texts.get(t, "") for t in tsconfigs):
        return NeedsJudgement("Does the extended base tsconfig enable `strict`?", tsconfigs[:5])
    python_typed = _mentions(s, r"^\[tool\.(mypy|pyright|basedpyright|pyrefly)\]") or s.match(
        "**/mypy.ini", "**/pyrefly.toml", "**/pyrightconfig.json"
    )
    if tsconfigs or python_typed:
        return Fail("type checker configured without its strict mode")
    return Skip("no gradual type checker with a separate strict mode", "not_applicable")


def c_naming_consistency(s: Snapshot) -> Verdict:
    return any_of(
        _config(r"\b(naming-convention|invalid-name|pep8-naming|NamingConventions|id-match|camelcase|useNamingConvention)\b|select\s*=\s*\[[^\]]*[\"']N[\"']|checkstyle.*Name"),
        _docs(r"^#+ .*\bnaming\b|\bnaming (conventions?|rules?|style)\b|\b(use|prefer)\s+`?(camelCase|snake_case|PascalCase|kebab-case)"),
        fail="no naming rule in lint config and no documented naming convention",
    )(s)  # fmt: skip


def c_cyclomatic_complexity(s: Snapshot) -> Verdict:
    return any_of(
        _config(r"\bcomplexity\b|C901|mccabe|max-complexity|radon|lizard|gocyclo|gocognit|CyclomaticComplexity|CognitiveComplexity|NPathComplexity|cognitive_complexity|sonar|noExcessiveCognitiveComplexity"),
        fail="no complexity rule or analyser configured",
    )(s)  # fmt: skip


def c_single_command_setup(s: Snapshot) -> Verdict:
    docs = s.match(*ROOT_DOCS, *SKILL_DIRS)
    if not docs:
        return Fail("no docs to hold a setup command")
    return NeedsJudgement(
        "From a fresh clone, do the docs give one command or a short sequence that reaches a running dev target (tests or app)?",
        (*docs[:4], *s.match(*TASK_FILES, "package.json")[:2]),
    )


FLAG_LIBS = ("launchdarkly-node-server-sdk", "@launchdarkly/node-server-sdk", "launchdarkly-js-client-sdk",
             "launchdarkly-server-sdk", "statsig-node", "@statsig/js-client", "statsig", "unleash-client",
             "@unleash/proxy-client-react", "@growthbook/growthbook", "growthbook", "flagsmith",
             "@openfeature/server-sdk", "@openfeature/web-sdk", "openfeature-sdk", "configcat-node",
             "@vercel/flags", "flags", "posthog-node", "posthog-js", "@flipt-io/flipt")  # fmt: skip


def c_feature_flag_infrastructure(s: Snapshot) -> Verdict:
    return any_of(
        _deps(*FLAG_LIBS),
        _paths("**/feature-flags.*", "**/featureFlags.*", "**/feature_flags.*", "**/flags.ts"),
        fail="no feature flag SDK or flag module",
    )(s)


def c_release_notes_automation(s: Snapshot) -> Verdict:
    return any_of(
        _paths(".changeset/config.json", "release-please-config.json", ".release-please-manifest.json",
               ".releaserc*", "release.config.*", "cliff.toml", ".goreleaser.y*ml", ".github/release.yml",
               ".versionrc*", "towncrier.toml", "changelog.d/**"),
        _config(r"semantic-release|release-please|changesets|standard-version|git-cliff|generate_release_notes|generate-notes|release-drafter|towncrier|goreleaser"),
        fail="no changelog or release-notes generation",
    )(s)  # fmt: skip


def _infra_check(pattern: str, fail: str) -> Callable[[Snapshot], Verdict]:
    def check(s: Snapshot) -> Verdict:
        hits = _mentions(s, pattern) or _doc_mentions(s, pattern)
        if hits:
            return Pass(hits[:5])
        return Fail(fail)

    return only_if(_is_infra, "no deployment or infrastructure config", check)


def c_monorepo_tooling(s: Snapshot) -> Verdict:
    if not _multi_package(s):
        return Skip("single package or module", "not_applicable")
    return any_of(
        _paths("pnpm-workspace.yaml", "turbo.json", "nx.json", "lerna.json", "go.work", "moon.yml",
               ".moon/workspace.yml", "WORKSPACE", "WORKSPACE.bazel", "MODULE.bazel", "pants.toml",
               "rush.json", "settings.gradle", "settings.gradle.kts", "BUCK", ".buckconfig"),
        _config(r'"workspaces"\s*:|^\[workspace\]|^\[tool\.uv\.workspace\]|<modules>'),
        fail="several packages but no workspace or monorepo tool defining their boundaries",
    )(s)  # fmt: skip


def c_test_coverage_thresholds(s: Snapshot) -> Verdict:
    return any_of(
        _config(r"thresholds?\s*[:=]|coverageThreshold|--cov-fail-under|fail_under|fail-under|--check-coverage|check-coverage|jacocoTestCoverageVerification|jacoco:check|violationRules|koverVerify|minimum_coverage|coverage.*(target|threshold)|--fail-under"),
        fail="coverage may be measured but no minimum is enforced",
    )(s)  # fmt: skip


def c_api_schema_docs(s: Snapshot) -> Verdict:
    if not (_dep_hits(s, WEB_LIBS) or s.match("**/*.graphql", "**/*.gql", "**/*.proto")):
        return Skip("no HTTP or RPC server framework found", "not_applicable")
    return any_of(
        _paths("**/openapi.json", "**/openapi.y*ml", "**/swagger.json", "**/swagger.y*ml",
               "**/*.openapi.json", "**/*.openapi.y*ml", "**/schema.graphql", "**/*.graphql",
               "**/*.gql", "**/*.proto", "**/asyncapi.y*ml"),
        _deps("@nestjs/swagger", "fastapi", "drf-spectacular", "springdoc-openapi-starter-webmvc-ui",
              "@hono/zod-openapi", "@fastify/swagger", "utoipa", "swaggo"),
        fail="server framework present but no API schema",
    )(s)  # fmt: skip


def c_service_flow_documented(s: Snapshot) -> Verdict:
    return _first(
        lambda: _paths("**/*.mermaid", "**/*.mmd", "**/*.puml", "**/*.plantuml", "**/*.d2",
                       "**/*.drawio", "**/*.excalidraw", "ARCHITECTURE.md", "docs/architecture*",
                       "docs/diagrams/**", "**/*architecture*.png", "**/*architecture*.svg",
                       "**/workspace.dsl")(s),
        lambda: _docs(r"```mermaid|```plantuml|```d2")(s),
        lambda: NeedsJudgement(
            "Do the docs describe the services, APIs or databases this code calls, and how a request flows through them?",
            s.match(*ROOT_DOCS, "docs/*.md")[:5],
        ) if s.match(*ROOT_DOCS, "docs/*.md") else None,
        otherwise=Fail("no architecture diagram or service documentation"),
    )  # fmt: skip


def c_env_template(s: Snapshot) -> Verdict:
    templates = s.match("**/.env.example", "**/.env.sample", "**/.env.template", "**/.env.dist",
                        "**/.envrc.example", "**/example.env", "**/env.example")  # fmt: skip
    if templates:
        return Pass(templates[:5])
    documented = _doc_mentions(s, r"environment variables?|env vars?|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+=")
    return NeedsJudgement(
        "Are the environment variables the app needs documented? Skip as not_applicable if it reads none.",
        documented[:5] or s.match(*ROOT_DOCS)[:5],
    )


def c_local_services_setup(s: Snapshot) -> Verdict:
    compose = s.match("**/docker-compose*.y*ml", "**/compose.y*ml", "**/compose.*.y*ml",
                      "devbox.json", "process-compose.y*ml", "Tiltfile", "skaffold.yaml")  # fmt: skip
    if compose:
        return Pass(compose[:5])
    if not _dep_hits(s, SERVICE_LIBS):
        return Skip("no database, cache or queue client found", "not_applicable")
    return NeedsJudgement(
        "The code uses external services; do the docs say how to run them locally?",
        s.match(*ROOT_DOCS)[:5],
    )


def c_database_schema(s: Snapshot) -> Verdict:
    schema = s.match("**/schema.prisma", "**/migrations/**", "**/*.sql", "**/drizzle.config.*",
                     "**/alembic.ini", "**/schema.rb", "**/models.py", "**/entities/**",
                     "**/*.entity.ts", "**/schema.ts", "**/db/schema.*", "**/priv/repo/migrations/**",
                     "**/diesel.toml", "**/liquibase/**", "**/flyway/**")  # fmt: skip
    if schema:
        return Pass(schema[:5])
    if not _dep_hits(s, DB_LIBS):
        return Skip("no database client or ORM found", "not_applicable")
    return Fail("database library in use but no schema, models or migrations tracked")


def c_devcontainer_runnable(s: Snapshot) -> Verdict:
    configs = s.match(".devcontainer/devcontainer.json", ".devcontainer/*/devcontainer.json",
                      ".devcontainer.json", "flake.nix", "devbox.json")  # fmt: skip
    if not configs:
        return Skip("no declared dev environment to build", "not_applicable")
    return NeedsJudgement(
        "With the user's approval, build and enter the declared environment (e.g. `devcontainer up`, `nix develop -c true`, `devbox run true`). Skip as environment if the tool is not installed.",
        configs,
    )


def c_error_tracking_contextualized(s: Snapshot) -> Verdict:
    return any_of(
        _deps("@sentry/node", "@sentry/browser", "@sentry/react", "@sentry/nextjs", "@sentry/bun",
              "sentry-sdk", "sentry", "github.com/getsentry/sentry-go", "@bugsnag/js", "bugsnag",
              "rollbar", "@honeybadger-io/js", "honeybadger", "raygun", "@datadog/browser-rum",
              "airbrake"),
        _paths("sentry.properties", ".sentryclirc", "**/sentry.*.config.*"),
        fail="no error tracking SDK",
    )(s)  # fmt: skip


def c_alerting_configured(s: Snapshot) -> Verdict:
    return any_of(
        _paths("**/alerts.y*ml", "**/alertmanager.y*ml", "**/*rules.y*ml", "**/monitors/**", "**/*.alerts.*"),
        _config(r"pagerduty|opsgenie|alertmanager|incident\.io|grafana.*alert|datadog_monitor|aws_cloudwatch_metric_alarm|betteruptime|uptime-kuma|rootly"),
        fail="no alert rules or paging integration",
    )(s)  # fmt: skip


def c_runbooks_documented(s: Snapshot) -> Verdict:
    return any_of(
        _paths("**/runbooks/**", "**/runbook*", "**/playbooks/**", "**/RUNBOOK*", "docs/ops/**", "docs/oncall/**"),
        _docs(r"runbook|playbook|on-?call|incident response"),
        fail="no runbooks and no pointer to them",
    )(s)  # fmt: skip


def c_deployment_observability(s: Snapshot) -> Verdict:
    return any_of(
        _docs(r"\b(grafana|datadog|new ?relic|honeycomb|kibana|cloudwatch|axiom)\b|\bdashboards?\b.{0,40}\bdeploy|\bdeploy.{0,40}\bdashboards?\b"),
        _config(r"slack.*webhook|SLACK_WEBHOOK|deployment[-_ ]annotation|datadog.*deploy|sentry-cli releases|getsentry/action-release|honeycomb.*marker"),
        fail="no pointer to where deploy impact is visible",
    )(s)  # fmt: skip


def c_dependency_update_automation(s: Snapshot) -> Verdict:
    return any_of(
        _paths(".github/dependabot.y*ml", "renovate.json", "renovate.json5", ".renovaterc*",
               ".github/renovate.json*", ".gitlab/renovate.json*", ".depfu.yml", ".pyup.yml"),
        lambda s: (lambda h: Pass(h) if h else None)(s.grep(("package.json",), r'"renovate"\s*:')),
        fail="no Dependabot, Renovate or similar update bot",
    )(s)  # fmt: skip


IGNORE_NEEDS = {
    "package.json": ("node_modules",),
    "pyproject.toml": ("__pycache__", ".venv|venv|*.pyc"),
    "Cargo.toml": ("target",),
    "pom.xml": ("target",),
    "build.gradle": ("build", ".gradle"),
    "build.gradle.kts": ("build", ".gradle"),
    "go.mod": (),
    "composer.json": ("vendor",),
    "Gemfile": (),
    "flake.nix": ("result",),
}


def c_gitignore_comprehensive(s: Snapshot) -> Verdict:
    if ".gitignore" not in s.paths:
        return Fail("no root .gitignore")
    lines = {ln.strip().strip("/").lstrip("/") for ln in s.texts.get(".gitignore", "").splitlines()}
    lines.discard("")

    def covered(name: str) -> bool:
        return any(
            any(fnmatch(alt, ln) or fnmatch(alt, ln.rstrip("/*")) for ln in lines)
            for alt in name.split("|")
        )

    missing = []
    if not covered(".env") and not covered(".env.local"):
        missing.append(".env")
    for manifest, needs in IGNORE_NEEDS.items():
        if s.match(manifest, "*/" + manifest):
            missing.extend(n for n in needs if not covered(n))
    tracked = s.match("**/node_modules/**", "**/__pycache__/**", "**/.env", "**/.DS_Store")
    if tracked:
        return Fail("generated or secret files are tracked: " + ", ".join(tracked[:3]))
    if missing:
        return Fail(".gitignore misses: " + ", ".join(dict.fromkeys(missing)))
    return Pass((".gitignore",))


def c_issue_templates(s: Snapshot) -> Verdict:
    return any_of(
        _paths(".github/ISSUE_TEMPLATE/*", ".github/ISSUE_TEMPLATE.md", ".gitlab/issue_templates/*",
               "ISSUE_TEMPLATE.md", "docs/ISSUE_TEMPLATE.md"),
        fail="no issue templates",
    )(s)  # fmt: skip


def c_issue_labeling_system(s: Snapshot) -> Verdict:
    return or_skip_env(
        any_of(
            _paths(".github/labels.y*ml", ".github/labels.json", ".github/labeler.y*ml",
                   ".github/issue-labeler.y*ml", ".gitlab/labels.y*ml"),
            fail="",
        ),
        "labels live on the forge; no label definitions in files",
    )(s)  # fmt: skip


def c_backlog_health(s: Snapshot) -> Verdict:
    return Skip("open-issue quality needs forge access", "environment")


def c_pr_templates(s: Snapshot) -> Verdict:
    return any_of(
        _paths(".github/pull_request_template.md", ".github/PULL_REQUEST_TEMPLATE.md",
               ".github/PULL_REQUEST_TEMPLATE/*", "pull_request_template.md",
               "docs/pull_request_template.md", ".gitlab/merge_request_templates/*"),
        fail="no pull or merge request template",
    )(s)  # fmt: skip


def c_product_analytics_instrumentation(s: Snapshot) -> Verdict:
    return any_of(
        _deps("mixpanel", "mixpanel-browser", "@amplitude/analytics-browser", "@amplitude/analytics-node",
              "amplitude", "posthog-js", "posthog-node", "posthog", "@segment/analytics-next",
              "analytics-node", "heap-api", "@vercel/analytics", "react-ga4", "plausible-tracker",
              "@plausible-analytics/tracker", "rudder-sdk-js", "@rudderstack/analytics-js"),
        _config(r"gtag\(|googletagmanager|plausible\.io/js|umami"),
        fail="no product analytics instrumentation",
    )(s)  # fmt: skip


def c_error_to_insight_pipeline(s: Snapshot) -> Verdict:
    return any_of(
        _config(r"SENTRY_ORG|SENTRY_PROJECT|getsentry/action-release|sentry-cli|create-issue-from|pagerduty.*(issue|jira|github)|opsgenie.*(jira|github)"),
        _docs(r"sentry.*(github|gitlab|jira|linear) integration"),
        fail="error tracking is not linked to issue creation",
    )(s)  # fmt: skip


def c_dast_scanning(s: Snapshot) -> Verdict:
    return only_if(
        _uses(WEB_LIBS), "not deployed as a web service",
        any_of(_config(r"zaproxy|zap-(baseline|full-scan|api-scan)|owasp.?zap|burp|nuclei|stackhawk|hawkscan|acunetix|invicti|netsparker|dastardly"),
               fail="web service without a DAST scan in CI"),
    )(s)  # fmt: skip


def c_pii_handling(s: Snapshot) -> Verdict:
    return any_of(
        _deps("presidio-analyzer", "presidio-anonymizer", "scrubadub", "@faker-js/faker", "faker", "Faker",
              "google-cloud-dlp", "@aws-sdk/client-macie2"),
        _docs(r"\bPII\b|personal data|personally identifiable|data handling|data classification"),
        lambda s: NeedsJudgement(
            "Does this code process personal or user data? Fail if yes and nothing addresses PII; skip as not_applicable if not.",
            s.match(*ROOT_DOCS)[:5],
        ),
    )(s)  # fmt: skip


def c_privacy_compliance(s: Snapshot) -> Verdict:
    return any_of(
        _deps("@onetrust/cookie-consent", "cookieconsent", "vanilla-cookieconsent", "react-cookie-consent",
              "klaro", "@cookiebot/react"),
        _docs(r"\bGDPR\b|\bCCPA\b|data retention|right to (erasure|be forgotten)|privacy policy|data subject"),
        _paths("**/PRIVACY*", "**/privacy*.md", "docs/privacy/**"),
        lambda s: NeedsJudgement(
            "Does this system collect end-user data? Fail if yes with no consent, retention or deletion handling; skip as not_applicable if not.",
            s.match(*ROOT_DOCS)[:5],
        ),
    )(s)  # fmt: skip


def c_secrets_management(s: Snapshot) -> Verdict:
    leaked = [p for p in s.match("**/.env", "**/.env.local", "**/.env.production", "**/*.pem",
                                 "**/id_rsa", "**/credentials.json", "**/.npmrc")
              if p.endswith((".env", ".local", ".production", ".pem", "id_rsa", "credentials.json"))
              or re.search(r"_authToken=(?!\$\{)", s.texts.get(p, ""))]  # fmt: skip
    if leaked:
        return Fail("possible secrets tracked in git: " + ", ".join(leaked[:3]))
    return any_of(
        _paths(".sops.yaml", "**/*.enc.*", "**/*.sops.*", "**/*.age", ".env.example", ".env.sample",
               ".env.template", "**/sealed-secrets/**", ".envrc.example"),
        _config(r"\$\{\{\s*secrets\.|vault|secretsmanager|secret-manager|keyvault|doppler|infisical|1password|op run|sops|agenix|sealedsecret"),
        lambda s: NeedsJudgement(
            "No secrets pattern found. Does the code need secrets? Skip as not_applicable if it needs none; fail if it does and they have no managed home.",
            s.match(*ROOT_DOCS)[:5],
        ),
    )(s)  # fmt: skip


def c_log_scrubbing(s: Snapshot) -> Verdict:
    utilities = s.match("**/*redact*", "**/*sanitiz*", "**/*scrub*")
    if utilities:
        return Pass(utilities[:5])
    documented = _doc_mentions(
        s, r"\b(redact\w*|scrub\w*)\b.{0,40}\blogs?\b|\b(never|do not|don't) log\b"
    )
    if documented:
        return Pass(documented[:5])
    loggers = s.match("**/logger.*", "**/logging.*", "**/log.ts", "**/log.py")
    if loggers or _dep_hits(
        s, ("pino", "winston", "structlog", "loguru", "logback-classic", "log4j-core", "serilog")
    ):
        return NeedsJudgement(
            "Does the logger configuration redact sensitive fields (pino redact, structlog processors, masking layouts)?",
            loggers[:5] or s.match(*MANIFESTS)[:3],
        )
    return Fail("no redaction or log scrubbing mechanism")


def c_health_checks(s: Snapshot) -> Verdict:
    deployed = _uses(WEB_LIBS)(s) or bool(s.match("**/Dockerfile*", "k8s/**", "**/Chart.yaml"))
    if not deployed:
        return Skip("not a deployed service", "not_applicable")
    return any_of(
        _config(r"HEALTHCHECK|livenessProbe|readinessProbe|/healthz?\b|/ready\b|/live\b|health_check|healthcheck"),
        _deps("@godaddy/terminus", "lightship", "django-health-check", "spring-boot-starter-actuator", "fastify-healthcheck"),
        lambda s: NeedsJudgement(
            "Does the service expose a health, liveness or readiness endpoint in code?",
            s.match("**/Dockerfile*", "**/*route*", "**/*server*", "**/*app.*")[:5],
        ),
    )(s)  # fmt: skip


def c_dead_feature_flag_detection(s: Snapshot) -> Verdict:
    if not isinstance(c_feature_flag_infrastructure(s), Pass):
        return Skip("no feature flags to go stale", "not_applicable")
    return any_of(
        _config(r"ld-find-code-refs|find-code-refs|stale.?flag|flag.?(cleanup|age|audit)|piranha"),
        _docs(r"(stale|dead|remove|clean ?up).{0,20}flags?|flag lifecycle"),
        fail="feature flags in use with no stale-flag detection or cleanup process",
    )(s)  # fmt: skip


def c_circuit_breakers(s: Snapshot) -> Verdict:
    return only_if(
        _uses(SERVICE_LIBS + WEB_LIBS + ("axios", "got", "node-fetch", "undici", "requests", "httpx", "aiohttp")),
        "no external service calls found",
        any_of(
            _deps("opossum", "cockatiel", "p-retry", "async-retry", "resilience4j-spring-boot3",
                  "resilience4j-circuitbreaker", "polly", "tenacity", "backoff", "pybreaker",
                  "github.com/sony/gobreaker", "github.com/cenkalti/backoff", "failsafe", "retry", "axios-retry"),
            _config(r"circuitBreaker|circuit_breaker|outlierDetection"),
            fail="external calls without a circuit breaker or retry-with-backoff library",
        ),
    )(s)  # fmt: skip


def c_profiling_instrumentation(s: Snapshot) -> Verdict:
    return any_of(
        _deps("dd-trace", "ddtrace", "newrelic", "@pyroscope/nodejs", "pyroscope-io", "@google-cloud/profiler",
              "google-cloud-profiler", "clinic", "0x", "py-spy", "scalene", "pprof",
              "github.com/grafana/pyroscope-go", "async-profiler", "@datadog/pprof", "memray", "pyinstrument"),
        _config(r"--prof\b|--cpu-prof|flamegraph|JFR|FlightRecorder|net/http/pprof|cargo flamegraph|samply"),
        lambda s: NeedsJudgement(
            "Is profiling meaningful here (a long-running or performance-sensitive program)? Fail if yes and there is no profiling setup; skip as not_applicable if not.",
            s.match(*ROOT_DOCS)[:5],
        ),
    )(s)  # fmt: skip


def c_large_file_detection(s: Snapshot) -> Verdict:
    return any_of(
        _config(r"\b(check-added-large-files|large[-_]files?|max-lines|max-module-lines|too-many-lines|max[-_]file[-_](size|lines)|git-sizer)\b"),
        lambda s: (lambda h: Pass(h) if h else None)(s.grep((".gitattributes",), r"filter=lfs")),
        fail="nothing flags oversized files",
    )(s)  # fmt: skip


def c_heavy_dependency_detection(s: Snapshot) -> Verdict:
    return only_if(
        _uses(BUNDLERS), "no bundled output",
        any_of(
            _deps("webpack-bundle-analyzer", "@next/bundle-analyzer", "rollup-plugin-visualizer",
                  "vite-bundle-visualizer", "size-limit", "@size-limit/preset-app", "bundlesize",
                  "bundlewatch", "@lhci/cli", "source-map-explorer", "vite-bundle-analyzer"),
            _paths(".size-limit*", "lighthouserc*", ".lighthouserc*"),
            fail="bundled app with no bundle size analysis or budget",
        ),
    )(s)  # fmt: skip


def c_unused_dependencies_detection(s: Snapshot) -> Verdict:
    return any_of(
        _config(r"\b(knip|depcheck|npm-check|deptry|pip-extra-reqs|cargo[- ]udeps|cargo[- ]machete|cargo[- ]shear|go mod tidy|dependency:analyze|dependency-analysis|unimported|fawltydeps)\b"),
        _paths("**/knip.json", "**/knip.jsonc", "**/knip.config.*", "**/.knip.json*", "**/.depcheckrc*"),
        fail="nothing flags unused dependencies",
    )(s)  # fmt: skip


def c_tech_debt_tracking(s: Snapshot) -> Verdict:
    return any_of(
        _config(r"\b(no-warning-comments|todo-to-issue|leasot|todocheck|godox|no-todo|sonar\w*)\b|select\s*=\s*\[[^\]]*[\"'](TD|FIX)\d*[\"']|\bfixme\b\s*[\]:\"']"),
        fail="TODO/FIXME markers are not tracked or linked to issues",
    )(s)  # fmt: skip


def c_dead_code_detection(s: Snapshot) -> Verdict:
    return any_of(
        _config(r"\b(knip|ts-prune|unimported|no-unused-modules|noUnusedLocals|vulture|deadcode|staticcheck|cargo[- ]udeps|deadnix|unused-code|UnusedPrivate|sonar|dead_code|unused-exports)\b"),
        _paths("**/knip.json", "**/knip.jsonc", "**/knip.config.*", "**/.knip.json*", "**/.vulture*"),
        fail="no dead code detector",
    )(s)  # fmt: skip


def c_version_drift_detection(s: Snapshot) -> Verdict:
    return only_if(
        _multi_package, "single build package or module",
        any_of(
            _paths(".syncpackrc*", "syncpack.config.*", ".manypkg*"),
            _config(r"syncpack|manypkg|sherif|enforce-module-boundaries|groupName|versionCatalog|dependencyConvergence|catalog:"),
            fail="several packages with no check that shared dependency versions agree",
        ),
    )(s)  # fmt: skip


def c_code_modularization(s: Snapshot) -> Verdict:
    sources = s.match(
        "**/*.ts",
        "**/*.tsx",
        "**/*.js",
        "**/*.py",
        "**/*.go",
        "**/*.java",
        "**/*.kt",
        "**/*.cs",
        "**/*.rb",
    )
    if s.match("**/Cargo.toml") and not sources:
        return Skip("Rust visibility is compiler-enforced", "not_applicable")
    if len(sources) < 50:
        return Skip("under 50 source files; module boundaries add little", "not_applicable")
    return any_of(
        _config(r"\b(dependency-cruiser|eslint-plugin-boundaries|no-restricted-paths|enforce-module-boundaries|import-linter|importlinter|archunit|ArchUnitNET|tach|pytestarch|go-arch-lint|konsist|packwerk)\b"),
        _paths("**/.dependency-cruiser.*", "**/.importlinter", "**/tach.toml", "**/internal/**"),
        fail="no enforced module boundaries",
    )(s)  # fmt: skip


def c_duplicate_code_detection(s: Snapshot) -> Verdict:
    return any_of(
        _config(r"\b(jscpd|cpd|duplicate-code|R0801|sonar\w*|dupl|simian|symilar)\b"),
        _paths("**/.jscpd.json"),
        fail="no duplicate code detector",
    )(s)  # fmt: skip


def c_n_plus_one_detection(s: Snapshot) -> Verdict:
    return only_if(
        _uses(DB_LIBS), "no database or ORM",
        any_of(
            _deps("bullet", "nplusone", "django-zen-queries", "dataloader", "graphql-batch", "prosopite",
                  "jdbc-n-plus-one", "hypersistence-utils-hibernate-63", "sqlalchemy-nplusone"),
            _config(r"raiseload|n\+1|nplusone|assertNumQueries|query[-_]count"),
            fail="database in use with no N+1 query detection",
        ),
    )(s)  # fmt: skip


def c_test_naming_conventions(s: Snapshot) -> Verdict:
    return any_of(
        _config(r"testMatch|testRegex|python_files|python_functions|testpaths|\binclude\s*:\s*\[.*(test|spec)|--test-name-pattern|spec\s*:|\"spec\"|testSourceDirs|<testSourceDirectory>"),
        _paths("**/*_test.go"),
        _docs(r"test (file )?naming|name tests?|tests? (are|go) (in|named)|\*\.test\.|test_\*\.py"),
        fail="test file naming is neither configured nor documented",
    )(s)  # fmt: skip


def c_test_isolation(s: Snapshot) -> Verdict:
    serial = _mentions(
        s,
        r"--runInBand|-i\b.*jest|--no-file-parallelism|--threads=false|singleThread|poolOptions.*singleFork",
    )
    if serial:
        return Fail("tests forced serial: " + ", ".join(serial[:3]))
    return any_of(
        _deps("pytest-xdist", "pytest-randomly", "pytest-random-order", "testcontainers", "vitest", "jest",
              "@testcontainers/postgresql", "ava"),
        _config(r"node --test|--test-concurrency|--shuffle|--randomize|t\.Parallel|junit\.jupiter\.execution\.parallel|forkCount|maxParallelForks|--parallel|--sequence\.shuffle"),
        _paths("**/*_test.go", "**/tests/*.rs"),
        fail="no parallel, randomised or isolated test execution",
    )(s)  # fmt: skip


def c_interactive_qa_exists(s: Snapshot) -> Verdict:
    return NeedsJudgement(
        "Is there a documented path an agent can follow end to end: install and start dependencies, get past any login, launch the app, and drive one real interaction?",
        (*s.match(*ROOT_DOCS, *SKILL_DIRS)[:4], *s.match("**/playwright.config.*", "**/docker-compose*.y*ml", *TASK_FILES)[:2]),
    )  # fmt: skip


def c_interactive_qa_runnable(s: Snapshot) -> Verdict:
    return NeedsJudgement(
        "With the user's approval, follow the documented QA path and drive one interaction. If running it is not possible here, judge whether the path is complete enough to follow.",
        s.match(*ROOT_DOCS, *SKILL_DIRS)[:5],
    )


def c_agents_md_validation(s: Snapshot) -> Verdict:
    if not isinstance(c_agents_md(s), Pass):
        return Fail("needs an agent instructions file first")
    hits = s.grep(
        (*CI, *GIT_HOOKS, *TASK_FILES, "package.json"),
        r"(AGENTS|CLAUDE)\.md|\b(lychee|markdown-link-check|linkcheck|doctest|mdsh|cram|txtar|runme)\b",
    )
    return (
        Pass(hits[:5])
        if hits
        else Fail("nothing checks that the agent instructions still match the code")
    )


def c_release_automation(s: Snapshot) -> Verdict:
    return any_of(
        _config(r"semantic-release|release-please|changesets/action|goreleaser|docker/build-push-action|npm publish|pnpm publish|cargo publish|twine upload|uv publish|gh release create|wrangler deploy|vercel deploy|fly deploy|argocd|fluxcd|kubectl apply|helm upgrade|terraform apply|^on:\s*\n\s*(push|release):[\s\S]{0,200}tags"),
        _paths("**/argocd/**", "**/flux-system/**", ".goreleaser.y*ml", ".releaserc*", "release.config.*"),
        fail="releases and deploys are manual",
    )(s)  # fmt: skip


AGE_GATE = (
    r"minimumReleaseAge|minimum-release-age|min-release-age|stabilityDays|exclude-newer"
    r"|npmMinimalAgeGate|uploaded-prior-to|cooldown\s*:|minimum_release_age|install_before"
)


def c_min_release_age(s: Snapshot) -> Verdict:
    hits = _mentions(s, AGE_GATE, include_toolchain=True)
    if hits:
        return Pass(hits[:5])
    policy = _doc_mentions(
        s, r"(wait|at least|minimum of)\s+\d+\s+days?.{0,60}(release|version|update|bump)"
    )
    return (
        Pass(policy[:5])
        if policy
        else Fail("new dependency releases are adopted with no waiting period")
    )


TOOLCHAIN_FILES = (
    ".tool-versions", "mise.toml", ".mise.toml", "mise/config.toml", ".mise/config.toml",
    ".config/mise.toml", ".config/mise/config.toml", "flake.nix", "shell.nix", "devbox.json",
    ".nvmrc", ".node-version", ".python-version", ".ruby-version", ".java-version", ".sdkmanrc",
    ".go-version", ".terraform-version", "rust-toolchain", "rust-toolchain.toml",
    "gradle/wrapper/gradle-wrapper.properties", ".mvn/wrapper/maven-wrapper.properties",
    ".bun-version", ".deno-version", ".devcontainer/devcontainer.json", "global.json",
)  # fmt: skip


def c_toolchain_pinned(s: Snapshot) -> Verdict:
    return any_of(
        _paths(*TOOLCHAIN_FILES),
        lambda s: (lambda h: Pass(h) if h else None)(
            s.grep(("**/package.json",), r'"(volta|packageManager)"\s*:')
            + s.grep(("**/go.mod",), r"^(go \d+\.\d+|toolchain go)")
            + s.grep(("**/pyproject.toml",), r"requires-python\s*=\s*\"==")
        ),
        fail="runtime and tool versions are not declared in the repo; each machine uses whatever is installed",
    )(s)  # fmt: skip


# --- registry: the single source of truth for criteria -------------------------

C = Criterion
REGISTRY: tuple[Criterion, ...] = (
    # Level 1
    C("lint_config", "Linter Configuration", "style", 1, "application", "probe", False,
      "A linter or static analyser is configured, so an agent learns about code-quality mistakes from a command rather than a reviewer.",
      ("ESLint", "oxlint", "Biome", "ruff", "golangci-lint", "clippy", "Checkstyle", "SonarQube"), c_lint_config),
    C("type_check", "Type Checker", "style", 1, "application", "probe", False,
      "Types are checked statically: a type checker is configured, or the language's normal build compiles with types.",
      ("tsconfig.json", "mypy", "pyright", "pyrefly", "javac via Maven/Gradle", "go build", "cargo check"), c_type_check),
    C("formatter", "Code Formatter", "style", 1, "application", "probe", False,
      "Formatting is automated, so style never needs a human decision and diffs stay about behaviour.",
      ("Prettier", "oxfmt", "Biome", "ruff format", "Black", "gofmt", "rustfmt", "Spotless"), c_formatter),
    C("unit_tests_exist", "Unit Tests Exist", "testing", 1, "application", "probe", False,
      "The code has unit tests an agent can extend next to the code it changes.",
      ("*.test.ts", "__tests__/", "tests/test_*.py", "*_test.go", "src/test/java", "*.bats"), c_unit_tests_exist),
    C("readme", "README File", "docs", 1, "repository", "probe", False,
      "A root README says what the project is and how to set it up and use it.",
      ("README.md",), c_readme),
    C("env_template", "Environment Template", "dev_env", 1, "repository", "judge", True,
      "Every environment variable the app needs is listed with a safe example value, so an agent can run it without guessing.",
      (".env.example", "an env var table in README or AGENTS.md"), c_env_template),
    C("gitignore_comprehensive", "Gitignore Comprehensive", "security", 1, "repository", "probe", False,
      "Git ignores local secrets and generated output for every stack in the repo, so a broad `git add` cannot commit them.",
      (".env", "node_modules/", "__pycache__/", "target/", "build/"), c_gitignore_comprehensive),
    # Level 2
    C("pre_commit_hooks", "Pre-commit Hooks", "style", 2, "application", "probe", False,
      "Quality checks run locally before code leaves the machine. Any mechanism counts; checks that only run in CI do not.",
      ("husky", "pre-commit", "lefthook", "hk", ".githooks/ scripts", "agent edit hooks that run lint or tests"), c_pre_commit_hooks),
    C("build_cmd_doc", "Build Command Documentation", "build", 2, "repository", "probe", False,
      "The docs give the command that builds or installs the project, or say plainly that there is no build step.",
      ("`pnpm build`", "`uv sync`", "`cargo build`", "`./gradlew build`", "`make`"), c_build_cmd_doc),
    C("deps_pinned", "Dependencies Pinned", "build", 2, "repository", "probe", True,
      "Every dependency manifest has a committed lockfile or exact pins, so two machines resolve the same versions.",
      ("pnpm-lock.yaml", "bun.lock", "uv.lock", "Cargo.lock", "go.sum", "Gradle locking", "Maven BOM with wrapper"), c_deps_pinned),
    C("vcs_cli_tools", "VCS CLI Tools", "build", 2, "repository", "env", True,
      "A forge CLI is installed and signed in where the agent runs. This describes the machine, not the repo.",
      ("gh auth status", "glab auth status"), c_vcs_cli_tools),
    C("unit_tests_runnable", "Unit Tests Runnable", "testing", 2, "application", "judge", True,
      "Tests load and run locally. Verified with the runner's list or collect mode on one file, never the whole suite, and only with approval.",
      ("vitest list", "jest --listTests", "pytest --collect-only <file>", "go test -list", "cargo test --no-run"), c_unit_tests_runnable, needs_approval=True),
    C("agents_md", "AGENTS.md File", "docs", 2, "repository", "probe", False,
      "A root agent instructions file gives setup, build, test and project conventions in more than a stub.",
      ("AGENTS.md", "CLAUDE.md", "GEMINI.md", ".github/copilot-instructions.md"), c_agents_md),
    C("devcontainer", "Dev Container", "dev_env", 2, "repository", "probe", False,
      "The development environment is declared in the repo, so an agent can get a working shell without a setup session.",
      (".devcontainer/devcontainer.json", "flake.nix devShell", "devbox.json", ".gitpod.yml"), c_devcontainer),
    C("structured_logging", "Structured Logging", "debugging", 2, "application", "probe", False,
      "Logs go through a logging library or one logger module, not scattered prints, so output can be filtered and parsed.",
      ("pino", "winston", "structlog", "loguru", "zap", "slog", "tracing", "logback"), c_structured_logging),
    C("codeowners", "CODEOWNERS File", "security", 2, "repository", "probe", False,
      "A CODEOWNERS file maps paths to reviewers, so agent changes reach the right person.",
      ("CODEOWNERS", ".github/CODEOWNERS"), c_codeowners),
    C("automated_pr_review", "Automated PR Review Generation", "build", 2, "repository", "env", True,
      "Automation writes review comments on pull requests, beyond pass/fail status checks.",
      ("claude-code-action", "CodeRabbit", "Danger", "reviewdog"), c_automated_pr_review),
    C("automated_security_review", "Automated Security Review Generation", "security", 2, "repository", "env", True,
      "Automation produces readable security findings for changes, such as SAST results or dependency audit reports.",
      ("CodeQL", "Semgrep", "Snyk", "osv-scanner", "zizmor", "Trivy"), c_automated_security_review),
    C("automated_doc_generation", "Automated Documentation Generation", "docs", 2, "repository", "probe", False,
      "Some docs are generated or published from source, so they cannot drift from it silently.",
      ("TypeDoc", "Sphinx", "MkDocs", "Javadoc", "OpenAPI generators", "git-cliff"), c_automated_doc_generation),
    C("monorepo_tooling", "Monorepo Tooling", "build", 2, "repository", "probe", True,
      "A repo with several packages declares them as a workspace, so boundaries and task order are explicit.",
      ("pnpm workspaces", "Turborepo", "Nx", "go.work", "Cargo workspace", "Gradle multi-project", "Bazel"), c_monorepo_tooling),
    C("test_coverage_thresholds", "Test Coverage Thresholds", "testing", 2, "application", "probe", False,
      "A minimum coverage level is enforced, so an agent knows a change that drops coverage will fail.",
      ("vitest thresholds", "jest coverageThreshold", "--cov-fail-under", "JaCoCo check", "Codecov target"), c_test_coverage_thresholds),
    C("local_services_setup", "Local Services Setup", "dev_env", 2, "repository", "probe", True,
      "Databases, caches and queues the code depends on can be started locally from checked-in config or clear docs.",
      ("docker-compose.yml", "compose.yaml", "devbox services", "Tilt"), c_local_services_setup),
    C("database_schema", "Database Schema", "dev_env", 2, "application", "probe", True,
      "The data model is readable from the repo as a schema, models or migrations.",
      ("schema.prisma", "migrations/", "SQLAlchemy models", "Drizzle schema", "schema.rb"), c_database_schema),
    C("error_tracking_contextualized", "Error Tracking Contextualized", "debugging", 2, "application", "probe", False,
      "Production errors reach an error tracker with stack traces and context that map back to code.",
      ("Sentry", "Bugsnag", "Rollbar", "Honeybadger"), c_error_tracking_contextualized),
    C("runbooks_documented", "Runbooks Documented", "debugging", 2, "repository", "probe", False,
      "Incident procedures exist, in the repo or linked from it.",
      ("runbooks/", "a link to a wiki runbook", "on-call docs"), c_runbooks_documented),
    C("branch_protection", "Branch Protection", "security", 2, "repository", "env", True,
      "The default branch rejects direct pushes and requires review. Readable only through the forge API with admin rights.",
      ("GitHub rulesets", "legacy branch protection", "GitLab protected branches"), c_branch_protection),
    C("dependency_update_automation", "Dependency Update Automation", "security", 2, "repository", "probe", False,
      "A bot proposes dependency updates, so versions do not rot unnoticed.",
      ("Dependabot", "Renovate"), c_dependency_update_automation),
    C("secrets_management", "Secrets Management", "security", 2, "repository", "probe", False,
      "Secrets live outside the code, in CI secrets, a secret manager or encrypted files, and none are tracked in git.",
      ("CI secrets", "SOPS", "Vault", "cloud secret managers", ".env.example with .env ignored"), c_secrets_management),
    C("issue_templates", "Issue Templates", "task_discovery", 2, "repository", "probe", False,
      "Issue templates tell a reporter, human or agent, what information a bug or feature request needs.",
      (".github/ISSUE_TEMPLATE/", ".gitlab/issue_templates/"), c_issue_templates),
    C("issue_labeling_system", "Issue Labeling System", "task_discovery", 2, "repository", "env", False,
      "Issues carry consistent labels for type, priority and area, so work can be filtered by query.",
      (".github/labels.yml", "labeler config", "labels on the forge"), c_issue_labeling_system),
    C("pr_templates", "PR Templates", "task_discovery", 2, "repository", "probe", False,
      "A pull request template asks for the change, how it was tested, and context for reviewers.",
      (".github/pull_request_template.md", ".gitlab/merge_request_templates/"), c_pr_templates),
    C("interactive_qa_exists", "Interactive QA Exists", "testing", 2, "application", "judge", False,
      "The docs give an agent a complete path to run the app and drive one real interaction: dependencies, login handling, launch and the interaction itself. Reading only; nothing is run.",
      ("AGENTS.md run section", "Playwright harness", "curl against a health endpoint", "a QA skill"), c_interactive_qa_exists),
    C("strict_typing", "Strict Typing", "style", 2, "application", "probe", True,
      "Where the type checker has a stricter mode, it is on.",
      ('tsconfig "strict": true', "mypy strict", "pyright strict", 'pyrefly preset = "strict"'), c_strict_typing),
    C("toolchain_pinned", "Toolchain Pinned", "dev_env", 2, "repository", "probe", False,
      "Runtime and tool versions are declared in the repo, so a fresh machine or sandbox gets the same compiler and runtime as the author.",
      ("mise.toml", ".tool-versions", "flake.nix", "devbox.json", ".nvmrc", ".python-version", "rust-toolchain.toml", "go.mod toolchain", "Gradle/Maven wrapper", "volta"),
      c_toolchain_pinned, origin="extension"),
    # Level 3
    C("integration_tests_exist", "Integration Tests Exist", "testing", 3, "application", "probe", False,
      "Tests exercise components together or end to end, not only units in isolation.",
      ("Playwright", "Cypress", "tests/integration/", "Testcontainers", "*IT.java", "bats CLI tests"), c_integration_tests_exist),
    C("distributed_tracing", "Distributed Tracing", "debugging", 3, "application", "probe", False,
      "A trace or request ID follows a request through the system, so one failure can be followed across services.",
      ("OpenTelemetry", "X-Request-ID", "Micrometer Tracing", "dd-trace"), c_distributed_tracing),
    C("metrics_collection", "Metrics Collection", "debugging", 3, "application", "probe", False,
      "The app emits runtime metrics, so the effect of a change on performance is measurable.",
      ("Prometheus client", "StatsD", "OpenTelemetry metrics", "Datadog", "Actuator"), c_metrics_collection),
    C("agentic_development", "Agentic Development", "build", 3, "repository", "probe", False,
      "Agents already take part in development: agent co-authored commits, agent config or skills in the repo, or CI that invokes an agent. Dependency bots do not count.",
      ("Co-authored-by: Claude", ".claude/", ".agents/", "claude-code-action", "codex exec in CI"), c_agentic_development),
    C("skills", "Skills Configuration", "docs", 3, "repository", "probe", False,
      "The repo ships at least one agent skill: a SKILL.md with name and description frontmatter and a real body.",
      (".agents/skills/<name>/SKILL.md", ".claude/skills/", ".codex/skills/"), c_skills),
    C("documentation_freshness", "Documentation Freshness", "docs", 3, "repository", "probe", False,
      "At least one key doc (README, AGENTS.md, CLAUDE.md, CONTRIBUTING.md) changed in the last 180 days.",
      ("git log dates",), c_documentation_freshness),
    C("naming_consistency", "Naming Consistency", "style", 3, "application", "probe", False,
      "Naming conventions are enforced by a lint rule or written down where agents read them.",
      ("@typescript-eslint/naming-convention", "ruff N rules", "pylint invalid-name", "a naming section in AGENTS.md"), c_naming_consistency),
    C("single_command_setup", "Single Command Setup", "build", 3, "repository", "judge", False,
      "One command, or a short documented sequence, takes a fresh clone to a running dev target.",
      ("`make dev`", "`pnpm install && pnpm dev`", "`mise run setup`", "`nix develop`", "`./gradlew bootRun`"), c_single_command_setup),
    C("release_notes_automation", "Release Notes Automation", "build", 3, "repository", "probe", False,
      "Release notes or a changelog are generated, on each release or on a schedule.",
      ("changesets", "release-please", "semantic-release", "git-cliff", "GitHub generated notes"), c_release_notes_automation),
    C("api_schema_docs", "API Schema Docs", "docs", 3, "application", "probe", True,
      "A service's API has a machine-readable schema.",
      ("openapi.yaml", "schema.graphql", "*.proto", "FastAPI generated OpenAPI"), c_api_schema_docs),
    C("service_flow_documented", "Service Architecture Documented", "docs", 3, "repository", "probe", False,
      "Architecture is written down: a diagram, or docs naming the services, APIs and databases the code talks to.",
      ("Mermaid", "PlantUML", "ARCHITECTURE.md", "C4 diagrams"), c_service_flow_documented),
    C("devcontainer_runnable", "Devcontainer Runnable", "dev_env", 3, "repository", "judge", True,
      "The declared dev environment actually builds and starts. Checked only with approval.",
      ("devcontainer up", "nix develop -c true", "devbox run true"), c_devcontainer_runnable, needs_approval=True),
    C("alerting_configured", "Alerting Configured", "debugging", 3, "application", "probe", False,
      "Alert rules or a paging integration notify people when the system misbehaves.",
      ("PagerDuty", "Opsgenie", "Alertmanager rules", "Grafana alerting"), c_alerting_configured),
    C("secret_scanning", "Secret Scanning", "security", 3, "repository", "env", True,
      "Commits are scanned for secrets, locally, in CI or by the forge.",
      ("gitleaks", "trufflehog", "detect-secrets", "forge-native secret scanning"), c_secret_scanning),
    C("dead_feature_flag_detection", "Dead Feature Flag Detection", "build", 3, "repository", "probe", True,
      "Stale feature flags are found and removed, by tooling or a written cleanup process.",
      ("ld-find-code-refs", "a flag audit script", "a documented flag lifecycle"), c_dead_feature_flag_detection),
    C("pii_handling", "PII Handling", "security", 3, "application", "judge", True,
      "Personal data is identified and handled deliberately: detection, masking, synthetic test data or written rules.",
      ("Presidio", "faker test data", "a data-handling section in AGENTS.md"), c_pii_handling),
    C("log_scrubbing", "Sensitive Data Log Scrubbing", "security", 3, "application", "probe", False,
      "Sensitive values are redacted before they reach logs.",
      ("pino redact", "structlog processors", "Logback masking", "a redact utility"), c_log_scrubbing),
    C("health_checks", "Health Checks", "debugging", 3, "application", "probe", True,
      "A deployed service exposes health, liveness or readiness checks.",
      ("/healthz", "Docker HEALTHCHECK", "Kubernetes probes", "Actuator health"), c_health_checks),
    C("large_file_detection", "Large File Detection", "style", 3, "repository", "probe", False,
      "Something flags oversized files before they land: a hook, a lint rule, a CI job or LFS.",
      ("check-added-large-files", "ESLint max-lines", "pylint max-module-lines", "Git LFS"), c_large_file_detection),
    C("unused_dependencies_detection", "Unused Dependencies Detection", "build", 3, "application", "probe", False,
      "A tool flags declared dependencies the code does not use.",
      ("knip", "depcheck", "deptry", "cargo-machete", "go mod tidy in CI"), c_unused_dependencies_detection),
    C("tech_debt_tracking", "Technical Debt Tracking", "style", 3, "repository", "probe", False,
      "TODO and FIXME markers are tracked, by a scanner or a rule that links each to an issue.",
      ("eslint no-warning-comments", "ruff TD/FIX rules", "todo-to-issue", "SonarQube"), c_tech_debt_tracking),
    C("dead_code_detection", "Dead Code Detection", "style", 3, "application", "probe", False,
      "A tool flags unused exports, modules or functions.",
      ("knip", "ts-prune", "vulture", "staticcheck", "deadnix", "noUnusedLocals"), c_dead_code_detection),
    C("version_drift_detection", "Version Drift Detection", "build", 3, "repository", "probe", True,
      "In a multi-package repo, something checks that packages agree on shared dependency versions.",
      ("syncpack", "manypkg", "sherif", "pnpm catalogs", "Gradle version catalog with enforcement"), c_version_drift_detection),
    C("duplicate_code_detection", "Duplicate Code Detection", "style", 3, "application", "probe", False,
      "A tool flags copy-pasted code.",
      ("jscpd", "PMD CPD", "pylint duplicate-code", "SonarQube"), c_duplicate_code_detection),
    C("test_naming_conventions", "Test File Naming Conventions", "testing", 3, "application", "probe", False,
      "Test file names follow a pattern the runner is configured with or the docs state.",
      ("vitest include", "jest testMatch", "pytest python_files", "*_test.go"), c_test_naming_conventions),
    C("interactive_qa_runnable", "Interactive QA Runnable", "testing", 3, "application", "judge", False,
      "An agent can actually follow the QA path and drive the running app. Checked only with approval; falls back to judging the path's completeness.",
      ("Playwright session", "a TUI driven in a PTY", "curl returning 2xx"), c_interactive_qa_runnable, needs_approval=True),
    C("release_automation", "Release Automation", "build", 3, "repository", "probe", False,
      "Releases or deploys happen from automation, not by hand.",
      ("deploy on merge", "semantic-release", "release-please", "GoReleaser", "Argo CD", "Flux"), c_release_automation),
    C("min_release_age", "Minimum Dependency Release Age", "security", 3, "repository", "probe", False,
      "New dependency releases wait a set number of days before adoption. Centralised updates or provenance checks alone do not count.",
      ("pnpm minimumReleaseAge", "npm min-release-age", "uv exclude-newer", "Renovate minimumReleaseAge", "Dependabot cooldown", "bunfig minimumReleaseAge", "Yarn npmMinimalAgeGate"), c_min_release_age),
    C("product_analytics_instrumentation", "Product Analytics Instrumentation", "product", 3, "application", "probe", False,
      "Product usage is instrumented, so the effect of a change on users is measurable.",
      ("PostHog", "Amplitude", "Mixpanel", "Segment", "GA4"), c_product_analytics_instrumentation),
    # Level 4
    C("test_performance_tracking", "Test Performance Tracking", "testing", 4, "application", "probe", False,
      "Test durations are recorded and kept, not just pass or fail.",
      ("pytest --durations", "JUnit reports uploaded", "test analytics platform"), c_test_performance_tracking),
    C("flaky_test_detection", "Flaky Test Detection", "testing", 4, "application", "env", True,
      "Flaky tests are caught and managed through retries with tracking, quarantine or stability metrics.",
      ("pytest-rerunfailures", "Playwright retries", "Gradle test-retry", "BuildPulse"), c_flaky_test_detection),
    C("code_quality_metrics", "Code Quality Metrics Dashboard", "debugging", 4, "application", "env", True,
      "Coverage, complexity or maintainability are measured over time.",
      ("Codecov", "Coveralls", "SonarQube", "JaCoCo reports"), c_code_quality_metrics),
    C("fast_ci_feedback", "Fast CI Feedback", "build", 4, "repository", "env", True,
      "Typical pull request CI finishes in under ten minutes. Needs run history from the forge.",
      ("gh pr checks timing",), c_fast_ci_feedback),
    C("build_performance_tracking", "Build Performance Tracking", "build", 4, "repository", "env", True,
      "Build time is watched and worked on: caching, build scans or exported timings.",
      ("Turborepo cache", "Nx cache", "Gradle build cache", "actions/cache", "Develocity"), c_build_performance_tracking),
    C("deployment_frequency", "Deployment Frequency", "build", 4, "repository", "env", True,
      "The system ships several times a week through automation. Needs release or run history from the forge.",
      ("gh release list", "deploy workflow runs"), c_deployment_frequency),
    C("feature_flag_infrastructure", "Feature Flag Infrastructure", "build", 4, "repository", "probe", False,
      "Changes can ship behind a runtime toggle.",
      ("LaunchDarkly", "Statsig", "Unleash", "GrowthBook", "OpenFeature", "a flags module"), c_feature_flag_infrastructure),
    C("progressive_rollout", "Progressive Rollout", "build", 4, "repository", "probe", True,
      "Deploys reach a slice of traffic first (canary, percentage or rings).",
      ("Argo Rollouts", "Flagger", "canary deploys", "traffic splitting"),
      _infra_check(r"\b(canary|argo-?rollouts|flagger|progressive (rollout|delivery)|traffic[-_ ]split|percentage rollout|blue[-/ ]green|ring deploy)\b", "deploys go to all traffic at once")),
    C("rollback_automation", "Rollback Automation", "build", 4, "repository", "probe", True,
      "A bad deploy can be reverted with one documented action or automatically.",
      ("rollback workflow", "helm rollback", "argo rollback", "documented one-step revert"),
      _infra_check(r"\b(rollback|roll back|revert (a |the )?deploy\w*|rollout undo)\b", "no documented or automated rollback")),
    C("heavy_dependency_detection", "Heavy Dependency Detection", "build", 4, "application", "probe", True,
      "A bundled app measures bundle size or enforces a budget.",
      ("size-limit", "bundlewatch", "webpack-bundle-analyzer", "Lighthouse CI"), c_heavy_dependency_detection),
    C("deployment_observability", "Deployment Observability", "debugging", 4, "application", "probe", False,
      "The docs point to where a deploy's impact shows up, or deploys announce themselves to monitoring.",
      ("Grafana or Datadog dashboard links", "deploy markers", "Slack deploy notifications"), c_deployment_observability),
    C("backlog_health", "Backlog Health", "task_discovery", 4, "repository", "env", True,
      "Open issues have descriptive titles, labels and recent activity. Needs forge access.",
      ("gh issue list",), c_backlog_health),
    C("privacy_compliance", "Privacy Compliance", "security", 4, "repository", "judge", True,
      "End-user data collection has consent, retention and deletion handling.",
      ("consent management", "data retention policy", "export and delete endpoints"), c_privacy_compliance),
    C("dast_scanning", "DAST Scanning", "security", 4, "application", "probe", True,
      "A deployed web service is scanned while running, in CI against a test environment.",
      ("OWASP ZAP", "Nuclei", "StackHawk", "Burp"), c_dast_scanning),
    C("circuit_breakers", "Circuit Breakers", "debugging", 4, "application", "probe", True,
      "Calls to external services fail fast and retry with backoff instead of cascading.",
      ("opossum", "cockatiel", "resilience4j", "tenacity", "Polly", "service mesh outlier detection"), c_circuit_breakers),
    C("profiling_instrumentation", "Profiling Instrumentation", "debugging", 4, "application", "judge", True,
      "Performance can be profiled in production or development with checked-in setup.",
      ("Pyroscope", "Datadog profiler", "clinic.js", "py-spy", "JFR", "pprof"), c_profiling_instrumentation),
    C("code_modularization", "Code Modularization Enforcement", "style", 4, "application", "probe", True,
      "Module boundaries are enforced by tooling, so an agent cannot quietly import across layers.",
      ("dependency-cruiser", "eslint-plugin-boundaries", "import-linter", "ArchUnit", "Go internal/"), c_code_modularization),
    C("n_plus_one_detection", "N+1 Query Detection", "debugging", 4, "application", "probe", True,
      "Code that talks to a database has N+1 query detection.",
      ("bullet", "nplusone", "DataLoader", "query-count assertions"), c_n_plus_one_detection),
    C("test_isolation", "Test Isolation", "testing", 4, "application", "probe", False,
      "Tests run in parallel or random order without interfering, so hidden coupling shows up.",
      ("vitest or jest default parallelism", "pytest-xdist", "pytest-randomly", "t.Parallel()", "Testcontainers"), c_test_isolation),
    C("agents_md_validation", "AGENTS.md Freshness Validation", "docs", 4, "repository", "probe", False,
      "Something checks that the agent instructions still match the code: link checks, doc tests or a job that runs the documented commands.",
      ("lychee", "markdown-link-check", "a CI job running AGENTS.md commands"), c_agents_md_validation),
    # Level 5
    C("cyclomatic_complexity", "Cyclomatic Complexity", "style", 5, "application", "probe", False,
      "Code complexity is measured against a threshold.",
      ("ESLint complexity", "ruff C901", "radon", "lizard", "gocyclo", "PMD", "SonarQube"), c_cyclomatic_complexity),
    C("error_to_insight_pipeline", "Error to Insight Pipeline", "product", 5, "application", "probe", False,
      "Tracked errors turn into issues automatically.",
      ("Sentry GitHub integration", "Sentry release action", "error-to-issue automation"), c_error_to_insight_pipeline),
)  # fmt: skip

CRITERIA: Mapping[str, Criterion] = {c.id: c for c in REGISTRY}


# --- evaluation -------------------------------------------------------------------


def to_result(c: Criterion, v: Verdict) -> Result:
    base = dict(id=c.id, level=c.level, origin=c.origin)
    match v:
        case Pass(evidence):
            return Result(
                **base, status="pass", numerator=1, denominator=1, detail="", evidence=evidence
            )
        case Fail(reason):
            return Result(
                **base, status="fail", numerator=0, denominator=1, detail=reason, evidence=()
            )
        case NeedsJudgement(question, candidates):
            return Result(
                **base,
                status="judge",
                numerator=0,
                denominator=1,
                detail=question,
                evidence=candidates,
            )
        case Skip(reason, cause):
            return Result(
                **base,
                status="skip",
                numerator=0,
                denominator=1,
                detail=reason,
                evidence=(),
                skip_cause=cause,
            )
    raise TypeError(v)  # pragma: no cover


def evaluate(s: Snapshot) -> tuple[Result, ...]:
    return tuple(to_result(c, c.check(s)) for c in REGISTRY)


def apply_judgements(
    results: Iterable[Result], judged: Mapping[str, Mapping]
) -> tuple[Result, ...]:
    """Fold the agent's decisions in. Any criterion may be judged, not only pending ones."""
    unknown = sorted(set(judged) - set(CRITERIA))
    if unknown:
        raise ValueError("unknown criterion ids in judgements: " + ", ".join(unknown))
    out = []
    for r in results:
        j = judged.get(r.id)
        if j is None:
            out.append(r)
            continue
        status = j.get("status")
        if status not in ("pass", "fail", "skip"):
            raise ValueError(f"{r.id}: status must be pass, fail or skip, got {status!r}")
        den = int(j.get("denominator", 1))
        num = float(j.get("numerator", den if status == "pass" else 0))
        if den < 1 or not 0 <= num <= den:
            raise ValueError(f"{r.id}: need 0 <= numerator <= denominator and denominator >= 1")
        cause = j.get("cause", "not_applicable") if status == "skip" else None
        if cause not in (None, "not_applicable", "environment"):
            raise ValueError(f"{r.id}: cause must be not_applicable or environment")
        evidence = tuple(j.get("evidence", ())) or r.evidence
        out.append(replace(r, status=status, numerator=num, denominator=den,
                           detail=str(j.get("detail", "")), evidence=evidence, skip_cause=cause))  # fmt: skip
    return tuple(out)


# --- scoring ------------------------------------------------------------------------

BANDS = (20, 40, 60, 80)
GATE = 0.8


def _level_for(pct: float) -> int:
    return 1 + sum(pct >= b for b in BANDS)


def _scored(results: Iterable[Result]) -> list[Result]:
    return [r for r in results if r.status in ("pass", "fail")]


def score(results: Iterable[Result]) -> Score:
    results = list(results)
    core = [r for r in _scored(results) if r.origin == "core"]
    total = len(core)
    passed = sum(r.numerator / r.denominator for r in core)
    flat = passed / total * 100 if total else 0.0
    flat_level = _level_for(flat)
    to_next = None
    if flat_level < 5 and total:
        target = BANDS[flat_level - 1]
        to_next = max(0, math.ceil((target - flat) / 100 * total - 1e-9))

    per_level: dict[int, tuple[float, int]] = {}
    for lvl in range(1, 6):
        rs = [r for r in _scored(results) if r.level == lvl]
        per_level[lvl] = (sum(r.numerator / r.denominator for r in rs), len(rs))

    gated, gap = 0, None
    cum_pass, cum_total = 0.0, 0
    for lvl in range(1, 6):
        cum_pass += per_level[lvl][0]
        cum_total += per_level[lvl][1]
        if cum_total == 0 or cum_pass >= GATE * cum_total - 1e-9:
            gated = lvl
            continue
        gap = math.ceil(GATE * cum_total - cum_pass - 1e-9)
        break

    env = [
        r
        for r in results
        if r.status == "skip" and r.skip_cause == "environment" and r.origin == "core"
    ]
    rng = None
    if env and total + len(env):
        n = total + len(env)
        rng = (passed / n * 100, (passed + len(env)) / n * 100)
    return Score(
        flat_pct=flat,
        flat_level=flat_level,
        checks_to_next_level=to_next,
        gated_level=gated,
        gate_gap=gap,
        per_level=per_level,
        pending=sum(r.status == "judge" for r in results),
        env_skipped=len(
            [r for r in results if r.status == "skip" and r.skip_cause == "environment"]
        ),
        flat_pct_range=rng,
    )


# --- rendering ---------------------------------------------------------------------


Change = tuple[str, str, str]


def diff(previous: Mapping, results: Iterable[Result]) -> tuple[list[Change], list[Change]]:
    """(id, old status, new status) for each changed criterion, split in two:
    real transitions, and ones where either run left the item unjudged."""
    old = {r["id"]: r["status"] for r in previous.get("results", [])}
    moved = [(r.id, old[r.id], r.status) for r in results if r.id in old and old[r.id] != r.status]
    judged_only = [c for c in moved if "judge" in (c[1], c[2])]
    return [c for c in moved if c not in judged_only], judged_only


def render_json(results: Iterable[Result], sc: Score, meta: Mapping[str, str]) -> str:
    rows = []
    for r in results:
        c = CRITERIA[r.id]
        rows.append({
            "id": r.id, "name": c.name, "level": r.level, "scope": c.scope, "category": c.category,
            "method": c.method, "origin": r.origin, "needs_approval": c.needs_approval,
            "status": r.status, "numerator": r.numerator, "denominator": r.denominator,
            "skip_cause": r.skip_cause, "detail": r.detail, "evidence": list(r.evidence),
        })  # fmt: skip
    body = {
        "schema": 1,
        **meta,
        "score": {
            "flat_pct": round(sc.flat_pct, 1),
            "flat_level": sc.flat_level,
            "checks_to_next_level": sc.checks_to_next_level,
            "gated_level": sc.gated_level,
            "gate_gap": sc.gate_gap,
            "pending_judgements": sc.pending,
            "env_skipped": sc.env_skipped,
            "flat_pct_range_if_env_checked": [round(x, 1) for x in sc.flat_pct_range]
            if sc.flat_pct_range
            else None,
            "per_level": {
                str(k): {"passed": round(v[0], 2), "scored": v[1]} for k, v in sc.per_level.items()
            },
        },
        "results": rows,
    }
    return json.dumps(body, indent=2)


def _fmt_evidence(ev: tuple[str, ...], limit: int = 3) -> str:
    shown = ", ".join(ev[:limit])
    return shown + (f" (+{len(ev) - limit})" if len(ev) > limit else "")


def render_text(results: Iterable[Result], sc: Score, meta: Mapping[str, str],
                changes: tuple[list[Change], list[Change]] | None = None) -> str:  # fmt: skip
    results = list(results)
    out = [f"agent-readiness probe: {meta.get('repo', '?')} @ {meta.get('commit', '?')}", ""]
    rng = ""
    if sc.flat_pct_range:
        rng = f" (range {sc.flat_pct_range[0]:.0f}-{sc.flat_pct_range[1]:.0f}% once {sc.env_skipped} env checks run)"
    out.append(f"Gated level: {sc.gated_level} of 5"
               + (f", {sc.gate_gap} more passes for the next" if sc.gate_gap else ""))  # fmt: skip
    out.append(f"Flat score: {sc.flat_pct:.1f}% = level {sc.flat_level}{rng}")
    if sc.pending:
        out.append(f"Pending judgements: {sc.pending} (scores exclude them until judged)")
    out.append("")
    for lvl in range(1, 6):
        p, n = sc.per_level[lvl]
        out.append(f"L{lvl}: {p:g}/{n}")
    for status, title in (("fail", "FAIL"), ("judge", "JUDGE"), ("pass", "PASS"), ("skip", "SKIP")):
        rows = sorted((r for r in results if r.status == status), key=lambda r: (r.level, r.id))
        if not rows:
            continue
        out.append("")
        out.append(f"{title} ({len(rows)})")
        for r in rows:
            c = CRITERIA[r.id]
            tag = f"L{r.level} {r.id}"
            if r.denominator != 1:
                tag += f" {r.numerator:g}/{r.denominator}"
            if status == "pass":
                out.append(f"  {tag}: {_fmt_evidence(r.evidence)}")
            elif status == "skip":
                out.append(f"  {tag} [{r.skip_cause}]: {r.detail}")
            elif status == "judge":
                approval = " [needs approval]" if c.needs_approval else ""
                out.append(f"  {tag}{approval}: {r.detail}")
                if r.evidence:
                    out.append(f"      read: {_fmt_evidence(r.evidence, 5)}")
            else:
                out.append(f"  {tag}: {r.detail}")
    if changes is not None:
        moved, judged_only = changes
        out.append("")
        out.append(f"CHANGED since previous snapshot ({len(moved)})")
        out.extend(f"  {cid}: {old} -> {new}" for cid, old, new in moved)
        if judged_only:
            out.append("")
            out.append(f"Judged in only one run, not a repo change ({len(judged_only)})")
            out.extend(f"  {cid}: {old} -> {new}" for cid, old, new in judged_only)
    return "\n".join(out)


def _md_example(e: str) -> str:
    """Code-format paths, globs and commands so `*` never reads as emphasis."""
    if "`" in e:
        return e
    code_chars = "*<" if " " in e else "*./<>:@_=[]"
    return f"`{e}`" if any(ch in e for ch in code_chars) else e


def render_criteria_md(registry: Iterable[Criterion]) -> str:
    registry = list(registry)
    lines = [
        "# Criteria",
        "",
        "Generated by `scripts/probe.py --criteria-md` from the probe's registry. Do not edit by hand.",
        "",
        "Criteria judge outcomes, never tools. Each outcome says what must be true. The examples are",
        "some ways to get there, not requirements: any mechanism that makes the outcome true passes, and",
        "no repo is marked down for choosing a different tool.",
        "",
        "Columns: `method` is `probe` (decided by the script), `judge` (the agent decides from the cited",
        "files) or `env` (needs forge access; skipped as `environment` without it). `approval` means",
        "checking it runs commands, so ask first. `extension` marks criteria outside the 84-criterion",
        "core catalogue; they count toward the gated level but not the flat score.",
        "",
        "## Contents",
        "",
    ]
    for lvl in range(1, 6):
        lines.append(f"- [Level {lvl}](#level-{lvl})")
    for lvl in range(1, 6):
        if lines[-1] != "":
            lines.append("")
        lines += [f"## Level {lvl}", ""]
        for c in sorted((c for c in registry if c.level == lvl), key=lambda c: (c.category, c.id)):
            flags = [c.scope, c.category, c.method]
            if c.skippable:
                flags.append("skippable")
            if c.needs_approval:
                flags.append("approval")
            if c.origin != "core":
                flags.append(c.origin)
            lines.append(f"### `{c.id}` {c.name}")
            lines.append("")
            lines.append("Tags: " + ", ".join(f"`{f}`" for f in flags) + ".")
            lines.append("")
            lines.append(c.outcome)
            lines.append("")
            lines.append("Examples: " + ", ".join(_md_example(e) for e in c.examples) + ".")
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


# --- imperative shell ------------------------------------------------------------

MAX_FILES = 400
MAX_BYTES = 64 * 1024
READ_GLOBS = (
    *MANIFESTS, *CI, *GIT_HOOKS, *AGENT_HOOK_CONFIGS, *ROOT_DOCS, *TASK_FILES, *LINTER_CONFIGS,
    *FORMATTER_CONFIGS, *SKILL_DIRS, *TOOLCHAIN_FILES, "docs/*.md", "ARCHITECTURE.md",
    "**/tsconfig*.json", "**/jsconfig.json", "**/pnpm-workspace.yaml", "**/setup.cfg", "**/tox.ini",
    "**/pytest.ini", "**/mypy.ini", "**/.mypy.ini", "**/pyrefly.toml", "**/pyrightconfig.json",
    "**/.coveragerc", "**/go.work", "**/settings.gradle*", "**/gradle.properties", ".npmrc", "**/.npmrc",
    "**/.yarnrc.yml", "**/bunfig.toml", "**/uv.toml", "**/pip.conf", "**/vitest.config.*",
    "**/vite.config.*", "**/jest.config.*", "**/playwright.config.*", "**/cypress.config.*",
    "**/knip.json", "**/knip.config.*", "**/.dependency-cruiser.*", "**/.jscpd.json", ".size-limit*",
    "**/docker-compose*.y*ml", "**/compose.y*ml", "**/Dockerfile*", ".gitignore", ".gitattributes",
    "CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS", ".gitlab/CODEOWNERS", "renovate.json",
    "renovate.json5", ".renovaterc*", ".github/renovate.json*", ".github/dependabot.y*ml",
    "codecov.yml", ".codecov.yml", "sonar-project.properties", "**/.importlinter", ".releaserc*",
    "release.config.*", "release-please-config.json", "cliff.toml", ".goreleaser.y*ml", "turbo.json",
    "nx.json", "lerna.json", ".syncpackrc*", "mkdocs.y*ml", "typedoc.json", ".sops.yaml",
    ".gitleaks.toml", "**/k8s/**/*.y*ml", "**/*.tf", "fly.toml", "wrangler.toml", "**/alerts.y*ml",
    "**/.env.example", "**/lefthook-local.yml", ".pre-commit-hooks.yaml", "**/Chart.yaml",
)  # fmt: skip


class ProbeError(Exception):
    """A condition the user must fix; exit 2 with this message."""


def run_git(args: list[str], cwd: Path) -> str:
    """The only port to git. Raises ProbeError on failure."""
    try:
        proc = subprocess.run(
            ["git", *args], cwd=cwd, capture_output=True, text=True, timeout=60, check=False,
            stdin=subprocess.DEVNULL,
        )  # fmt: skip
    except (OSError, subprocess.TimeoutExpired) as e:
        raise ProbeError(f"git {' '.join(args)}: {e}") from e
    if proc.returncode != 0:
        raise ProbeError(proc.stderr.strip() or f"git {' '.join(args)} failed")
    return proc.stdout


def _read_bounded(path: Path) -> str | None:
    try:
        if not path.is_file():
            return None
        with path.open("rb") as f:
            return f.read(MAX_BYTES).decode("utf-8", errors="replace")
    except OSError:
        return None


def gather(root: Path, today: date) -> Snapshot:
    """Observe the repo: tracked paths, bounded config reads, git facts. Runs nothing else."""
    paths = frozenset(p for p in run_git(["ls-files", "-z"], root).split("\0") if p)
    wanted = sorted(
        (p for p in paths if any(_glob(p, g) for g in READ_GLOBS)),
        key=lambda p: (p.count("/"), p),
    )[:MAX_FILES]
    texts = {}
    for p in wanted:
        body = _read_bounded(root / p)
        if body is not None:
            texts[p] = body
    doc_dates = {}
    commit_lines: tuple[str, ...] = ()
    try:
        for doc in ("README.md", "AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md"):
            if doc in paths:
                out = run_git(["log", "-1", "--format=%cs", "--", doc], root).strip()
                if out:
                    doc_dates[doc] = date.fromisoformat(out)
        log = run_git(["log", "-100", "--format=%an <%ae>%n%b%x00"], root)
        commit_lines = tuple(
            ln for ln in log.replace("\0", "\n").splitlines()
            if ln.strip() and ("<" in ln or ln.lower().startswith(("co-authored-by", "generated with")))
        )  # fmt: skip
    except ProbeError:
        pass  # a repo with no commits yet has no history to read
    return Snapshot(
        paths=paths, texts=texts, doc_dates=doc_dates, commit_lines=commit_lines, today=today
    )


def _load_json(path: str) -> Mapping:
    try:
        return json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as e:
        raise ProbeError(f"cannot read {path}: {e}") from e


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="probe.py", description=__doc__.split("\n\n")[0])
    parser.add_argument("repo", nargs="?", help="path inside the git repository to audit")
    parser.add_argument("--json", action="store_true", help="print a JSON snapshot instead of text")
    parser.add_argument(
        "--judged", metavar="FILE", help="JSON object of {id: {status, detail, ...}} from the agent"
    )
    parser.add_argument("--previous", metavar="FILE", help="earlier --json output to diff against")
    parser.add_argument(
        "--criteria-md", action="store_true", help="print references/criteria.md and exit"
    )
    args = parser.parse_args(argv)

    if args.criteria_md:
        sys.stdout.write(render_criteria_md(REGISTRY))
        return 0
    if not args.repo:
        parser.print_usage(sys.stderr)
        print("probe.py: error: a repo path is required", file=sys.stderr)
        return 2
    try:
        start = Path(args.repo)
        if not start.is_dir():
            raise ProbeError(f"{args.repo} is not a directory")
        root = Path(run_git(["rev-parse", "--show-toplevel"], start).strip())
        today = datetime.now().astimezone().date()
        snapshot = gather(root, today)
        results = evaluate(snapshot)
        if args.judged:
            try:
                results = apply_judgements(results, _load_json(args.judged))
            except ValueError as e:
                raise ProbeError(str(e)) from e
        try:
            commit = run_git(["rev-parse", "--short", "HEAD"], root).strip()
        except ProbeError:
            commit = "no commits"
        meta = {"repo": root.name, "commit": commit, "date": today.isoformat()}
        changes = diff(_load_json(args.previous), results) if args.previous else None
    except ProbeError as e:
        print(f"probe.py: {e}", file=sys.stderr)
        return 2
    sc = score(results)
    if args.json:
        print(render_json(results, sc, meta))
    else:
        print(render_text(results, sc, meta, changes))
    return 0


if __name__ == "__main__":
    sys.exit(main())
