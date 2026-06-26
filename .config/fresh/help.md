# Fresh keybindings

Fresh is modeless: most shortcuts are VS Code/Sublime-style rather than Vim-style.

## Core

| Key | Action |
|-----|--------|
| `Ctrl+P` | command palette / fuzzy finder |
| `Ctrl+S` | save |
| `Ctrl+O` | open file |
| `Ctrl+Q` | quit |
| `Ctrl+F` | find in file |
| `Ctrl+G` | find next |
| `Ctrl+Z` / `Ctrl+R` | undo / redo |
| `Ctrl+D` | add cursor to next match |

## Navigation / IDE

| Key | Action |
|-----|--------|
| `Alt+Left/Right` | word left/right |
| `Ctrl+.` | go to definition |
| `Ctrl+,` | references |
| `Ctrl+Alt+R` | rename symbol |
| `Alt+[` / `Alt+]` | previous/next Fresh split |
| `Ctrl+E` | toggle file explorer focus |

## tmux

| Key | Action |
|-----|--------|
| `Ctrl+b Alt+v` | Fresh popup in pane cwd |
| `Ctrl+b Alt+V` | this help |
| `Ctrl+h/j/k/l` | tmux pane navigation owns these keys |
| `Ctrl+b h/j/k/l` | select a tmux pane from Fresh |

## Config

| Path | Purpose |
|------|---------|
| `~/.config/fresh/config.json` | user config |
| `~/.config/fresh/themes/catppuccin-mocha.json` | local Catppuccin Mocha theme |
| `~/.config/fresh/init.ts` | optional startup script |

Useful commands:

```bash
fresh --cmd config show
fresh --cmd config paths
fresh --safe
```
