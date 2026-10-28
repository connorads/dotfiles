{{marker}}

Feynman requires Bun 1.3 or later. Check `bun --version` before using it.
Use the repository's package manager to add `@leostera/feynman` as a development
dependency. Use Bun for package management only where the repository already does.
Run the installed CLI through the repository's package runner, such as
`pnpm exec feynman list` or `bun run feynman list`. Do not download a CLI at task time.

Specs import `@leostera/feynman` (the DSL) and playground files
`@leostera/feynman/play`. The editor's `tsconfig.json` needs
`"moduleResolution": "bundler"` and `"allowImportingTsExtensions": true`.
The upstream skill is at https://feynman.leostera.dev/SKILL.md.
