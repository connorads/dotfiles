# Python application

Recipe ID: `python-app`
Last verified: 2026-09-04 against uv 0.12.7.

## Scaffold

Choose the supported Python line first, then run:

```sh
uv init --app --python 3.13 --vcs none --author-from none --no-workspace <name>
```

The explicit flags prevent ambient Git, author and parent-workspace state from
changing the scaffold.

## House delta and proof

- Commit `pyproject.toml` and `uv.lock`.
- Apply Python enforcement and testing owners before wiring hk.
- Prove the application entry point, tests, lint and typecheck through uv.

Source: [uv project initialisation](https://docs.astral.sh/uv/concepts/projects/init/).
