# Mechanical Enforcement - Nix

Per-stack rules for Nix: formatting, dead code, anti-patterns, and where
evaluation beats linting. Routed from the picks table and rules-catalogue index
in `SKILL.md`.

- [Tool picks](#tool-picks)
- [Evaluation is the correctness gate](#evaluation-is-the-correctness-gate)
- [Dead code (deadnix)](#dead-code-deadnix)
- [Anti-patterns (statix)](#anti-patterns-statix)
- [Hook wiring](#hook-wiring)

## Tool picks

| Concern | Tool | Notes |
|---|---|---|
| Formatting | `nixfmt` | The RFC-166 official formatter. One choice, no config. |
| Dead code | `deadnix` | Unused `let` bindings, lambda arguments and `@`-patterns. Nothing else finds these. |
| Anti-patterns | `statix` | Empty `{ ... }:` patterns, `x = pkgs.x` that should be `inherit (pkgs) x`, manual list concatenation. |
| Diagnostics / LSP | `nil` or `nixd` | Editor use. As a gate they are a strict subset of deadnix on a config-shaped tree, so they add nothing a hook needs. |

None of the three is in the mise registry. Install them from nixpkgs - which any
repo that has Nix files already has.

## Evaluation is the correctness gate

A linter cannot tell you that a config still evaluates. `nix eval` on every
target's `.drvPath` can, it is platform-independent (a Linux `homeConfiguration`
evaluates fine from macOS), and it catches the whole class of "authored on one
host, broken on another".

Derive the target list from the flake's own `checks` attribute rather than
hardcoding it, so adding a host cannot silently escape the gate:

```sh
nix eval --json .#checks --apply \
  'cs: builtins.mapAttrs (_: sys: builtins.mapAttrs (_: drv: drv.drvPath) sys) cs' >/dev/null
```

Budget for it: ~25-45s warm across half a dozen configurations, so glob the step
to `**/*.nix` plus `flake.lock` and nothing else. A punctuation fix in a README
under the same directory should not buy a six-configuration evaluation.

The linters earn their place by catching what evaluation cannot: dead code
evaluates perfectly.

## Dead code (deadnix)

```sh
deadnix --fail <files>   # gate
deadnix --edit <files>   # fix
```

**`--edit` renames rather than deletes.** An unused lambda argument becomes
`_`-prefixed (`old` to `_old`, `final` to `_final`), which is Nix's own spelling
for "declared and deliberately unused" - so the function's signature is
unchanged and nothing downstream breaks. An unused `inputs@` pattern binding is
removed outright, since the attribute set it prefixes stays. Both are safe to
apply mechanically, but re-run evaluation afterwards rather than trusting the
diff.

Deprecated-attribute warnings (`stdenv.isLinux` for
`stdenv.hostPlatform.isLinux`) come out of *evaluation*, not deadnix, and only
on stderr - so they are visible during the eval gate and enforced by nothing.
Grep for them if they matter:

```sh
grep -rn 'stdenv\.is\(Linux\|Darwin\|Aarch64\|x86_64\)' --include='*.nix' . | grep -v hostPlatform
```

## Anti-patterns (statix)

```sh
statix check --config <dir-or-file> <one-target>
statix fix   --config <dir-or-file> <one-target>
statix list                                        # available lints
```

Three CLI facts that decide how you wire it:

- **One target, not a file list.** `statix check a.nix b.nix` fails with
  "unexpected argument". Loop over `{{files}}` in a wrapper, or point it at a
  directory, which decouples the step's glob from what actually gets scanned.
- **It respects `.gitignore`.** A repo whose root `.gitignore` denies `/*` and
  then un-ignores specific paths - the dotfiles pattern - yields *nothing* from
  a repo-root scan. Target the directory that holds the Nix files.
- **No `--version` flag.** It exits 2 on one. Probe availability with
  `statix list` if the wrapper checks the tool actually runs.

### Disable `repeated_keys`

`repeated_keys` wants every dotted path sharing a first segment collapsed into
one nested attribute set:

```nix
# what statix wants
system = {
  defaults.CustomUserPreferences."com.apple.screensaver" = { ... };
  activationScripts.postActivation.text = ...;
};
```

Flat dotted attributes are how nix-darwin and home-manager options are written
and documented, and the collapsed form buries the option name the manual names.
On one real config it was 16 of 19 findings, none of them a defect. Turn it off
and keep the other lints:

```toml
# statix.toml
disabled = ["repeated_keys"]
```

Pass it with `--config` rather than dropping `statix.toml` at the repo root, so
it stays a gate config instead of the default statix picks up in any cwd.

## Hook wiring

```pkl
["nixfmt"] = (Builtins.nix_fmt) { batch = true }

["deadnix"] = (Builtins.deadnix) {}

["statix"] {
    glob = List("**/*.nix")
    check = "bash .hk-hooks/statix.sh check {{files}}"
    fix = "bash .hk-hooks/statix.sh fix {{files}}"
}

["nix-eval"] {
    glob = List(".config/nix/**/*.nix", ".config/nix/flake.lock")
    check = "bash .hk-hooks/nix-eval.sh"
}
```

`Builtins.deadnix` exists at hk 1.51.0; `statix` does not, hence the custom
step. Check the tag's `pkl/builtins/` before assuming either way.

Order matters only for `fix`: run `statix fix` and `deadnix --edit` before
`nixfmt`, since both rewrite expressions the formatter then re-lays-out.
