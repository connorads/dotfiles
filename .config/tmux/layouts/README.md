# tmux layout presets

These files are loaded by `Ctrl+b L` from `~/.config/tmux/layouts/*.conf`.

For ad-hoc grids, use `Ctrl+b N` to enter a total pane count (for example `8`), then build a balanced two-row grid.

## Naming and picker format

- Use one file per preset, for example `6x2.conf`.
- First line must be a comment in this format:
  - `# <name>: <description>`
- The picker reads this header and shows `<name>: <description>`.

## Safe layout pattern

For grid-like layouts:

1. Create columns first (`split-window -h`).
2. Normalise widths (`select-layout even-horizontal`).
3. Split each column vertically (`split-window -v -p 50`).
4. Return focus (`select-pane -t 1`).

## Common pitfall: pane index drift

Pane indexes are reassigned as you split. If you target panes in ascending order (`-t 1`, `-t 2`, ...), later splits can hit the wrong pane and create a stacked mess.

Use descending targets instead (`-t N` down to `-t 1`).

Example for `6x2`:

```tmux
split-window -d -v -t 6 -p 50 -c "#{pane_current_path}"
split-window -d -v -t 5 -p 50 -c "#{pane_current_path}"
split-window -d -v -t 4 -p 50 -c "#{pane_current_path}"
split-window -d -v -t 3 -p 50 -c "#{pane_current_path}"
split-window -d -v -t 2 -p 50 -c "#{pane_current_path}"
split-window -d -v -t 1 -p 50 -c "#{pane_current_path}"
```

## Quick verification

After sourcing a layout, check pane geometry:

```bash
tmux list-panes -F '#{pane_index} #{pane_width}x#{pane_height} #{pane_top},#{pane_left}'
```

If multiple panes share the same `pane_left` and tiny heights, the layout likely split the same column repeatedly.

## Practical limits

- `8x2` (16 panes) is dense; works best on very wide screens.
- If tmux reports `no space for new pane`, reduce columns or increase window width/height.
