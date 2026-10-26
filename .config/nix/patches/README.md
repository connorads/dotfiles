# tmux patches

Local patches applied to `pkgs.tmux` via the overlay in [`../flake.nix`](../flake.nix).

Purpose: dim inactive pane *content* (lazygit, nvim syntax, any ANSI-coloured
output) - beyond what vanilla `window-style` covers, which only retints cells
using terminal *default* fg/bg. See the overlay comment in `flake.nix` for the
full rationale.

**Config-side half (required):** the patch leaves terminal-*default*-fg cells
(`fg=8`, e.g. Claude Code's white text) unchanged. `window-style` /
`window-active-style` in `~/.config/tmux/tmux.conf` (set to the terminal theme's
fg/bg) resolve those to a concrete RGB so the patch dims them too. Without it,
default-fg text never dims. Keep both halves in sync.

## Patches

| File | Required | What it does |
| ---- | -------- | ------------ |
| `dim-inactive-panes.patch` | yes | Adds `colour_dim_inactive()` (Rec. 601 luma desat 30% + blend 35% toward target bg), hooks `tty_attributes` to apply it to every cell in inactive panes. Touches `colour.c`, `screen-redraw.c`, `screen-write.c`, `tmux.h`, `tty.c`. |
| `force-redraw-on-focus-change.patch` | **yes** | Marks both incoming and outgoing panes `PANE_REDRAW` in `window_redraw_active_switch`. Without it the dim/undim transition stalls until the next keypress in the affected pane - i.e. it looks broken. Tiny patch, easy to drop accidentally; do not. |
| `split-status-top-bottom.patch` | optional/local | Private split-status experiment gated by `@connorads-split-status on`: only for `status 2`, maps `status-format[0]` to terminal top and `status-format[1]` to terminal bottom. Keeps upstream behaviour when the option is unset. |

Skipped: `theme-palette.patch` (from the same source). Injects an ANSI 0-15
palette via a Nix-generated header. Pointless here because `tmux.conf` specifies
RGB hexes directly everywhere.

## Provenance

Pulled from [`higorhgon/arch-script`](https://github.com/higorhgon/arch-script/tree/main/tmux)
on 2026-05-27, originally targeting tmux 3.6_a. Algorithm matches the
"synchronised inactive pane dimming" pattern (Rec. 601 weights, 30%/35%
blends) - likely shared lineage with other forks of the same idea.

## Bump procedure

1. Copy the new tmux source to a fresh writable temporary directory.
2. Rebase each patch in overlay order. Require `patch --fuzz=0 -p1` to apply
   every hunk without offsets or rejects on another pristine copy.
3. Build only the overlay's tmux from the existing flake:

   ```sh
   nix build --impure --no-link --print-out-paths --expr '
     let f = builtins.getFlake (builtins.getEnv "HOME" + "/.config/nix");
     in builtins.head (builtins.filter (p: (p.pname or "") == "tmux")
       f.darwinConfigurations.Connors-MacBook-Air.config.home-manager.users.connorads.home.packages)
   '
   ```

   The `pkgs.tmux` and `programs.tmux.package` attributes bypass this overlay.
   Select tmux from `home.packages` to build the customised package.
4. Run both Bats suites below with the built package's `bin` first on `PATH`.
   Check `colour_dim_inactive` and `status_split_top_bottom` in the binary.
5. Run any further checks on a unique explicit `-L` socket. Clean only that
   socket. Server replacement is a separate activation step.

## tmux 3.8 render integration

These patches target tmux 3.8.

The local dimmer is `colour_dim_inactive(int, int)`. Upstream's separate
`colour_dim(int, u_int)` implements percentage dimming. The local algorithm
retains the same integer arithmetic and fallback background.
Inactive cells compare against `last_cell` after colour fixups and dimming,
matching the cached output. Active cells retain the early cache check.

Full redraws set and clear inactive dimming around `redraw_draw_pane_span`.
Scene coordinates exclude status rows. Drawing spans adds `status_top_lines`,
and status output maps each logical row through `status_line_y`.
The prompt cursor uses `status_prompt_screen_line`. Display-panes uses the
scene renderer and requires no separate command-file offset patch.

## Tuning

The two blend ratios live in `dim-inactive-panes.patch` in the `colour_dim_inactive`
function:

- Step 1 (desaturate toward perceptual luma): `70/30` split - increase the
  `30` for stronger desaturation.
- Step 2 (blend toward target bg): `65/35` split - increase the `35` to dim
  harder, decrease for subtler.

Rebuild and verify on a private socket. There is no runtime knob.

## Automated smoke coverage

Two BATS files guard this render path (run via `mise run zsh-tests`):

- [`tmux-patch-symbols.bats`](../../zsh/tests/tmux-patch-symbols.bats) - fast
  guard that the installed binary carries `_colour_dim_inactive` and
  `_status_split_top_bottom` (catches a rebuild silently dropping a patch).
- [`tmux-render-smoke.bats`](../../zsh/tests/tmux-render-smoke.bats) - drives
  the REAL config + patches through the shared Python PTY driver, including
  consecutive colours that collide with a preceding dimmed cache entry: floats (create,
  full-size, copy-mode, churn under heavy output), focus dim transitions,
  copy-mode scrolling, display-panes, popups, splits/resizes, window resize,
  message/prompt rows, `pane-scrollbars on`/`modal`, plus a pyte-composited
  screen check (status rows, borders, float on top).

The interactive checklist below remains the sign-off for what the harness
cannot drive: mouse input (float move/resize, scrollbar thumb drags, mouse
window switching).

## Split-status patch

`split-status-top-bottom.patch` is intentionally local, not upstream-shaped.
It preserves tmux's normal single status block unless the session option
`@connorads-split-status` is one of `on`, `1`, `yes`, or `top-bottom`, and the
session has exactly `status 2`.

When active:

- logical status row 0 (`status-format[0]`) renders at terminal row 0
- logical status row 1 (`status-format[1]`) renders at the last terminal row
- pane content is offset by one top row and still reserves one bottom row
- `message-line 0` means top, `message-line 1` means bottom

Smoke-test after changing or rebasing it: run the automated gauntlet first
(`bats ~/.config/zsh/tests/tmux-render-smoke.bats` covers the non-mouse checks
below), then eyeball the mouse-only behaviours interactively:

```sh
tmux -L split-test -f ~/.config/tmux/tmux.conf new-session
```

Check: top window row, bottom stats row, pane output does not overwrite either
row, `prefix :` prompt appears on the bottom row, mouse window switching works,
panes resize, popups/display-panes/copy-mode render sensibly, and inactive pane
dimming still changes on focus switch.

Rollback: unset `@connorads-split-status` for config-only fallback. Removing
the compiled patch requires a rebuild and separately authorised server replacement.
