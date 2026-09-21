{{marker}}

Send feedback only when the user explicitly asks for that report. If telemetry is disabled or the user opted out, do not send it. Search results, a completed render and tool warnings are not requests to send feedback. Catalog search itself does not send the query. `HYPERFRAMES_NO_TELEMETRY` does not govern explicit feedback commands.

After the user requests a catalog-gap report, describe the effect needed and the tier that answered:

```bash
pnpm exec hyperframes feedback --search-miss "<the query you ran>" --wanted "<the move you needed>" --tier <the tier that answered>
```

The `report_gap` field is a command suggestion, not consent.
