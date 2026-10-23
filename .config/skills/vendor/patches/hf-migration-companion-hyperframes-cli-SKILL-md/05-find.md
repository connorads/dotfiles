A 30 s film renders in a minute or two: run it in the foreground. Detach only a render longer than your tool's timeout (`HYPERFRAMES_RENDER_DETACHED=1`, its own group, output to a log) and wait with `until grep -qE 'Render (complete|failed)' render.log; do sleep 5; done`, never `pgrep -f`, which matches its own loop and waits until the tool times out.

After a verified render, send one `feedback --rating`, plus a report for anything the person asked for that HyperFrames can't do, unless telemetry is off: `references/feedback.md`.

## When a command fails
