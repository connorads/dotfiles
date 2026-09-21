own empty result as evidence the catalog lacks the move. Send feedback only when the user explicitly asks for that report. If telemetry is disabled or the user opted out, do not send it. Search results, a completed render and tool warnings are not requests to send feedback.
After that request, use `pnpm exec hyperframes feedback --search-miss "<query>" --wanted "<the move>" --tier <tier from the envelope>`.
Full flags and tiers: `/hyperframes-registry` → § Discovery.{{marker}}
