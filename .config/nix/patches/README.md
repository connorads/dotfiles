# tmux patches

Local patches applied to `pkgs.tmux` via the overlay in [`../flake.nix`](../flake.nix).

Purpose: dim inactive pane *content* (lazygit, nvim syntax, any ANSI-coloured
output) — beyond what vanilla `window-style` covers, which only retints cells
using terminal *default* fg/bg. See the overlay comment in `flake.nix` for the
full rationale.

## Patches

| File | Required | What it does |
| ---- | -------- | ------------ |
| `dim-inactive-panes.patch` | yes | Adds `colour_dim()` (Rec. 601 luma desat 30% + blend 35% toward target bg), hooks `tty_attributes` to apply it to every cell in inactive panes. Touches `colour.c`, `screen-redraw.c`, `screen-write.c`, `tmux.h`, `tty.c`. |
| `force-redraw-on-focus-change.patch` | **yes** | Marks both incoming and outgoing panes `PANE_REDRAW` in `window_redraw_active_switch`. Without it the dim/undim transition stalls until the next keypress in the affected pane — i.e. it looks broken. Tiny patch, easy to drop accidentally; do not. |

Skipped: `theme-palette.patch` (from the same source). Injects an ANSI 0-15
palette via a Nix-generated header. Pointless here because `tmux.conf` specifies
RGB hexes directly everywhere.

## Provenance

Pulled from [`higorhgon/arch-script`](https://github.com/higorhgon/arch-script/tree/main/tmux)
on 2026-05-27, originally targeting tmux 3.6_a. Algorithm matches the
"synchronised inactive pane dimming" pattern (Rec. 601 weights, 30%/35%
blends) — likely shared lineage with other forks of the same idea.

## Bump procedure

When nixpkgs bumps tmux past 3.6a and the patch hunks rot:

1. Build will fail at `applying patch ...` — the error names the file and
   hunk that didn't apply.
2. Most likely the surrounding context in `tty_attributes` or
   `screen_redraw_draw_pane` shifted; re-anchor by hand. The actual inserts
   are small (~20-30 lines each).
3. Rebuild patched tmux only:
   ```sh
   nix build --no-link --print-out-paths \
     ~/.config/nix#darwinConfigurations.Connors-MacBook-Air.pkgs.tmux
   ```
   (Note: that derivation path goes through nix-darwin's own pkgs import,
   which doesn't include this overlay — to actually test the *patched*
   tmux, use `darwin-rebuild build --flake ~/.config/nix` and inspect
   `result/sw/bin/tmux`'s store path, or compare `nm | grep _colour_dim`.)
4. Verify:
   ```sh
   nm /nix/store/<hash>-tmux-<ver>/bin/tmux | grep _colour_dim
   # → 000000010002290c T _colour_dim
   ```
5. Bounce the server (`tmux kill-server`) so the new binary is in use.

## Tuning

The two blend ratios live in `dim-inactive-panes.patch` in the `colour_dim`
function:

- Step 1 (desaturate toward perceptual luma): `70/30` split — increase the
  `30` for stronger desaturation.
- Step 2 (blend toward target bg): `65/35` split — increase the `35` to dim
  harder, decrease for subtler.

Edit, `drs`, `tmux kill-server`. There's no runtime knob.
