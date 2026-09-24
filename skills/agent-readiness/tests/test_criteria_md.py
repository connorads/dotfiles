"""The registry is the single source of truth; criteria.md is generated from it."""

from __future__ import annotations

import re

from conftest import ROOT, probe

CORE_IDS = {
    "lint_config", "type_check", "formatter", "pre_commit_hooks", "build_cmd_doc",
    "deps_pinned", "vcs_cli_tools", "unit_tests_exist", "integration_tests_exist",
    "unit_tests_runnable", "test_performance_tracking", "flaky_test_detection",
    "agents_md", "readme", "devcontainer", "structured_logging", "distributed_tracing",
    "metrics_collection", "code_quality_metrics", "branch_protection", "secret_scanning",
    "codeowners", "automated_pr_review", "agentic_development", "fast_ci_feedback",
    "build_performance_tracking", "deployment_frequency", "automated_security_review",
    "automated_doc_generation", "skills", "documentation_freshness", "strict_typing",
    "naming_consistency", "cyclomatic_complexity", "single_command_setup",
    "feature_flag_infrastructure", "release_notes_automation", "progressive_rollout",
    "rollback_automation", "monorepo_tooling", "test_coverage_thresholds",
    "api_schema_docs", "service_flow_documented", "env_template", "local_services_setup",
    "database_schema", "devcontainer_runnable", "error_tracking_contextualized",
    "alerting_configured", "runbooks_documented", "deployment_observability",
    "dependency_update_automation", "gitignore_comprehensive", "issue_templates",
    "issue_labeling_system", "backlog_health", "pr_templates",
    "product_analytics_instrumentation", "error_to_insight_pipeline", "dast_scanning",
    "pii_handling", "privacy_compliance", "secrets_management", "log_scrubbing",
    "health_checks", "dead_feature_flag_detection", "circuit_breakers",
    "profiling_instrumentation", "large_file_detection", "heavy_dependency_detection",
    "unused_dependencies_detection", "tech_debt_tracking", "dead_code_detection",
    "version_drift_detection", "code_modularization", "duplicate_code_detection",
    "n_plus_one_detection", "test_naming_conventions", "test_isolation",
    "interactive_qa_exists", "interactive_qa_runnable", "agents_md_validation",
    "release_automation", "min_release_age",
}  # fmt: skip


def test_committed_criteria_md_matches_the_registry():
    committed = (ROOT / "references" / "criteria.md").read_text()
    assert committed == probe.render_criteria_md(probe.REGISTRY), (
        "references/criteria.md is stale: regenerate with "
        "`python3 scripts/probe.py --criteria-md > references/criteria.md`"
    )


def test_ids_are_unique():
    ids = [c.id for c in probe.REGISTRY]
    assert len(ids) == len(set(ids))


def test_the_core_catalogue_is_complete():
    core = {c.id for c in probe.REGISTRY if c.origin == "core"}
    assert core == CORE_IDS


def test_extensions_are_marked():
    extensions = {c.id for c in probe.REGISTRY if c.origin == "extension"}
    assert extensions == {"toolchain_pinned"}


def test_levels_scopes_and_methods_are_in_range():
    for c in probe.REGISTRY:
        assert c.level in {1, 2, 3, 4, 5}, c.id
        assert c.scope in {"repository", "application"}, c.id
        assert c.method in {"probe", "judge", "env"}, c.id
        assert callable(c.check), c.id


def test_every_judge_criterion_has_examples():
    for c in probe.REGISTRY:
        if c.method == "judge":
            assert c.examples, c.id


def test_outcomes_name_what_must_be_true_not_a_mandatory_tool():
    mandatory = re.compile(r"\b(must|should|has to|needs to) (use|be|install|adopt)\b", re.I)
    for c in probe.REGISTRY:
        assert c.outcome.strip(), c.id
        assert not mandatory.search(c.outcome), f"{c.id}: {c.outcome}"


def test_no_phantom_level_or_piped_evidence_commands():
    for c in probe.REGISTRY:
        text = " ".join((c.outcome, *c.examples))
        assert "Level 6" not in text, c.id
        assert "| head" not in text, c.id
