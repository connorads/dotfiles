Feynman runs on [Bun](https://bun.sh) (1.3 or later). In the repository to model:

```sh
bun add -d @leostera/feynman   # the DSL's types for your editor, and the CLI
bunx feynman list              # finds specs/*.ts
```

Without installing anything, `bunx @leostera/feynman check` works too: the CLI resolves
`@leostera/feynman` in specs to itself. Specs import `@leostera/feynman` (the DSL) and
playground files `@leostera/feynman/play`; a `tsconfig.json` for the editor needs
`"moduleResolution": "bundler"` and `"allowImportingTsExtensions": true`, as Bun's default
does. This file is at https://feynman.leostera.dev/SKILL.md.

