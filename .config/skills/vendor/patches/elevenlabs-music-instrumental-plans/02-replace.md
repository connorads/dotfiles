Common errors: 401 (invalid key), 422 (invalid params), 429 (rate limit or concurrency).

A 429 `concurrent_limit_exceeded` means too many requests in flight, not quota: the plan caps
parallel requests (2 on the plan checked 2026-09-25). Run music jobs at most two at a time.
