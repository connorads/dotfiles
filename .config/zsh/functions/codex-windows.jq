# codex-windows.jq: pure classifier for Codex rate-limit windows.
# Reads a raw Codex usage JSON object (or an `additional_rate_limits[].rate_limit`
# object for Spark extras) and emits a duration-sorted array of the windows that
# exist, each classified by its REAL `limit_window_seconds` - never by JSON slot.
#
# Why: OpenAI classifies windows positionally nowhere. The API sends the true
# window length in `limit_window_seconds`, and that field is the only evidence of
# a window's length. When the 5h window was temporarily removed (2026-07-12) the
# weekly figure moved into `primary_window`, so any code assuming primary=5h
# mislabels it. Classifying by duration adapts to the 5h window vanishing now and
# returning later, in whichever slot.
#
# A window whose `limit_window_seconds` is absent reports `seconds: 0`, meaning
# unknown. Defaulting to the slot's usual length would reproduce the very bug
# this file exists to prevent, one layer down: a weekly figure arriving in
# `primary_window` without the field would come back classified as 5h. No
# surface may name a window a duration the payload does not support.
#
# Output: [{seconds, used_percent, reset_after_seconds, reset_at}], shortest
# window first (unknown sorts first). One element when only weekly exists; empty
# when none. `reset_at` is the API's own absolute epoch for the reset, so a
# consumer can name the instant without deriving it from the cache file's mtime.
# `seconds` and both reset fields default to 0, never null: `codex-usage` renders
# this array through @tsv, where a null becomes an empty field and shifts every
# later column. 0 is not a valid window length, so it cannot be mistaken for one.
[ (.rate_limit.primary_window   | select(type=="object")),
  (.rate_limit.secondary_window | select(type=="object")) ]
| map(select(.used_percent != null))
| map({ seconds: (.limit_window_seconds // 0),
        used_percent,
        reset_after_seconds: (.reset_after_seconds // 0),
        reset_at: (.reset_at // 0) })
| sort_by(.seconds)
