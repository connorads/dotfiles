{{marker}}

Either way, the build runs under `uv`, which fetches the scripts' dependencies itself:

```bash
uv --version
```

If that fails, stop and say so rather than working around it. There is no `pip install`
step and no virtualenv to create.
