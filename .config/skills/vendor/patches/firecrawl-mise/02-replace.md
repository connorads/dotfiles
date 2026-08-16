1. Confirm mise has it: `mise ls npm:firecrawl-cli` and `mise which firecrawl`
2. If missing, reinstall from the lockfile: `mise install npm:firecrawl-cli`
3. Ensure the mise shims are on PATH (`eval "$(mise activate zsh)"` in the shell profile)