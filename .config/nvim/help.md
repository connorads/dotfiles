# neovim keybindings

Leader key: `Space`

## Safety

| Key | Action |
|-----|--------|
| `Esc` | normal mode / cancel |
| `u` | undo |
| `Ctrl+r` | redo |
| `:w` | save |
| `:q` | quit window (fails if unsaved) |
| `:q!` | quit without saving |
| `:wq` | save and quit |
| `:qa` | quit all windows |

## Core movement

| Key | Action |
|-----|--------|
| `h j k l` | left/down/up/right |
| `w / b / e` | next word / prev word / end word |
| `0 / ^ / $` | line start / first char / line end |
| `gg / G` | top / bottom of file |
| `%` | jump matching bracket |
| `Ctrl+u / Ctrl+d` | half-page up / down |

## Editing primitives

| Key | Action |
|-----|--------|
| `x` | delete char |
| `dd` | delete line |
| `yy` | yank line |
| `p / P` | paste after / before |
| `ciw` | change word |
| `di(` | delete inside `(...)` |
| `.` | repeat last change |
| `/text` + `n/N` | search and next/prev match |

## Buffers and windows

| Key | Action |
|-----|--------|
| `Shift+h / Shift+l` | prev / next buffer |
| `<leader>bd` | delete buffer |
| `<leader>bo` | delete other buffers |
| `<leader>-` | split below |
| `<leader>|` | split right |
| `<leader>wd` | delete split |
| `Ctrl+h/j/k/l` | move splits (works with tmux) |
| `Alt+h/j/k/l` | resize splits (works with tmux) |

## LazyVim essentials

| Key | Action |
|-----|--------|
| `<leader><space>` | find files (root) |
| `<leader>/` | grep (root) |
| `<leader>e` | file explorer |
| `<leader>sk` | show keymaps |
| `<leader>qq` | quit all |
| `:Tutor` | start built-in tutor |

## LSP basics

| Key | Action |
|-----|--------|
| `gd` | goto definition |
| `gr` | references |
| `gI` | goto implementation |
| `K` | hover docs |
| `<leader>ca` | code action |
| `<leader>cr` | rename symbol |
| `[d / ]d` | prev / next diagnostic |
| `<leader>cd` | line diagnostics |

## Your local docs

| Key | Action |
|-----|--------|
| `<leader>hh` | open this file |
| `<leader>hp` | open practice drills |
| `:NvimHelp` | open this file |
| `:NvimPractice` | open practice drills |
