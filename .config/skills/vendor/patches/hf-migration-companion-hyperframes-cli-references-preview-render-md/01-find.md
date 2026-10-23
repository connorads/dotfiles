
```bash
npx hyperframes preview                   # foreground on a TTY; persistent in agent shells
npx hyperframes preview --background      # explicit persistent session
npx hyperframes preview --foreground --json # ready JSON, then remain attached
npx hyperframes preview --background --port 4567 # agent-safe custom port (default 3002)
npx hyperframes preview --selection --json # print the current Studio selection and exit
npx hyperframes preview --context --json  # print compact agent context from Studio
```
