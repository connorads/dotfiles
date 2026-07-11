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
| `Ctrl+b Alt+w` | new worktree (prompts for branch, `wt-add`; enter→window, `v`→pane here) |
| `Ctrl+b ,` | set manual window label (visible in tab; disables auto name) |
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
| `Ctrl+b z` | zoom pane |
| `Ctrl+d` | close pane (exit shell) |
| `Ctrl+b Space` | next layout |
| `Ctrl+b Backspace` | previous layout |
| `Ctrl+b E` | spread panes evenly |
| `Ctrl+b Alt+1` | even horizontal layout |
| `Ctrl+b Alt+2` | even vertical layout |
| `Ctrl+b Alt+3` | main horizontal layout |
| `Ctrl+b Alt+4` | main vertical layout |
| `Ctrl+b Alt+5` | tiled layout |
| `Ctrl+b L` | layout presets (fzf picker) |
| `Ctrl+b N` | prompt for total panes, then build two-row grid |
| `Ctrl+b Alt+r` | resize mode (`h/j/k/l`, `q`/Esc exits) |
| `Ctrl+b Ctrl+o` | rotate panes forward |
| `Ctrl+b Alt+o` | rotate panes backward |
| `Ctrl+b Ctrl+arrows` | resize pane by 1 |
| `Ctrl+b Alt+arrows` | resize pane by 5 |
| `Ctrl+b x` | kill pane |
| `Ctrl+b Y` | copy active pane's id·tty·cmd·cwd to clipboard (yank; for join-pane/scripts) |

## Floating panes

| Key | Action |
|-----|--------|
| `Ctrl+b \`` | scratch shell · centred float (70%) |
| `Ctrl+b ~` | scratch shell · small top-right float |
| `Ctrl+b *` | new float, stock geometry (reuses window's last float position/size) |

Floats are real panes: persistent, non-modal, mouse-drag to move/resize, kill
with `Ctrl+b x`. From any shell: `flt [preset] [command]` (presets: `c` centre,
`big`, `tl`/`tr`/`bl`/`br` corners), e.g. `flt tr btm`.

## Popups

| Key | Action |
|-----|--------|
| `Ctrl+b s` / `w` | session / window tree (tmux default choose-tree) |
| `Ctrl+b Alt+Shift+W` | worktree picker: repo + status markers (`open`/`dirty`/`merged`/`ahead N`/`behind N`) + git log/status preview; enter→focus/open window, ctrl-v→pane here, ctrl-x→remove (refused if pane open or dirty; merged branch deleted, unmerged kept) |
| `Ctrl+b A` | agents popup (fzf: jump to a coding-agent pane, ranked blocked>done>working>idle) |
| `Ctrl+b Alt+s` | skill loader (skl picker → enter injects pointer into this pane, ctrl-y copies to clipboard) |
| `Ctrl+b Alt+f` | function/alias search |
| `Ctrl+b T` | Tools launcher (fzf: tmux join-all/burst, Git review, claude-watch, connections, ports, pclose, bandwhich, tsp, tpm-clean) |
| `Ctrl+b a` | AI usage (Claude + Codex + Cosine) |
| `Ctrl+b i` | Claude Code plan (pane or latest) |
| `Ctrl+b Alt+b` | branch this pane's Claude/Codex session (fork into split/window or a new worktree window, bypass perms; copy cmd/id) |
| `Ctrl+b Alt+i` | paste clipboard image path into current pane + copy (no popup; result on status line) |
| `Ctrl+b Alt+Shift+I` | upload clipboard image to remote host, paste remote path into current pane + copy (local tmux only; use `shotpath` from Mac for remote tmux) |
| `Ctrl+b Alt+.` | agent dot menu (set this tab's state by hand: working/blocked/unread/idle/clear) |
| `Ctrl+b b` | system monitor (bottom) |
| `Ctrl+b Alt+m` | memory pressure (swap + top footprint offenders + agents; `k`→kill picker, `r`→refresh) |
| `Ctrl+b O` | open cwd in… (palette: Zed/VS Code/Finder) |
| `Ctrl+b g` | lazygit (dotfiles if in ~) |
| `Ctrl+b G` | lazygit dotfiles (lgdf, bare repo from any pane) |
| `Ctrl+b Alt+Shift+G` | GitHub access grant/revoke (gh-gate) |
| `Ctrl+b D` | hunk git diff / stage (hunk.dev) |
| `Ctrl+b C` | critique git diff |
| `Ctrl+b Alt+g` | GitHub triage (ghfzf: PRs, issues, Actions runs) |
| `Ctrl+b v` | neovim |
| `Ctrl+b V` | neovim help |
| `Ctrl+b f` | Fresh editor |
| `Ctrl+b F` | Fresh help |
| `Ctrl+b u` | fzf-links (open URLs/files/images from pane) |
| `Ctrl+b Alt+u` | fingers (quick-copy text with hints) |

## Agent tab dots

Each window tab shows a dot for the worst agent state across its panes (driven by
agent hooks → `agent-state.sh`). Shape encodes state too, so it reads without colour.

| Dot | State | Meaning |
|-----|-------|---------|
| `◆` red | blocked | needs you (permission/input) — also rings the bell |
| `◐` peach | working | agent mid-turn |
| `●` blue | done | finished, unseen |
| `○` green | idle | seen / at rest |
| `·` grey | unknown | present but unclassified |

Focusing a window marks `done → idle` (read). `Ctrl+b Alt+.` → **unread** re-flags
it `done` (blue) before you leave — like marking an email unread.

## Memory pressure (status bar)

Right-side gauge (macOS, width ≥ 80). Swap-used is shown — including when
healthy — so the resting baseline stays visible, *unless* kernel pressure is the
driver, where a `▲` replaces the figure (swap is fine, look elsewhere). Colour +
glyph encode state; bold escalates on BUSY/CRITICAL. `Ctrl+b Alt+m` drills down
(swap/RAM, top footprint apps, agents).

| Pill | State | Meaning |
|------|-------|---------|
| `⬡` green | OK | swap below threshold, kernel pressure normal |
| `⊟` amber (bold) | BUSY | swapping (≥5G) or kernel warn pressure |
| `⊠` red (bold) | CRITICAL | heavy swap (≥7G) or kernel critical pressure |

`▲` in the figure slot = kernel pressure is the cause (swap itself is below
threshold); a number = swap worth noting.

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
| `Ctrl+U Ctrl+Y` | copy current zsh command line to shell kill ring (cut whole line, yank back) |

## Other

| Key | Action |
|-----|--------|
| `Ctrl+b Ctrl+s` | save tmux session state |
| `Ctrl+b Ctrl+r` | restore saved tmux session state |
| `F10` | suspend/resume tmux client |
| `Ctrl+b d` | detach |
| `Ctrl+b [` | scroll/copy mode |
| `]` / `[` (in copy mode) | jump to next/previous shell prompt |
| `Ctrl+b r` | reload config |
| `Ctrl+b H` | toggle hostname |
| `Ctrl+b ?` | this help |
| `Ctrl+b /` | command palette (actual prefix bindings) |
| `Ctrl+b I` | install plugins (TPM) |
| `Ctrl+b U` | update plugins (TPM) |
| clean unused plugins (TPM) | now in the `Ctrl+b T` Tools launcher |

## Usage Tracking

Keybinding usage is logged to `~/.local/state/tmux/usage.jsonl`.

| Command | Action |
|---------|--------|
| `tmux-usage` | Show most-used bindings by period (1d/7d/30d/all) |

## Mouse

| Gesture | Action |
|---------|--------|
| left-click | select pane/window |
| scroll | enter copy mode / scroll |
| drag border | resize pane |
| double-click pane | zoom toggle |
| right-click pane | context menu (zoom, mark, copy info, open cwd, claude-watch, agent dot, kill pane) |
| right-click window tab | window menu (swap, manual label, reset to auto name, kill, agent dot; `~/.trees` windows add publish PR / finish / remove worktree) |
| right-click session name (status left) | session menu (pickers, layouts, memory, detach) |
| Alt+right-click | tmux's stock menus (Copy Word/Line, Search, hyperlinks, respawn…) |

When an app owns the mouse (nvim, `less --mouse`, …) a plain right-click passes
through to it; use Alt+right-click for tmux's stock menu there.
