import memory_trace


def test_processes_keep_spaces_and_find_browser_ancestors():
    rows = memory_trace.processes(
        "1 0 100 /sbin/launchd\n"
        "20 1 200 /usr/local/bin/node\n"
        "30 20 300 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n"
        "31 30 400 /tmp/chrome-headless-shell\n"
        "40 1 500 /usr/bin/unrelated\n"
    )
    selected = memory_trace.browser_tree(rows)
    assert {row["pid"] for row in selected} == {1, 20, 30, 31}
    assert rows[30]["executable"].endswith("Google Chrome")
    assert rows[31]["rss_kib"] == 400


def test_missing_parent_and_cycle_are_bounded():
    rows = memory_trace.processes("30 31 300 /tmp/chromium\n31 30 100 /tmp/node\n")
    assert len(memory_trace.browser_tree(rows)) == 2
    assert (
        memory_trace.browser_tree(memory_trace.processes("30 999 300 /tmp/chromium"))[0]["pid"]
        == 30
    )


def test_footprints_preserve_units():
    assert memory_trace.footprints("PID COMMAND MEM\n30 Google Chrome 1234M\n1 launchd 12M\n") == {
        30: "1234M",
        1: "12M",
    }
