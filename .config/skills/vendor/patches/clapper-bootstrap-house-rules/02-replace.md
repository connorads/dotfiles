{{marker}}

```sh
NPM_OK=1 node /absolute/path/to/installed/clapper/scripts/bootstrap.mjs /absolute/path/to/my-film --template basic
```

`npm` is blocked bare on this machine and `NPM_OK=1` is the documented escape, so it belongs on every invocation that reaches npm - the helper shells out to it. A second gate is `min-release-age=4` in `~/.npmrc`: the helper resolves `latest`, so a release published less than four days ago fails with `ETARGET ... no matching version found ... before <date>` instead of installing. That error is the gate, not a broken package. Clear it by naming the newest release at least four days old and driving `clapper new` or `clapper install` at that version directly; `--min-release-age=0` bypasses the gate and needs explicit approval first.
