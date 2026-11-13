## Read the device log

`simulator:logs` reads the logs of the installed apps from the session's buffer. Run it from the Expo project directory. Pass `--id` with the session you are driving, because another agent can replace the dotenv session between your commands.

```bash
eas simulator:logs --id <session-id>                     # newest 100 lines from user apps
eas simulator:logs --id <session-id> --limit 500 --json  # more lines, as JSON
eas simulator:logs --id <session-id> --follow --scope all > ./all.txt &   # system logs too; --scope all needs --follow
```

For the first 30 minutes of a session, app logs are buffered without a reader. After that, new lines appear only while you follow. Either way, **start following before you reproduce the problem**, and save the stream to a file:

```bash
eas simulator:logs --id <session-id> --follow --timestamp > ./sim-logs.txt &
LOGS_PID=$!
# ... reproduce the problem with the controller ...
kill "$LOGS_PID"
```

After the session stops, `--follow` fails. Download the saved logs instead: `simulator:logs --id <session-id> --output ./app-logs.ndjson`. The `app-logs.ndjson` artifact holds only the app logs from the first 30 minutes of the session, up to 20 MiB. When the session had more than one device, non-interactive mode stops with a list of files; pass `--artifact <n>` (from 1) to pick one.

If `simulator:logs` fails on an older session, fall back to `agent-device logs` (see [controllers.md](./controllers.md)).
