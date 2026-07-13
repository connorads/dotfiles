# codex-windows.jq: pure classifier for Codex rate-limit windows.
# Reads a raw Codex usage JSON object (or an `additional_rate_limits[].rate_limit`
# object for Spark extras) and emits a duration-sorted array of the windows that
# exist, each classified by its REAL `limit_window_seconds` - never by JSON slot.
#
# Why: OpenAI classifies windows positionally nowhere. The API sends the true
# window length in `limit_window_seconds`; the `primary`/`secondary` slot is only
# a fallback for older schema / test fixtures that omit it. When the 5h window was
# temporarily removed (2026-07-12) the weekly figure moved into `primary_window`,
# so any code assuming primary=5h mislabels it. Classifying by duration adapts to
# the 5h window vanishing now and returning later, in whichever slot.
#
# Output: [{seconds, used_percent, reset_after_seconds}], shortest window first.
# One element when only weekly exists; empty when none.
[ (.rate_limit.primary_window   | select(type=="object") | . + {default_seconds: 18000}),
  (.rate_limit.secondary_window | select(type=="object") | . + {default_seconds: 604800}) ]
| map(select(.used_percent != null))
| map({ seconds: (.limit_window_seconds // .default_seconds),
        used_percent,
        reset_after_seconds: (.reset_after_seconds // 0) })
| sort_by(.seconds)
