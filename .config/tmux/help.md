# tmux keybindings

## Windows

| Key | Action |
|-----|--------|
| `Alt+Shift+H/L` | prev/next window |
| `Ctrl+b 1-9` | go to window N |
| `Ctrl+b Tab` | last window |
| `Ctrl+b c` | new window |
| `Ctrl+b ,` | rename window |
| `Ctrl+b &` | kill window |

## Panes

| Key | Action |
|-----|--------|
| `Ctrl+h/j/k/l` | navigate panes (works across nvim) |
| `Alt+h/j/k/l` | resize panes (works across nvim) |
| `Ctrl+b Ctrl+l` | clear screen |
| `Ctrl+b \|` | split vertical |
| `Ctrl+b -` | split horizontal |
| `Ctrl+b z` | zoom pane |
| `Ctrl+d` | close pane (exit shell) |
| `Ctrl+b L` | layout presets (fzf picker) |
| `Ctrl+b x` | kill pane |

## Popups

| Key | Action |
|-----|--------|
| `Ctrl+b S` | fzf session picker |
| `Ctrl+b W` | fzf window picker |
| `Ctrl+b f` | function/alias search |
| `Ctrl+b P` | port inspector (kill mode) |
| `Ctrl+b a` | AI usage (Claude + Codex) |
| `Ctrl+b b` | system monitor (bottom) |
| `Ctrl+b y` | yazi file manager |
| `Ctrl+b g` | lazygit (dotfiles if in ~) |
| `Ctrl+b G` | gh-dash (GitHub PRs/issues) |
| `Ctrl+b D` | difftastic git diff |
| `Ctrl+b v` | neovim |
| `Ctrl+b u` | fzf-url (open URL from pane) |
| `Ctrl+b Space` | thumbs (quick-copy URLs/paths/hashes) |
| `Ctrl+b e` | extrakto (fzf text from pane/scrollback) |

## Other

| Key | Action |
|-----|--------|
| `F10` | suspend/resume tmux client |
| `Ctrl+b d` | detach |
| `Ctrl+b [` | scroll/copy mode |
| `Ctrl+b r` | reload config |
| `Ctrl+b H` | toggle hostname |
| `Ctrl+b ?` | this help |
| `Ctrl+b /` | search help (fzf) |

Mouse: click, scroll, drag borders
