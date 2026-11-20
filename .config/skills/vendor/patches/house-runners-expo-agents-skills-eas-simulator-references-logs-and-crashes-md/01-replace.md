eas simulator:logs --id <session-id>                     # newest 100 lines from user apps
eas simulator:logs --id <session-id> --limit 500 --json  # more lines, as JSON
eas simulator:logs --id <session-id> --follow --scope all > ./all.txt &   # system logs too; --scope all needs --follow
