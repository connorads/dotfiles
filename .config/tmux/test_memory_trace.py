import json
import subprocess

import memory_trace as trace
import pytest

PROCESSES = (
    "1 0 100 Thu Jan  1 00:00:00 2026 /sbin/launchd\n"
    "20 1 200 Thu Jan  1 01:00:00 2026 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n"
    "21 20 300 Thu Jan  1 01:01:00 2026 /tmp/worker\n"
    "30 1 400 Thu Jan  1 00:01:00 2026 /System/WindowServer\n"
)


def test_browser_descendants_and_graphics_have_start_identity_without_paths():
    rows = trace.processes(PROCESSES)
    assert {row["pid"] for row in trace.browser_tree(rows)} == {20, 21}
    assert rows[20]["started_at"] == "2026-01-01T01:00:00Z"
    assert rows[20]["executable"] == "Google Chrome"
    assert "/Applications/" not in json.dumps(rows)


def test_cycles_and_missing_parents_do_not_expand_to_unrelated_processes():
    rows = trace.processes(PROCESSES.replace("21 20", "21 21"))
    assert [row["pid"] for row in trace.browser_tree(rows)] == [20]


@pytest.mark.parametrize(("token", "value"), [("1.5G+", 1610612736), ("64M", 67108864), ("0B", 0)])
def test_footprints_are_bytes(token, value):
    assert trace.footprints(f"PID MEM\n30 {token}\n")[30] == value


def test_malformed_and_unavailable_footprints_are_not_zero():
    assert trace.footprints("PID MEM\n30 ???\n31 -1M\n") == {}


def test_probe_failure_is_local_and_retains_time_window():
    def run(*args):
        if args[0] == "/bin/ps":
            return PROCESSES
        if args[0] == "/usr/bin/top":
            raise subprocess.TimeoutExpired(args, 2)
        if args[0] == "/usr/sbin/sysctl":
            return "kern.boottime: { sec = 123, usec = 0 }\nhw.memsize: 17179869184\n"
        return "Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages wired down: 7.\n"

    record = trace.sample(run)
    assert record["schema_version"] == 2
    assert record["probes"]["footprints"]["status"] == "unavailable"
    assert record["probes"]["processes"]["status"] == "ok"
    assert record["probes"]["vm_stat"]["value"]["wired_bytes"] == 114688
    assert record["probes"]["footprints"]["duration_ms"] >= 0
    assert record["probes"]["footprints"]["finished_at"].endswith("Z")


def test_identity_recheck_refuses_reused_pid():
    before = trace.processes(PROCESSES)
    after = trace.processes(PROCESSES.replace("01:00:00", "02:00:00"))
    result = trace.process_readings(before, after, {20: 123, 21: 456, 30: 789})
    assert result[0]["footprint_bytes"] is None
    assert result[0]["footprint_status"] == "identity_changed"
    assert result[1]["footprint_bytes"] == 456


def test_private_history_rotates_and_keeps_old_directory_intact(tmp_path):
    old = tmp_path / "memory-trace"
    old.mkdir()
    (old / "samples.jsonl").write_text("old\n")
    directory = tmp_path / "memory-trace-v2"
    with trace.History(directory, segment_bytes=180, backups=2) as history:
        for n in range(12):
            history.append({"sequence": n, "padding": "x" * 40})
        with (
            pytest.raises(BlockingIOError, match="temporarily unavailable"),
            trace.History(directory),
        ):
            pass
    files = list(directory.glob("samples.jsonl*"))
    records = [json.loads(line) for path in files for line in path.read_text().splitlines()]
    assert max(row["sequence"] for row in records) == 11
    assert len(files) == 3
    assert all(path.stat().st_mode & 0o777 == 0o600 for path in files)
    assert directory.stat().st_mode & 0o777 == 0o700
    assert (old / "samples.jsonl").read_text() == "old\n"


def test_history_rejects_symlinks_and_oversized_records(tmp_path):
    directory = tmp_path / "history"
    directory.mkdir(mode=0o700)
    target = tmp_path / "other"
    target.write_text("untouched")
    (directory / "samples.jsonl").symlink_to(target)
    with pytest.raises(OSError, match="symlink"), trace.History(directory):
        pass
    assert target.read_text() == "untouched"
    with (
        trace.History(tmp_path / "bounded", segment_bytes=30) as history,
        pytest.raises(ValueError, match="byte budget"),
    ):
        history.append({"large": "x" * 100})


def test_history_restart_preserves_complete_lines_after_partial_tail(tmp_path):
    directory = tmp_path / "history"
    with trace.History(directory) as history:
        history.append({"sequence": 1})
    with (directory / "samples.jsonl").open("ab") as stream:
        stream.write(b'{"incomplete":')
    with trace.History(directory) as history:
        history.append({"sequence": 2})
    assert [
        json.loads(line)["sequence"]
        for line in (directory / "samples.jsonl").read_text().splitlines()
    ] == [1, 2]


def test_missing_sysctl_key_stays_unavailable():
    counters = trace.sysctl_reading("hw.memsize: 17179869184\n")
    assert counters["hw.memsize"] == 17179869184
    assert counters["vm.compressor.pages_compressed"] is None


def test_summary_reports_gaps_and_keeps_pid_reuse_separate(tmp_path):
    with trace.History(tmp_path) as history:
        history.append(
            {
                "schema_version": 2,
                "timestamp": "2026-01-01T00:00:00Z",
                "run_id": "a",
                "start_gap_seconds": None,
                "probes": {"vm_stat": {"status": "unavailable"}},
                "processes": [
                    {
                        "pid": 10,
                        "started_at": "2026-01-01T00:00:00Z",
                        "executable": "WindowServer",
                        "footprint_bytes": 100,
                    }
                ],
            }
        )
        history.append(
            {
                "schema_version": 2,
                "timestamp": "2026-01-01T00:01:00Z",
                "run_id": "a",
                "start_gap_seconds": 60,
                "probes": {},
                "processes": [
                    {
                        "pid": 10,
                        "started_at": "2026-01-01T00:00:50Z",
                        "executable": "WindowServer",
                        "footprint_bytes": 50,
                    }
                ],
            }
        )
    with (tmp_path / "samples.jsonl").open("a") as stream:
        stream.write('{"partial":')
    report = trace.summary(tmp_path)
    assert report["records"] == 2
    assert report["incomplete_or_invalid_lines"] == 1
    assert report["delayed_samples"] == 1
    assert report["unavailable_probes"] == 1
    assert len(report["processes"]) == 2
    assert report["processes"][0]["change_bytes"] == 0


def test_storage_failure_is_reported_instead_of_claiming_persistence(tmp_path, monkeypatch):
    def failed_sync(descriptor):
        raise OSError("synthetic disk failure")

    with trace.History(tmp_path) as history:
        monkeypatch.setattr(trace.os, "fsync", failed_sync)
        with pytest.raises(OSError, match="synthetic disk failure"):
            history.append({"sequence": 1})


def test_unreadable_identity_does_not_assign_footprint():
    rows = trace.processes(PROCESSES)
    readings = trace.process_readings(rows, {}, {20: 100})
    assert all(row["footprint_bytes"] is None for row in readings)
    assert all(row["footprint_status"] == "identity_changed" for row in readings)
