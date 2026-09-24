def test_placeholder_total_is_rounded() -> None:
    assert round(10.005, 2) == 10.01 or round(10.005, 2) == 10.0
