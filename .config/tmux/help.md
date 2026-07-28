# tmux keybindings

## Sessions

| Key | Action |
|-----|--------|
| `Ctrl+Alt+h/l` | previous/next session in the session rail's stable order |
| `Alt+Shift+s` | session switch/create popup |
| `Ctrl+b (` / `)` | previous/next session in the session rail's stable order |
| `Ctrl+b s` | session tree |

## Windows

| Key | Action |
|-----|--------|
| `Alt+Shift+H/L` | prev/next window |
| `Ctrl+b n/p` | next/prev window |
| `Ctrl+b 1-9` | go to window N |
| `Alt+Shift+m`, then `h/l` | enter persistent window move mode; `q`/Esc exits |
| `Ctrl+b Tab` | last window |
| `Ctrl+b c` | new window |
| `Ctrl+b W` | window organiser (move/share/remove linked windows; same menu as right-click tab and Remobi Organise) |
| `Ctrl+b Alt+w` | new worktree (prompts for branch, then `wt-add` runs in a float; enter→window, `v`→pane in the window you came from) |
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
| pane header `[⋯]` | pane organiser (break to session, join marked pane here, pane actions) |
| pane header `[zoom]` | zoom pane |
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
| `Ctrl+b g` | lazygit (dotfiles if in ~) |
| `Ctrl+b G` | lazygit dotfiles (bare repo; pinned git-dir, so the cwd is irrelevant) |
| `Ctrl+b Alt+j` | jjui (jj TUI) |
| `Ctrl+b D` | hunk git diff / stage (hunk.dev) |
| `Ctrl+b C` | critique git diff (no changes → status-line message, no float) |
| `Ctrl+b v` | neovim |
| `Ctrl+b V` | neovim help |
| `Ctrl+b f` | Fresh editor |
| `Ctrl+b F` | Fresh help |
| `Ctrl+b b` | system monitor (bottom) |
| `Ctrl+b Alt+m` | memory triage (top 5 sampled footprint offenders + 3 agents; `k`→app→process→TERM, `a`/`g`→scrollable apps/agents, `r`→refresh) |
| `Ctrl+b Alt+g` → `d` / `u` | gh-dash dashboard · ghui cockpit |

Floats are real panes: persistent, non-modal, mouse-drag to move/resize, kill
with `Ctrl+b x`. Switch windows and come back and the float is still there —
which is why the long-lived tools live here and only transactions stay popups.
From any shell: `flt [preset] [command]` (presets: `c` centre, `big`,
`tl`/`tr`/`bl`/`br` corners), e.g. `flt tr btm`.

## Popups

| Key | Action |
|-----|--------|
| `Ctrl+b s` / `w` | session / window tree (tmux default choose-tree) |
| `Ctrl+b S` | session switch/create (fzf: pick existing, or type a new name to create + switch) |
| `Ctrl+b Alt+Shift+W` | worktree picker: repo + status markers (`open`/`dirty`/`merged`/`ahead N`/`behind N`) + git log/status preview; enter→focus/open window, ctrl-v→pane here, ctrl-x→remove (refused if pane open or dirty; merged branch deleted, unmerged kept) |
| `Ctrl+b A` | agents popup (fzf: jump to a coding-agent pane, ranked blocked>done>working>idle; shows agent name) |
| `Ctrl+b Alt+a` | jump to next blocked agent pane (wraps across windows/sessions; falls back to done when none blocked) |
| `Ctrl+b Alt+s` | skill loader (skl picker → enter injects pointer into this pane, ctrl-y copies to clipboard) |
| `Ctrl+b Alt+f` | function/alias search |
| `Ctrl+b T` | Tools launcher (fzf: tmux join-all/burst, Git review, claude-watch, Claude plan viewer, connections, ports, pclose, bandwhich, tsp, tpm-clean) |
| `Ctrl+b a` | AI usage (Claude + Codex + Cosine) |
| `Ctrl+b Alt+c` | launch claude with an account + mcpz bundle (pick account → pick bundle → new window running `ccp <acct> --mcp <bundle>`) |
| `Ctrl+b Alt+b` | branch this pane's Claude/Codex session (fork into split/window, a new worktree window, or under a different account; hand off to the other agent Claude↔Codex via handoff; copy cmd/id) |
| `Ctrl+b Alt+t` | teleport this pane's Claude/Codex session to another host (fork + ship over ssh; window in target tmux or copy resume cmd) |
| `Ctrl+b Alt+i` | save clipboard PNG/GIF, paste its local path into current pane + copy (no popup; result on status line) |
| `Ctrl+b Alt+Shift+I` | upload clipboard PNG/GIF to remote host, paste remote path into current pane + copy (local tmux only; use `shotpath` from Mac for remote tmux) |
| `Ctrl+b Alt+.` | agent dot menu (set this tab's state by hand: working/blocked/unread/idle/clear) |
| `Ctrl+b Alt+k` | caffeine — keep awake, screens still sleep (`i` indefinite, `t` timed, space off) |
| `Ctrl+b Alt+v` | recordings (vox) — pick a recording, preview its transcript (enter copies it, `ctrl-y` pastes the path, `ctrl-e` edits, `ctrl-r` renames) |
| `Ctrl+b O` | open cwd in… (palette: Zed/VS Code/Finder) |
| `Ctrl+b Alt+Shift+G` | GitHub access grant/revoke (gh-gate) |
| `Ctrl+b Alt+g` | GitHub menu (ghfzf triage · gh-dash · ghui) |
| `Ctrl+b u` | fzf-links (open URLs/files/images from pane) |
| `Ctrl+b Alt+u` | fingers (quick-copy text with hints) |

## Organiser

`Ctrl+b W`, right-clicked window tabs, the session badge menu and Remobi
Organise all use the same native tmux organiser menus. Window moves and shares
target existing sessions only; no relocation action creates a session.

| Action | Meaning |
|--------|---------|
| Move and follow… | move this window to another session and switch this client there |
| Move in background… | move this window to another session and stay here |
| Share with session… | link the same live window into another session and stay here |
| Remove from this session | unlink a shared window from this session only |
| Kill shared window everywhere | kill the linked window in every session |
| Break and follow… | make this pane a new window in a chosen session and switch there |
| Break in background… | make this pane a new window in a chosen session and stay here |
| Join marked pane here… | move the marked pane into this window, left/right/above/below |

Move, unlink, join and kill prompts appear when the action closes a source
session or affects every link. Break is disabled when the pane is already the
window's only pane.

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

### Cross-session agents (status bar)

The bottom session rail adds attention-only summaries beside each session:
red `◆` for blocked, blue `●` for finished and unseen. Working and idle stay at
window level, so the rail answers where attention lives without becoming fleet
telemetry. Linked agent windows mark every session through which they are reachable.

Below 80 columns, where the session rail is likely to trim, the right side also
shows the worst blocked/done state plus a count from *other* sessions (`◆1`). The
fallback self-hides when nothing is elsewhere and opens the same ranked agent
popup as `Ctrl+b A`. Disable only this compact fallback with
`tmux set -g @cross_session_badge off`; session dots remain enabled.

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

## Caffeine (status bar)

A bright peach pill (macOS, width ≥ 80) shows **only** while a managed
`caffeinate -i` keeps the Mac awake — it holds *system* sleep while the displays
still sleep on their normal schedule. It self-hides when off, so an active
keep-awake is never silently left running. `Ctrl+b Alt+k` toggles it.

| Pill | State | Meaning |
|------|-------|---------|
| `☼ ∞` peach | on, indefinite | awake until you turn it off |
| `☼ 42m` peach | on, timed | awake for the remaining time, then self-clears |
| (hidden) | off | Mac sleeps on its normal schedule |

## Recording (status bar)

A muted pill (macOS, width ≥ 80) shows **only** while `vox` is capturing audio -
your mic and the system-audio loopback, to two tracks. It is deliberately quiet
rather than an accent colour, because it is visible during screen shares.
`Ctrl+b Alt+v` opens the picker; `vox stop` in any pane ends the recording and
transcribes it locally.

| Pill | State | Meaning |
|------|-------|---------|
| `~ 12m` muted | recording | capturing, elapsed time so far |
| (hidden) | idle | nothing is being recorded |

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
| Claude Code plan (pane or picker) | now in the `Ctrl+b T` Tools launcher |

## Usage Tracking

Keybinding usage is logged to `~/.local/state/tmux/usage.jsonl`.

| Command | Action |
|---------|--------|
| `tmux-usage` | Show most-used bindings by period (1d/7d/30d/all) |

## Mouse

| Gesture | Action |
|---------|--------|
| left-click | select pane/window |
| left-click session rail | switch session |
| left-click session badge | session menu |
| left-click agent badge / memory pill | agents popup / memory popup |
| scroll | scroll the pane under the pointer; keyboard focus stays put (type/dictate in one pane while scrolling another) |
| drag border | resize pane |
| double-click pane | zoom toggle |
| right-click pane | pane organiser (zoom, mark, break, join marked pane, copy info, claude-watch, agent dot, kill pane) |
| right-click window tab | window organiser (move, share, unlink, rename, kill; `~/.trees` windows add publish PR / finish / remove worktree) |
| right-click session name (status left) | session menu (organise, pickers, agents, memory, detach) |
| Alt+right-click | tmux's stock menus (Copy Word/Line, Search, hyperlinks, respawn…) |

When an app owns the mouse (nvim, `less --mouse`, …) a plain right-click passes
through to it; use Alt+right-click for tmux's stock menu there.
