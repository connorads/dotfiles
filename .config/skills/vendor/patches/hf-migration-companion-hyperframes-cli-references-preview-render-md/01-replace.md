
```bash
hyperframes preview                   # foreground on a TTY; persistent in agent shells
hyperframes preview --background      # explicit persistent session
hyperframes preview --foreground --json # ready JSON, then remain attached
hyperframes preview --background --port 4567 # agent-safe custom port (default 3002)
hyperframes preview --selection --json # print the current Studio selection and exit
hyperframes preview --context --json  # print compact agent context from Studio
```
