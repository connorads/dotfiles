"""Pre-commit guard: the path lists hk gates key on must not drift from reality.

hk steps select work by hard-coded path prefix, and they fail **open**: a glob
that matches nothing exits 0, so a gate that stops covering its project goes
quiet rather than failing the commit. Three steps compound that by spelling
their roots twice - once in `hk.pkl`'s glob, once inside the script they run -
and `ts-tests.sh` says so in a comment. That is a rule a reviewer has to
remember, which is what this checker replaces.

Three assertions, in value order:

  (a) Paired lists agree. For each step/script pair, every root the script
      knows is reachable through the step's glob, and every root the glob
      selects is handled by the script. A root the glob misses is never
      reached at commit time; a root the script misses is a silent skip.

  (b) Every path literal a gate keys on resolves. This is the assertion the
      gate sources cannot make about themselves - `fzf-bind-lint.py` skips a
      root that does not exist, by design, so moving a project past it is
      invisible. Covers hk.pkl globs and the paths embedded in `check`
      commands, the roots in the three scripts, and mise's project dirs.

  (c) First-party projects are discovered, not enumerated. Every tracked
      manifest that is not vendored resolves to a project root, and each root
      must appear in the gates claiming its language. A project added tomorrow
      fails this until it is wired in - the trap that left agent-guard ungated
      for its whole life. Roots deliberately outside the first-party gates are
      listed in UNGATED with a reason.

Exit codes: 0 = every assertion holds, 1 = drift (printed to stderr).

Tests: uv run --with pytest pytest ~/.hk-hooks/test_gate_coverage.py -v
"""

from __future__ import annotations

import re
import subprocess
import sys
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

HK_PKL = "hk.pkl"
MISE_CONFIG = ".config/mise/config.toml"


# --------------------------------------------------------------------------
# hk.pkl parsing
# --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Step:
    """One hk step: its glob patterns and its check command, with line numbers."""

    name: str
    globs: tuple[str, ...]
    glob_line: int
    check: str
    check_line: int


_STEP_RE = re.compile(r'^\s*\["([^"]+)"\]')
_GLOB_RE = re.compile(r"^\s*glob\s*=\s*List\(")
_CHECK_RE = re.compile(r'^\s*check\s*=\s*"(.*)"\s*$')
_STRING_RE = re.compile(r'"([^"]*)"')


def parse_hk_steps(text: str) -> dict[str, Step]:
    """Read every named step's glob list and check command out of hk.pkl.

    Line-based rather than a pkl parse: `glob` and `check` only ever appear
    inside a step body, so tracking the most recent step header is enough, and
    the checker stays dependency-free like its sibling guards.
    """
    steps: dict[str, Step] = {}
    lines = text.splitlines()
    current = ""
    globs: dict[str, tuple[tuple[str, ...], int]] = {}
    checks: dict[str, tuple[str, int]] = {}

    i = 0
    while i < len(lines):
        line = lines[i]
        m = _STEP_RE.match(line)
        if m:
            current = m.group(1)
            i += 1
            continue
        if current and _GLOB_RE.match(line):
            body = line
            start = i
            while ")" not in body.split("List(", 1)[1]:
                i += 1
                if i >= len(lines):
                    break
                body += "\n" + lines[i]
            globs[current] = (tuple(_STRING_RE.findall(body.split("List(", 1)[1])), start + 1)
            i += 1
            continue
        if current:
            c = _CHECK_RE.match(line)
            if c:
                checks[current] = (c.group(1), i + 1)
        i += 1

    for name in globs.keys() | checks.keys():
        g, gl = globs.get(name, ((), 0))
        c, cl = checks.get(name, ("", 0))
        steps[name] = Step(name=name, globs=g, glob_line=gl, check=c, check_line=cl)
    return steps


def literal_prefix(pattern: str) -> str:
    """The wildcard-free head of a glob - the deepest path it is anchored at.

    `.config/skl/**` -> `.config/skl`; `**/*.ts` -> `` (anchored nowhere, so
    nothing to assert about it).
    """
    kept: list[str] = []
    for part in pattern.split("/"):
        if any(ch in part for ch in "*?["):
            break
        kept.append(part)
    return "/".join(kept)


def overlaps(a: str, b: str) -> bool:
    """True when one path prefix contains the other, so their subtrees meet."""
    if not a or not b:
        return False
    return a == b or a.startswith(b + "/") or b.startswith(a + "/")


# --------------------------------------------------------------------------
# (a) paired lists
# --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Pair:
    """A step whose roots are spelled a second time inside the script it runs."""

    step: str
    source: str
    extract: str


PAIRS: tuple[Pair, ...] = (
    Pair(step="ts-tests-scoped", source=".hk-hooks/ts-tests.sh", extract="shell_roots"),
    Pair(step="bats-scoped", source=".hk-hooks/bats-tests.sh", extract="case_arm_roots"),
    Pair(step="fzf-bind-lint", source=".hk-hooks/fzf-bind-lint.py", extract="python_roots"),
)


def shell_roots(text: str) -> list[str]:
    """`ROOTS="a b c"` in ts-tests.sh."""
    m = re.search(r'^ROOTS="([^"]*)"', text, re.MULTILINE)
    return m.group(1).split() if m else []


def python_roots(text: str) -> list[str]:
    """The `ROOTS: tuple[str, ...] = (...)` literal in fzf-bind-lint.py."""
    m = re.search(r"^ROOTS:[^=]*=\s*\(([^)]*)\)", text, re.MULTILINE)
    return _STRING_RE.findall(m.group(1)) if m else []


def case_arm_roots(text: str) -> list[str]:
    """The path prefixes bats-tests.sh dispatches on, from its `case` arms.

    `$TESTS_DIR` is substituted from the assignment above the case, so the arm
    that matches staged suites resolves to a real root like the others.
    """
    tests_dir = ""
    td = re.search(r"^TESTS_DIR=(\S+)", text, re.MULTILINE)
    if td:
        tests_dir = td.group(1).strip('"')

    block = re.search(r"^\s*case .*? in$(.*?)^\s*esac", text, re.MULTILINE | re.DOTALL)
    if not block:
        return []

    roots: list[str] = []
    for line in block.group(1).splitlines():
        stripped = line.strip()
        if not stripped.endswith(")") or stripped.startswith("#") or ";;" in stripped:
            continue
        # An arm body can also end in `)` - `stem=$(basename "$f")` does. A real
        # arm is a bare pattern, so it holds neither an assignment nor a
        # command substitution.
        if "=" in stripped or "$(" in stripped:
            continue
        for alt in stripped[:-1].split("|"):
            pattern = alt.strip().strip('"').replace('"', "")
            pattern = pattern.replace("$TESTS_DIR", tests_dir)
            prefix = literal_prefix(pattern)
            if prefix:
                roots.append(prefix)
    return roots


def check_pairs(steps: dict[str, Step], sources: dict[str, str]) -> list[str]:
    """Assert each paired list agrees with its twin, in both directions."""
    extractors = {
        "shell_roots": shell_roots,
        "python_roots": python_roots,
        "case_arm_roots": case_arm_roots,
    }
    errors: list[str] = []
    for pair in PAIRS:
        step = steps.get(pair.step)
        if step is None:
            errors.append(f"{HK_PKL}: step {pair.step!r} not found (renamed or removed?)")
            continue
        text = sources.get(pair.source)
        if text is None:
            errors.append(f"{pair.source}: cannot read")
            continue

        script_roots = sorted(set(extractors[pair.extract](text)))
        if not script_roots:
            errors.append(f"{pair.source}: no roots found (list renamed or reshaped?)")
            continue

        # A step globs its own checker so that editing the checker re-triggers
        # it. That entry is a trigger, not a scanned root.
        glob_roots = sorted(
            {
                p
                for p in (literal_prefix(g) for g in step.globs)
                if p and p != pair.source and not overlaps(p, pair.source)
            }
        )

        for root in script_roots:
            if not any(overlaps(root, g) for g in glob_roots):
                errors.append(
                    f"{pair.source}: root {root!r} is not reachable through"
                    f" {HK_PKL}:{step.glob_line} ({pair.step} glob) - staging only that"
                    f" tree never runs the gate"
                )
        for glob_root in glob_roots:
            if not any(overlaps(glob_root, r) for r in script_roots):
                errors.append(
                    f"{HK_PKL}:{step.glob_line}: {pair.step} globs {glob_root!r} but"
                    f" {pair.source} has no matching root - a silent skip"
                )
    return errors


# --------------------------------------------------------------------------
# (b) path literals resolve
# --------------------------------------------------------------------------

# A path token inside a shell/TOML string: anchored at a dot-directory or one of
# the work-tree's top-level source dirs, so prose and regex fragments in the
# same string are not mistaken for paths.
_PATH_TOKEN = re.compile(r"(?<![\w./-])(?:\.[\w.-]+|src|skills|docs)(?:/[\w.@-]+)+")
# The same anchor, whole-token: mise task bodies are ordinary shell, so a
# candidate has to look like a work-tree path before it is asserted to exist.
_PATH_ANCHOR = re.compile(r"^(?:\.[\w.-]+|src|skills|docs)(?:/[\w.@-]+)*$")
_CD_TARGET = re.compile(r"\bcd\s+\\?\"?([^\"\s;)&|\\]+)")
_FOR_LIST = re.compile(r"\bfor\s+\w+\s+in\s+([^;\n]+);\s*do")
_HK_SCRIPT = re.compile(r"(?<![\w./-])\.hk-hooks/[\w.-]+\.(?:sh|py)")


def hk_path_literals(steps: dict[str, Step]) -> list[tuple[str, int, str]]:
    """Every path a step is anchored at: glob prefixes plus paths in `check`.

    Both surfaces matter - the `py-typecheck-*` steps put the project dir in
    the command, not the glob, so a glob-only sweep would miss them.
    """
    found: list[tuple[str, int, str]] = []
    for step in sorted(steps.values(), key=lambda s: s.name):
        for pattern in step.globs:
            prefix = literal_prefix(pattern)
            if prefix:
                found.append((f"{HK_PKL} ({step.name} glob)", step.glob_line, prefix))
        for token in _PATH_TOKEN.findall(step.check):
            found.append((f"{HK_PKL} ({step.name} check)", step.check_line, token))
    return found


def mise_path_literals(text: str) -> list[tuple[str, int, str]]:
    """Project dirs and gate scripts named by mise tasks.

    `cd` targets and `for d in ...` lists are the two shapes the task bodies
    use to name a project; `$HOME/` is stripped and anything still holding a
    variable is left alone.
    """
    found: list[tuple[str, int, str]] = []
    for n, line in enumerate(text.splitlines(), start=1):
        candidates: list[str] = []
        candidates += _CD_TARGET.findall(line)
        for group in _FOR_LIST.findall(line):
            candidates += group.split()
        candidates += _HK_SCRIPT.findall(line)
        for raw in candidates:
            value = raw.strip('"').removeprefix("$HOME/")
            if not _PATH_ANCHOR.match(value):
                continue
            found.append((MISE_CONFIG, n, value))
    return found


def check_paths_exist(
    literals: Iterable[tuple[str, int, str]],
    resolve: Callable[[str], Path] | None = None,
) -> list[str]:
    """Assert each collected literal points at something on disk."""
    resolver = _resolve if resolve is None else resolve
    errors: list[str] = []
    seen: set[tuple[str, str]] = set()
    for source, line, rel in literals:
        key = (source, rel)
        if key in seen:
            continue
        seen.add(key)
        if not resolver(rel).exists():
            errors.append(f"{source}: line {line} keys on {rel!r}, which does not exist")
    return errors


# --------------------------------------------------------------------------
# (c) projects are discovered, not enumerated
# --------------------------------------------------------------------------

MANIFESTS = {
    "package.json": "ts",
    "tsconfig.json": "ts",
    "pyproject.toml": "py",
    "pyrefly.toml": "py",
}

# Third-party and fixture trees are not ours to gate. Mirrors the intent of the
# filter in mise's `py-checks`, widened to any vendor set: skills are vendored
# under `<set>/.agents/skills/`, not only under `vendor/.agents/skills/`.
DISCOVERY_EXCLUDE = re.compile(
    r"/\.agents/skills/"  # vendored third-party skills, any vendor set
    r"|\.config/skills/vendor/"  # the vendor tree's patches/ and manual/ dirs
    r"|/evals/fixtures/"  # skill eval fixtures - deliberately broken code
    r"|/references/"  # skill reference material, not first-party code
    r"|/node_modules/"
)

# First-party roots that no first-party gate claims, with the reason. Listing a
# root here is a decision, not an oversight - the point of (c) is that a new
# project cannot arrive silently.
UNGATED: dict[str, str] = {
    "src/dotfiles-docs": "Astro site; `astro check` needs the Astro toolchain, not tsc",
    "src/raycast/shotpath": "Raycast extension; typechecked by `ray build` against raycast-env.d.ts",
    "src/raycast/skl": "Raycast extension; typechecked by `ray build` against raycast-env.d.ts",
    "src/handoff": "stdlib-only Python; tests run in its own uv project env",
}


def discover_projects(tracked: Iterable[str]) -> dict[str, str]:
    """Map every non-vendored manifest to its project root and language."""
    projects: dict[str, str] = {}
    for path in tracked:
        name = path.rsplit("/", 1)[-1]
        language = MANIFESTS.get(name)
        if language is None or DISCOVERY_EXCLUDE.search("/" + path):
            continue
        root = path[: -(len(name) + 1)] if "/" in path else "."
        # A ts manifest wins over a py one only if both are present; neither
        # happens today, and first-seen is a stable, explainable rule.
        projects.setdefault(root, language)
    return projects


def check_projects(
    projects: dict[str, str], steps: dict[str, Step], ungated: dict[str, str] | None = None
) -> list[str]:
    """Assert each discovered root is claimed by the gates for its language."""
    exempt = UNGATED if ungated is None else ungated

    def claimed_by(prefix: str, root: str) -> bool:
        return any(
            overlaps(root, literal_prefix(g))
            for name, step in steps.items()
            if name.startswith(prefix)
            for g in step.globs
        )

    errors: list[str] = []
    for root, language in sorted(projects.items()):
        if root in exempt:
            continue
        if language == "ts":
            test_step = steps.get("ts-tests-scoped")
            globs = test_step.globs if test_step else ()
            if not any(overlaps(root, literal_prefix(g)) for g in globs):
                errors.append(
                    f"{root}: TypeScript project not covered by the ts-tests-scoped glob"
                    f" (add it there and to .hk-hooks/ts-tests.sh ROOTS, or to"
                    f" gate-coverage.py UNGATED with a reason)"
                )
            if not claimed_by("ts-typecheck-", root):
                errors.append(
                    f"{root}: TypeScript project has no ts-typecheck-* step"
                    f" (add one, or add the root to gate-coverage.py UNGATED with a reason)"
                )
        elif language == "py" and not claimed_by("py-typecheck-", root):
            errors.append(
                f"{root}: Python project has no py-typecheck-* step"
                f" (add one, or add the root to gate-coverage.py UNGATED with a reason)"
            )

    for root in sorted(exempt):
        if root not in projects:
            errors.append(
                f"gate-coverage.py: UNGATED lists {root!r}, which is no longer a"
                f" discovered project - drop the entry"
            )
    return errors


# --------------------------------------------------------------------------
# wiring
# --------------------------------------------------------------------------


def _resolve(rel: str) -> Path:
    """Prefer the cwd-relative path (pre-commit runs from $HOME), else $HOME."""
    p = Path(rel)
    return p if p.exists() else Path.home() / rel


def _read(rel: str) -> str | None:
    try:
        return _resolve(rel).read_text()
    except OSError:
        return None


def tracked_files() -> list[str] | None:
    """Tracked paths from the dotfiles work-tree, or None if git cannot answer."""
    home = Path.home()
    try:
        out = subprocess.run(
            [
                "git",
                f"--git-dir={home / 'git' / 'dotfiles'}",
                f"--work-tree={home}",
                "ls-files",
            ],
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return out.stdout.splitlines()


def main() -> int:
    hk_text = _read(HK_PKL)
    if hk_text is None:
        print(f"gate-coverage: cannot read {HK_PKL}", file=sys.stderr)
        return 1
    steps = parse_hk_steps(hk_text)

    sources = {pair.source: _read(pair.source) for pair in PAIRS}
    errors = check_pairs(steps, {k: v for k, v in sources.items() if v is not None})

    literals = hk_path_literals(steps)
    for pair in PAIRS:
        text = sources.get(pair.source)
        if text is None:
            continue
        extractor = {
            "shell_roots": shell_roots,
            "python_roots": python_roots,
            "case_arm_roots": case_arm_roots,
        }[pair.extract]
        literals += [(pair.source, 0, root) for root in extractor(text)]
    bats = sources.get(".hk-hooks/bats-tests.sh")
    if bats:
        td = re.search(r"^TESTS_DIR=(\S+)", bats, re.MULTILINE)
        if td:
            literals.append((".hk-hooks/bats-tests.sh", 0, td.group(1).strip('"')))
    mise_text = _read(MISE_CONFIG)
    if mise_text is not None:
        literals += mise_path_literals(mise_text)
    errors += check_paths_exist(literals)

    tracked = tracked_files()
    if tracked is None:
        print(
            "gate-coverage: warning: cannot list tracked files;"
            " skipping project discovery (run 'mise run gate-coverage')",
            file=sys.stderr,
        )
    else:
        errors += check_projects(discover_projects(tracked), steps)

    if errors:
        print("gate-coverage: gate path lists have drifted:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
