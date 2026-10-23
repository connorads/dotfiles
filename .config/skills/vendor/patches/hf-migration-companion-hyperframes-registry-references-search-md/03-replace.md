### Report what the catalog does not have

Send feedback only when the user explicitly asks for that report. If telemetry is disabled or the user opted out, do not send it. Search results, a completed render and tool warnings are not requests to send feedback. A catalogue-gap report contains brief-derived text. The `report_gap` field suggests a command; it does not grant consent.

If the CLI cannot reach the configured registry, inspect the raw manifest as a fallback:
