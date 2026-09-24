"""Scoring: the flat mean over core criteria and the cumulative 80% gate.

Named examples pin the arithmetic; seeded random inputs pin the invariants a
reader of the report relies on.
"""

from __future__ import annotations

import math
import random

import pytest
from conftest import probe


def res(level, status, num=None, den=1, *, origin="core", cause=None, cid=None):
    if num is None:
        num = 1 if status == "pass" else 0
    return probe.Result(
        id=cid or f"c{level}_{status}_{random.random()}",
        level=level,
        origin=origin,
        status=status,
        numerator=num,
        denominator=den,
        detail="",
        evidence=(),
        skip_cause=cause,
    )


def test_flat_mean_averages_per_criterion_fractions():
    # Three criteria scoring 3/5, 1/1 and 0/2 apps: (0.6 + 1 + 0) / 3.
    results = [res(1, "fail", 3, 5), res(2, "pass", 1, 1), res(3, "fail", 0, 2)]
    s = probe.score(results)
    assert s.flat_pct == pytest.approx(53.333, abs=0.01)
    assert s.flat_level == 3


@pytest.mark.parametrize(
    ("pct_passes", "level"),
    [(0, 1), (19, 1), (20, 2), (39, 2), (40, 3), (60, 4), (79, 4), (80, 5), (100, 5)],
)
def test_flat_level_uses_20_percent_bands(pct_passes, level):
    results = [res(1, "pass")] * pct_passes + [res(1, "fail")] * (100 - pct_passes)
    assert probe.score(results).flat_level == level


def test_gated_level_stops_cheap_high_wins_hiding_a_failing_l1():
    results = (
        [res(1, "fail")] * 5 + [res(1, "pass")] * 2 + [res(3, "pass")] * 20 + [res(4, "pass")] * 20
    )
    s = probe.score(results)
    assert s.flat_level == 5
    assert s.gated_level == 0


def test_gated_level_counts_cumulatively():
    # L1 alone is 4/5 = 80%; L1+L2 is 5/10 = 50%, so the gate holds at 1.
    results = [res(1, "pass")] * 4 + [res(1, "fail")] + [res(2, "pass")] + [res(2, "fail")] * 4
    assert probe.score(results).gated_level == 1


def test_gate_gap_names_the_passes_needed_for_the_next_gated_level():
    results = [res(1, "pass")] * 4 + [res(1, "fail")] + [res(2, "pass")] + [res(2, "fail")] * 4
    s = probe.score(results)
    # L1+L2 needs 8/10; 5 pass now.
    assert s.gate_gap == 3


def test_extension_criteria_count_for_the_gate_but_not_the_flat_score():
    results = [res(1, "pass"), res(1, "fail", origin="extension")]
    s = probe.score(results)
    assert s.flat_pct == 100
    assert s.gated_level == 0


def test_judge_items_are_pending_not_failed():
    results = [res(1, "pass"), res(1, "judge", 0)]
    s = probe.score(results)
    assert s.flat_pct == 100
    assert s.pending == 1


def test_environment_skips_are_counted_and_bracketed():
    results = [res(1, "pass"), res(1, "fail"), res(2, "skip", cause="environment")]
    s = probe.score(results)
    assert s.flat_pct == 50
    assert s.env_skipped == 1
    assert s.flat_pct_range == (pytest.approx(100 / 3), pytest.approx(200 / 3))


def test_no_environment_skips_means_no_range():
    assert probe.score([res(1, "pass")]).flat_pct_range is None


def test_checks_to_next_level_names_the_passes_to_the_next_band():
    # 30% with 10 checks: the next band is 40%, so one more pass.
    results = [res(1, "pass")] * 3 + [res(1, "fail")] * 7
    assert probe.score(results).checks_to_next_level == 1


def test_top_level_has_no_next_level():
    assert probe.score([res(1, "pass")]).checks_to_next_level is None


# --- invariants over seeded random inputs -----------------------------------


def random_results(rng, *, allow_skips=True):
    out = []
    for c in probe.REGISTRY:
        roll = rng.random()
        if allow_skips and roll < 0.15:
            cause = rng.choice(["environment", "not_applicable"])
            out.append(res(c.level, "skip", 0, cause=cause, origin=c.origin, cid=c.id))
        elif roll < 0.55:
            out.append(res(c.level, "pass", origin=c.origin, cid=c.id))
        else:
            out.append(res(c.level, "fail", origin=c.origin, cid=c.id))
    return out


SEEDS = range(200)


@pytest.mark.parametrize("seed", SEEDS)
def test_skips_never_change_the_flat_pct(seed):
    rng = random.Random(seed)
    results = random_results(rng, allow_skips=False)
    extra = [res(rng.randint(1, 5), "skip", 0, cause="not_applicable") for _ in range(5)]
    assert probe.score(results + extra).flat_pct == pytest.approx(probe.score(results).flat_pct)


@pytest.mark.parametrize("seed", SEEDS)
def test_fixing_a_fail_never_lowers_either_score(seed):
    rng = random.Random(seed)
    results = random_results(rng)
    fails = [i for i, r in enumerate(results) if r.status == "fail"]
    if not fails:
        return
    i = rng.choice(fails)
    fixed = list(results)
    fixed[i] = res(results[i].level, "pass", origin=results[i].origin, cid=results[i].id)
    before, after = probe.score(results), probe.score(fixed)
    assert after.flat_pct >= before.flat_pct
    assert after.gated_level >= before.gated_level


@pytest.mark.parametrize("seed", SEEDS)
def test_gated_level_never_exceeds_flat_level_when_nothing_is_skipped(seed):
    results = random_results(random.Random(seed), allow_skips=False)
    s = probe.score(results)
    assert s.gated_level <= s.flat_level


@pytest.mark.parametrize("seed", SEEDS)
def test_checks_to_next_level_really_reaches_the_next_band(seed):
    rng = random.Random(seed)
    results = [r for r in random_results(rng) if r.origin == "core"]
    s = probe.score(results)
    if s.checks_to_next_level is None:
        return
    fails = [i for i, r in enumerate(results) if r.status == "fail"]
    if len(fails) < s.checks_to_next_level:
        return
    fixed = list(results)
    for i in fails[: s.checks_to_next_level]:
        fixed[i] = res(results[i].level, "pass", cid=results[i].id)
    assert probe.score(fixed).flat_level == s.flat_level + 1
    # And one fewer is not enough.
    if s.checks_to_next_level > 0:
        short = list(results)
        for i in fails[: s.checks_to_next_level - 1]:
            short[i] = res(results[i].level, "pass", cid=results[i].id)
        assert probe.score(short).flat_level == s.flat_level


def test_gate_gap_really_reaches_the_next_gated_level():
    rng = random.Random(7)
    for _ in range(100):
        results = random_results(rng)
        s = probe.score(results)
        if s.gate_gap is None:
            continue
        target = s.gated_level + 1
        fails = sorted(
            (i for i, r in enumerate(results) if r.status == "fail" and r.level <= target),
            key=lambda i: results[i].level,
        )
        assert len(fails) >= s.gate_gap
        fixed = list(results)
        for i in fails[: s.gate_gap]:
            fixed[i] = res(results[i].level, "pass", origin=results[i].origin, cid=results[i].id)
        assert probe.score(fixed).gated_level >= target
        assert not math.isnan(s.flat_pct)
