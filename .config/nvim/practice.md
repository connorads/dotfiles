# neovim practice drills

Goal: move from micro comfort to fast, low-friction Neovim editing.

## Session template (10-15 mins daily)

1. 2 mins warm-up: move only with `hjkl`, `w`, `b`, `e`, `0`, `$`, `gg`, `G`.
2. 6-10 mins drill of the day.
3. 2-3 mins real edit in an actual dotfile.
4. Finish with one note: what felt slow?

Rule: no arrow keys during drills.

## Week 1 - Core Vim muscle memory

### Day 1
- Open `~/.config/nvim/help.md`.
- Practise mode switching: `i`, `a`, `o`, `Esc`.
- Save/quit reps: `:w`, `:q`, `:wq`, `:q!`.

### Day 2
- Navigation reps on a real file: `w`, `b`, `e`, `0`, `^`, `$`, `gg`, `G`.
- Add search reps: `/set`, then `n` and `N`.

### Day 3
- Edit reps: `x`, `dd`, `yy`, `p`, `P`.
- Undo/redo ladder: make 10 edits, then `u` and `Ctrl+r` through all.

### Day 4
- Operators + objects: `ciw`, `diw`, `yiw`, `ci(`, `di(`, `da(`.
- Repeat with `.` until it feels automatic.

### Day 5
- Line shaping: `A`, `I`, `o`, `O`, `>>`, `<<`.
- Make one config block cleaner using only Normal mode edits.

### Day 6
- Search/replace basics: `:%s/old/new/gc` on a scratch file.
- Practise single-line substitute: `:s/old/new/g`.

### Day 7
- Mini review day: combine movement + operators.
- Do one real commit-sized edit fully in nvim.

## Week 2 - LazyVim productivity flow

### Day 8
- File flow: `<leader><space>`, `<leader>/`, `<leader>e`.
- Open 3 files and move between them quickly.

### Day 9
- Buffer flow: `Shift+h`, `Shift+l`, `<leader>bd`, `<leader>bo`.
- Keep one throwaway buffer and clear it.

### Day 10
- Split flow: `<leader>-`, `<leader>|`, `<leader>wd`.
- Move/resize with `Ctrl+h/j/k/l` and `Alt+h/j/k/l`.

### Day 11
- LSP navigation: `gd`, `gr`, `gI`, `K`.
- Practise on any Lua/Nix file with symbols.

### Day 12
- Refactor flow: `<leader>cr` (rename), `<leader>ca` (code action).
- Diagnostics: `[d`, `]d`, `<leader>cd`.

### Day 13
- Discovery day: `<leader>sk` then pick 3 keys you will keep.
- Add them to personal notes if useful.

### Day 14
- Full workflow run in nvim only:
  - find file
  - edit
  - split
  - navigate errors
  - save and exit

## Staged migration

- Stage 1 (now): use `v` for day-to-day edits.
- Stage 2: `EDITOR` and `VISUAL` set to `nvim`.
- Fallback: use `mic` to open micro when needed.

## Panic keys

- Stuck in insert mode: `Esc`
- Undo mess: `u`
- Redo over-undo: `Ctrl+r`
- Leave without saving: `:q!`
- Save everything and leave: `:wa` then `:qa`
