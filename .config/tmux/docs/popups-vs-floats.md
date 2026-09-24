# Popups vs floating panes

**A popup is a transaction; a float is a place you dwell. Default to a float.**

`display-popup` is modal: while one is up the client's keys belong to it, so you
cannot switch windows, navigate panes or answer an agent without discarding the
popup and its state. That cost is highest here precisely because the agent
attention system (dots, the blocked bell, `prefix + A`, the cross-session badge)
exists so you can act the moment an agent needs you - every open popup is a
window in which that is false. Floats (`new-pane`, tmux 3.7+, wrapped by
[`../zsh/functions/tmux/flt`](../../zsh/functions/tmux/flt)) are non-modal real
panes: switch away and come back and the tool is still there.

Three blockers force a popup. Nothing else does:

| Blocker | Why |
|---|---|
| Calls `switch-client` / opens a window | A float belongs to a *window*. Switch away mid-selection and the float and its fzf are stranded. |
| Acts on "the pane I came from" | Popups do not change the active pane; **floats become the active pane**, so origin-by-active-pane resolves to the float itself. |
| Must work from any window | Float scope is per-window: a float belongs to the window it was made in, so there is no one summonable scratch. (A window can hold *several* floats - what you cannot have is one that follows you.) |

The second blocker is mechanically removable: `run-shell` format-expands its
command before running it (`man tmux`, run-shell: *"Before being executed,
shell-command is expanded using the rules specified in the FORMATS section"*),
so a float binding can pass `#{pane_id}` explicitly and the script takes the
origin as an argument - see `prefix + Alt+w` and `wt-window.sh pane <path>
[origin]`. `display-popup` cannot do this reliably, which is why the popup
callers resolve the origin live instead.

Every float goes through `flt`, the single door carrying the tmux#5327 unzoom
guard; presets live there, so bindings never spell out geometry. Floats are
drag-resizable, so per-binding sizes are not worth the divergence - `big` unless
there is a reason.

**A float can hold a resident, not just a glance.** Float work comes in three
kinds, and the doctrine above names only two of them. A transaction is picked
and acted on (`prefix + A`). A glance is opened and closed (`prefix + g`
lazygit, 333 uses). A *resident* stays for days: an agent session forked by
`prefix + Alt+b` (143 uses), a scratch shell you typed `claude` into. Residents
are opened into glance containers, so every float needs a door out as well as
in; without one a long-running agent is stranded in the pane it started in.

`unflt` ([`../zsh/functions/tmux/unflt`](../../zsh/functions/tmux/unflt)) is that
door, and the mirror of `flt`: it joins a float back to a tiled pane of the same
window, and `prefix + *` calls it when the active pane is floating. What tmux
3.7b allows, verified on a private socket:

| Direction | 3.7b | Mechanism |
|---|---|---|
| float -> tiled, same window | works | `join-pane -s <float> -t <tiled>` |
| float -> its own window | works | `break-pane`, i.e. stock `prefix + !` |
| tiled -> float | not possible | `move-pane` has no `-X`/`-Y`; `new-pane` only creates |

So there is no toggle to build: `unflt` is one-way because tmux is. Revisit
tiled -> float on 3.8, alongside the resurrect limitation below.

**The join destination has to be filtered.** A window can hold several floats,
so `-t :.+` can land on another one and fail with `size or position can't split
a floating pane`. Name a non-floating pane instead:
`tmux list-panes -F '#{pane_id}' -f '#{!:#{pane_floating_flag}}' | head -1`.

These bindings must stay popups, with the blocker each hits:

| Binding | Blocker |
|---|---|
| `prefix + S` (and `M-S`) session switch/create | switch-client |
| `prefix + A` agents popup | switch-client |
| `prefix + Alt+Shift+W` worktree picker | focuses / opens windows |
| `prefix + Alt+s` skl loader | injects the pointer into the origin pane |
| `prefix + Alt+v` vox picker | `ctrl-y` pastes the path into the origin pane |
| `prefix + Alt+Shift+I` shotpath remote | pastes the remote path into the origin pane |

`prefix + Alt+g` → `t` (ghfzf triage) stays a popup as a transaction - pick one
thing, act, done - while the `d`/`u` dashboards and `o` Oyo review on the same menu are floats.
The Oyo launcher calls `oyp` in the floating pane. Run `oyp` directly to review
in the current terminal. It opens the current open GitHub PR and pulls its comments. With no open PR
or a detached HEAD it opens the local review. It needs the PR history locally;
lookup and sync failures remain visible until a key is pressed in the floating
launcher. Direct `oyp` calls return errors without waiting for input.
The three origin-pane cases above are unblockable via the `#{pane_id}`
pattern, but each needs its own script change.

**Floats do not survive a resurrect restore as floats.** tmux 3.7 emits a float
in `#{window_layout}` as a trailing `<…>` cell, but `select-layout` rejects that
string (`invalid layout`), and `restore.sh` replays exactly that saved layout.
Verified on a private socket (save a tiled pane + a float, restore, read
`#{pane_floating_flag}`): every pane comes back, with its command and cwd, as an
ordinary tiled pane. Nothing is lost but the floatness and the geometry. It
comes with any float binding, and is a tmux limitation to revisit on 3.8.
