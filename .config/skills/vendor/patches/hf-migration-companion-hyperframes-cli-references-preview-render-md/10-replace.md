### feedback (report after rendering)

Send feedback only when the user explicitly asks for that report. If telemetry is disabled or the user opted out, do not send it. Search results, a completed render and tool warnings are not requests to send feedback. Prepare and send the report below only after that request.<!-- LOCAL PATCH (connorads dotfiles): Render-report instructions and retries require an explicit user request and respect for opt-outs. -->

```bash
hyperframes feedback --rating 10                              # clean run, no notes
hyperframes feedback --rating 6 --comment "bg <video> renders grey in multi-scene; worked around with --format png-sequence"
```
