# tmux keybindings

## Windows

| Key | Action |
|-----|--------|
| `Alt+Shift+H/L` | prev/next window |
| `Ctrl+b n/p` | next/prev window |
| `Ctrl+b 1-9` | go to window N |
| `Ctrl+Alt+h/l` | move window left/right |
| `Ctrl+b Tab` | last window |
| `Ctrl+b c` | new window |
| `Ctrl+b ,` | rename window |
| `Ctrl+b &` | kill window |

## Panes

| Key | Action |
|-----|--------|
| `Ctrl+h/j/k/l` | navigate panes (works across nvim, preserves zoom) |
| `Ctrl+b Ctrl+l` | clear screen |
| `Ctrl+b \|` | split vertical |
| `Ctrl+b -` | split horizontal |
| `Ctrl+b !` | break pane into new window |
| `Ctrl+b \` | join pane from picker (left/right) |
| `Ctrl+b _` | join pane from picker (top/bottom) |
| `Ctrl+b J` | join ALL windows into panes (tiled) |
| `Ctrl+b B` | burst ALL panes into own windows |
| `Ctrl+b z` | zoom pane |
| `Ctrl+d` | close pane (exit shell) |
| `Ctrl+b Space` | next layout |
| `Ctrl+b Backspace` | previous layout |
| `Ctrl+b E` | spread panes evenly |
| `Ctrl+b Alt+1` | even horizontal layout |
| `Ctrl+b Alt+2` | even vertical layout |
| `Ctrl+b Alt+5` | tiled layout |
| `Ctrl+b L` | layout presets (fzf picker) |
| `Ctrl+b N` | prompt for total panes, then build two-row grid |
| `Ctrl+b Alt+r` | resize mode (`h/j/k/l`, `q`/Esc exits) |
| `Ctrl+b Ctrl+o` | rotate panes forward |
| `Ctrl+b Alt+o` | rotate panes backward |
| `Ctrl+b Ctrl+arrows` | resize pane by 1 |
| `Ctrl+b Alt+arrows` | resize pane by 5 |
| `Ctrl+b x` | kill pane |

## Popups

| Key | Action |
|-----|--------|
| `Ctrl+b S` | fzf session picker |
| `Ctrl+b W` | fzf window picker |
| `Ctrl+b Alt+s` | skill loader (skl picker → enter injects pointer into this pane, ctrl-y copies to clipboard) |
| `Ctrl+b \`` | scratch shell (ephemeral popup) |
| `Ctrl+b f` | find window |
| `Ctrl+b Alt+f` | function/alias search |
| `Ctrl+b P` | port inspector (multi-select, TERM->KILL) |
| `Ctrl+b Alt+t` | Tailscale serve status (active routes) |
| `Ctrl+b T` | Tailscale serve manager (expose/down/funnel/prune) |
| `Ctrl+b Alt+T` | Tailscale serve down (quick teardown) |
| `Ctrl+b K` | process closer (user processes) |
| `Ctrl+b Alt+K` | process closer (all processes via sudo) |
| `Ctrl+b a` | AI usage (Claude + Codex) |
| `Ctrl+b i` | Claude Code plan (pane or latest) |
| `Ctrl+b Alt+i` | paste clipboard image path (uploads for detected ssh/mosh panes) |
| `Ctrl+b Alt+a` | Claude auto-continue (arm/disarm watcher) |
| `Ctrl+b b` | system monitor (bottom) |
| `Ctrl+b e` | network bandwidth monitor (bandwhich, sudo) |
| `Ctrl+b Alt+c` | connections overview |
| `Ctrl+b O` | open cwd in… (palette: Zed/VS Code/Finder) |
| `Ctrl+b y` | yazi file manager |
| `Ctrl+b g` | lazygit (dotfiles if in ~) |
| `Ctrl+b G` | gh-dash (GitHub PRs/issues) |
| `Ctrl+b Alt+Shift+G` | GitHub access grant/revoke (gh-gate) |
| `Ctrl+b D` | difftastic git diff |
| `Ctrl+b Alt+d` | hunk git diff |
| `Ctrl+b C` | critique git diff |
| `Ctrl+b R` | critique AI review (choose agent) |
| `Ctrl+b Alt+g` | review commits (fzf + critique) |
| `Ctrl+b v` | neovim |
| `Ctrl+b V` | neovim help |
| `Ctrl+b u` | fzf-links (open URLs/files/images from pane) |
| `Ctrl+b Ctrl+y` | thumbs (quick-copy text with hints) |

## Copy mode navigation

| Key | Action |
|-----|--------|
| `Ctrl+h/j/k/l` | navigate panes (also works in copy mode) |
| `Ctrl+b PageUp` | enter copy mode and scroll up one page |
| `Shift+↑/↓` | scroll up/down 5 lines |
| `Shift+PageUp/PageDown` | scroll up/down one page |
| `]` / `[` | jump to next/prev shell prompt (requires OSC 133 shell integration) |

## Shell navigation

| Key | Action |
|-----|--------|
| `Alt+Left/Right` | skip between words |

## Other

| Key | Action |
|-----|--------|
| `Ctrl+b F` | fix SSH agent socket |
| `Ctrl+b Ctrl+s` | save tmux session state |
| `Ctrl+b Ctrl+r` | restore saved tmux session state |
| `F10` | suspend/resume tmux client |
| `Ctrl+b d` | detach |
| `Ctrl+b [` | scroll/copy mode |
| `]` / `[` (in copy mode) | jump to next/previous shell prompt |
| `Ctrl+b r` | reload config |
| `Ctrl+b H` | toggle hostname |
| `Ctrl+b ?` | this help |
| `Ctrl+b /` | search help (fzf) |

## Usage Tracking

Keybinding usage is logged to `~/.local/state/tmux/usage.jsonl`.

| Command | Action |
|---------|--------|
| `tmux-usage` | Show most-used bindings by period (1d/7d/30d/all) |

Mouse: click, scroll, drag borders, double-click pane to zoom
