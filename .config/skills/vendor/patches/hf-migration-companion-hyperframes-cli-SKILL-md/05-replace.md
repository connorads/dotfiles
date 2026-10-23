A 30 s film renders in a minute or two: run it in the foreground. Detach only a render longer than your tool's timeout (`HYPERFRAMES_RENDER_DETACHED=1`, its own group, output to a log) and wait with `until grep -qE 'Render (complete|failed)' render.log; do sleep 5; done`, never `pgrep -f`, which matches its own loop and waits until the tool times out.

Send feedback only when the user explicitly asks for that report. If telemetry is disabled or the user opted out, do not send it. Search results, a completed render and tool warnings are not requests to send feedback. Read `references/feedback.md` only after that request.

## When a command fails
