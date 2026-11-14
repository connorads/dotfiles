import importlib.util
import json
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "skill-gaps.py"


def load_module():
    spec = importlib.util.spec_from_file_location("skill_gaps", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


sg = load_module()


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def make_set(root: Path, vendored: dict[str, str], excluded=None, bodies=None) -> Path:
    set_dir = root / "vendor" / "demo"
    lock = {
        "version": 1,
        "skills": {
            name: {"source": "acme/skills", "sourceType": "github", "skillPath": path}
            for name, path in vendored.items()
        },
    }
    write(set_dir / "skills-lock.json", json.dumps(lock))
    if excluded is not None:
        write(set_dir / "skills-exclude.json", json.dumps(excluded))
    for name in vendored:
        body = (bodies or {}).get(name, "# skill\n")
        write(set_dir / ".agents/skills" / name / "SKILL.md", body)
    return set_dir


def make_checkout(root: Path, paths: list[str]) -> Path:
    checkout = root / "checkout"
    for p in paths:
        write(checkout / p, f"---\nname: {Path(p).parent.name}\n---\n")
    return checkout


def test_check_passes_for_disjoint_reasoned_exclusions(tmp_path):
    make_set(tmp_path, {"alpha": "skills/alpha/SKILL.md"}, {"beta": "off-domain"})
    assert sg.check(tmp_path / "vendor") == 0


def test_check_fails_when_a_skill_is_vendored_and_excluded(tmp_path, capsys):
    make_set(tmp_path, {"alpha": "skills/alpha/SKILL.md"}, {"alpha": "dup"})
    assert sg.check(tmp_path / "vendor") == 1
    assert "both vendored and excluded" in capsys.readouterr().err


def test_check_fails_on_empty_reason(tmp_path, capsys):
    make_set(tmp_path, {"alpha": "skills/alpha/SKILL.md"}, {"beta": " "})
    assert sg.check(tmp_path / "vendor") == 1
    assert "non-empty" in capsys.readouterr().err


def test_check_fails_on_a_list_instead_of_an_object(tmp_path, capsys):
    make_set(tmp_path, {"alpha": "skills/alpha/SKILL.md"}, ["beta"])
    assert sg.check(tmp_path / "vendor") == 1
    assert "must be an object" in capsys.readouterr().err


def test_scan_reports_only_siblings_of_vendored_skills(tmp_path):
    set_dir = make_set(tmp_path, {"alpha": "skills/alpha/SKILL.md"}, {"gone": "old"})
    checkout = make_checkout(
        tmp_path,
        [
            "skills/alpha/SKILL.md",
            "skills/beta/SKILL.md",
            ".claude/skills/alpha/SKILL.md",
            "tests/fixtures/skills/gamma/SKILL.md",
        ],
    )
    rows = sg.scan(set_dir, {"acme/skills": checkout})
    assert rows == [
        ("candidate", "acme/skills", "beta", "skills/beta/SKILL.md"),
        ("stale-exclusion", "gone"),
    ]


def test_scan_matches_vendored_skills_by_path_not_folder_name(tmp_path):
    set_dir = make_set(tmp_path, {"acme-alpha": "skills/alpha/SKILL.md"})
    checkout = tmp_path / "checkout"
    write(checkout / "skills/alpha/SKILL.md", "---\nname: acme-alpha\n---\n")
    write(checkout / "skills/beta/SKILL.md", "---\nname: acme-beta\n---\n")
    assert sg.scan(set_dir, {"ACME/Skills": checkout}) == [
        ("candidate", "acme/skills", "acme-beta", "skills/beta/SKILL.md")
    ]


def test_scan_stays_quiet_for_an_excluded_unreferenced_skill(tmp_path):
    set_dir = make_set(tmp_path, {"alpha": "skills/alpha/SKILL.md"}, {"beta": "skip"})
    checkout = make_checkout(tmp_path, ["skills/alpha/SKILL.md", "skills/beta/SKILL.md"])
    assert sg.scan(set_dir, {"acme/skills": checkout}) == []


def test_scan_reraises_an_exclusion_a_vendored_skill_names(tmp_path):
    set_dir = make_set(
        tmp_path,
        {"alpha": "skills/alpha/SKILL.md"},
        {"beta": "skip"},
        bodies={"alpha": "Next, run the `beta` skill.\n"},
    )
    checkout = make_checkout(tmp_path, ["skills/alpha/SKILL.md", "skills/beta/SKILL.md"])
    assert sg.scan(set_dir, {"acme/skills": checkout}) == [
        ("referenced-exclusion", "beta", "alpha")
    ]


def test_references_ignores_the_name_as_plain_text_or_code():
    assert not sg.references("then implement the change", "implement")
    assert not sg.references("with `mr` in place of `pr`", "pr")
    assert sg.references("use /implement next", "implement")
    assert sg.references("Is the `triage` skill installed?", "triage")
    assert sg.references("see skills/triage/SKILL.md", "triage")
    assert not sg.references(
        "[guide](https://github.com/o/r/blob/abc/skills/triage/ref.md)", "triage"
    )
