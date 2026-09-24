# fzf-links path schemes (`prefix + u`)

[tmux-fzf-links](https://github.com/alberti42/tmux-fzf-links) scrapes the visible
pane, matches paths and URLs, and opens the chosen row. **Path handling is ours,
not the plugin's**: `rm_default_schemes = ["file", "dir"]` in
[`user_schemes.py`](../user_schemes.py) drops the default file scheme outright and
three schemes replace it - `image` → SYSTEM_OPEN (Preview / xdg-open), `folder` →
`cd` the pane, `path` → EDITOR. The plugin keeps the URL, git, traceback and OSC 8
hyperlink schemes, plus its LS_COLORS colouring and popup plumbing.

Reversal is one line: delete `rm_default_schemes` and `user_schemes` and the
plugin's own behaviour resumes.

Two files, and the split is required:

- [`fzf_link_paths.py`](../fzf_link_paths.py) - the core, importing nothing from
  the plugin, so it is testable, typecheckable and runnable with no plugin
  checkout. Matching (two regexes), resolution (cwd then repository root),
  `kind_for`, `display_for`, `claim` and `cd_command`.
- [`user_schemes.py`](../user_schemes.py) - the adapter, the only file touching
  the plugin, with no branches. It loads the core by path (`spec_from_file_location`,
  the plugin's own mechanism) rather than putting `~/.config/tmux` on the import
  path, where a name that generic would shadow whatever else is installed.

Findings that break things if ignored:

- **`checked` is dead, so shadowing a tag does nothing.** `__main__.py` creates
  the set, reads it, and deletes it without ever adding to it, so the documented
  "user schemes take precedence" does not work: a user scheme claiming `file`
  runs *alongside* the default file scheme, and `tag_to_index` is last-wins, so
  the **default** scheme owns the tag. `rm_default_schemes` is the mechanism that
  works - and it is checked against user schemes too, so a scheme claiming `file`
  while also removing it removes *itself*. Hence fresh tag names plus removal.
- **Three schemes, not one with three tags.** `opener` is per scheme, so one
  scheme cannot send an image to Preview and a source file to $EDITOR. Each
  pre-handler declines what is not its own kind, so exactly one claims each
  match. The cost is that the content is scanned once per scheme (~0.02s
  typical, 0.34s on 2000 prose-heavy lines).
- **The `path` scheme goes through upstream's EDITOR opener** rather than
  hand-rolling the `%file`/`%line` templating, which is what brings back its
  `isBinaryFile` refusal. The default file scheme templated under CUSTOM_OPEN,
  so that check never ran and a picked `.zip` really did open in nvim.
- **The cwd and repository root are resolved lazily.** The plugin imports the
  user module at `__main__.py:247`, 46 lines *before* it chdirs to
  `#{pane_current_path}` at `:293`, so anything eager answers for the wrong
  directory. `GIT_DIR`/`GIT_WORK_TREE` are stripped from the `rev-parse`
  environment, or the dotfiles hook wrappers would make every pane report this
  repository's root.
- **A load failure is already the loudest thing here.** A user-module import
  error is re-raised as `ImportError` (`__main__.py:93`), which the catch at
  `:540` misses, so it lands as a `logging.error` that `logging.py` renders with
  `-d 0` - a sticky message. Do not add a catch-and-degrade: it would turn the
  loudest failure mode into a silent one. Plugin *drift* is likewise already
  reported by `up`.
- **The plugin is pinned in nix, not by TPM.** `home-shared.nix` pins the SHA and
  `home.activation.tmuxPlugins` converges it, so an upstream change arrives as a
  deliberate commit.
- **Resolution is memoised and claimed.** A scheme's pre-handler and post-handler
  must agree on which file a row means, so `resolve` is cached; and `claim` gives
  each (file, line) one row, because the plugin dedupes on the matched *text* and
  a file written absolutely in one line and relatively in another would otherwise
  be two identical-looking rows.
- **A path with spaces is found by a suffix walk**, dropping *leading* words from
  a run until one exists, longest first - so `git status`' `M  walkies/my
  image.png` resolves. Trailing chrome is not handled (`wrote a/my b.png ok`
  finds nothing): dropping trailing words too would square the probe count and
  invent paths out of prose. A spaceless tail is left to the token regex, or one
  file would get two rows. Prose punctuation (`(path)`, `[path]`, a trailing
  `.`, `,` or `;`) is trimmed as a second candidate per form, verbatim first, so
  a filename that really contains a bracket still wins; backticks end a match
  like quotes.
- **An apostrophe in a filename is not openable**, and that is upstream's
  quoting, not ours: both SYSTEM_OPEN and EDITOR build a shell string
  (`open '%file'`) and `shlex.split` it, so a `'` raises rather than opening the
  wrong file. Only `cd_command`, which is ours, quotes properly. Fixing it means
  a CUSTOM_OPEN scheme with an explicit argv.

## Too many rows wedges the tmux server

**This is the failure mode to know about, because it looks like tmux has died.**
Measured end to end on a throwaway server, and reproduced with the stock schemes
too - it is upstream's, not ours:

1. `run_fzf` embeds **every row** in the argument of one `tmux popup -E`
   command, as `echo "<all rows>" | fzf …`.
2. tmux refuses any command over `MAX_IMSGSIZE`, printing `command too long`.
   The cliff sits between 16000 and 16400 bytes on 3.7b, so the popup never
   starts and never runs its shell command.
3. `run_fzf` then blocks **forever** in `open(stdout_pipe)` - a FIFO whose only
   writer would have been that command. There is no timeout.
4. The plugin binds its key with a **foreground `run-shell`**, so the client's
   keys and clicks queue behind the job (see "A foreground `run-shell` queues
   the client's keys" in
   [vox](./vox.md#findings-that-break-things-if-ignored)). The terminal appears dead and has to be killed;
   the python is still there afterwards, sleeping in `open`, and shows up under
   `ps -Ao pid,ppid,command | grep tmux_fzf_links` parented by the server.

The row count needed is low, because the plugin's own numbered and coloured
prefix costs **56 bytes per row** (20 uncoloured) before any path text - it, not
the display text, dominates the command. Two things keep us clear of the cliff:

- **`@fzf-links-history-lines 0`** in [`tmux.conf`](../tmux.conf), the plugin's
  own default: the picker offers the visible pane. At 2000 lines, a codex pane
  in a repo turns a 40-line screen into 166 rows and a 21KB command.
- **`ROW_BUDGET`** in [`fzf_link_paths.py`](../fzf_link_paths.py): `claim`
  refuses a row once our rows have spent it. That bounds *our* contribution
  only - the default schemes' rows (urls, hyperlinks) are unbounded and merged
  after ours, so a screen densely packed with long URLs alone can still wedge.
  A refused row is a path on screen with no picker row: silent, and deliberately
  preferred to a tmux you have to kill.

Measured on the pane that wedged (2000 lines of scrollback): stock 185 rows /
21244 B (wedges); ours with the budget 13.6KB; ours at `history-lines 0`
1583 B. `test_fzf_link_schemes.py` pins the arithmetic by rendering rows exactly
as `__main__` does and asserting the command stays under the limit - the guard
fails if the budget or the per-row overhead drifts.

Not fixed here, and worth doing upstream: choices belong in a temp file rather
than a command argument, and the FIFO open needs a timeout so a failed popup
cannot hang. A `run-shell -b` binding would also turn any future hang from a
dead terminal into a no-op.

Gates and tests: `py-typecheck-tmux` (pyrefly strict, the **core only** - the
adapter's `tmux_fzf_links` import resolves only beside the gitignored plugin
checkout) and `py-tests-tmux` (pytest via `uv`, at commit time) in
[`hk.pkl`](../../../hk.pkl), plus `mise run py-checks`.
[`test_fzf_link_paths.py`](../test_fzf_link_paths.py) is the core's table tests;
[`test_fzf_link_schemes.py`](../test_fzf_link_schemes.py) drives the **real**
plugin - it merges user and default schemes exactly as `__main__.py` does and
asserts the default file scheme is gone, our three tags are ours, and each kind
of path gets one row - and skips itself when the checkout is absent.
