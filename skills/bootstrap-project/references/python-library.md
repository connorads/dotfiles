# Python library

Recipe ID: `python-library`
Last verified: 2026-09-04 against uv 0.12.7.

## Scaffold

Choose the supported Python line first, then run:

```sh
uv init --lib --python 3.13 --vcs none --author-from none --no-workspace <name>
```

The explicit flags prevent ambient Git, author and parent-workspace state from
changing the scaffold.

## House delta and proof

- Keep the generated `src/` package layout and commit `uv.lock` for reproducible
  development and CI.
- Apply Python enforcement and testing owners before wiring hk.
- Prove import, tests, lint, typecheck and package build through uv.

Source: [uv project initialisation](https://docs.astral.sh/uv/concepts/projects/init/).
