# Memory-pressure monitoring (custom subsystem)

macOS-only memory gauge, parallel in shape to the agent dots: one shared lib and
three surfaces speaking one vocabulary - `OK | BUSY | CRITICAL`, encoded as
colour plus glyph plus a compressor-fill percentage, with a `▲` pressure marker
before the figure under kernel warn or critical pressure. Every surface is
built to answer three questions at a glance - what the number is, how far it
is from the line that changes the colour, and what lowers it - because a figure
without its line and its lever is not actionable: the popup marks the lines on
the bar and names the distance and the action, the banner carries the
distance, and the help section reads as a procedure. Change as a set:

- [`scripts/mem-lib.sh`](../scripts/mem-lib.sh) - **canonical** thresholds
  (`MEM_BUSY_SLOTS_PCT` 60 / `MEM_CRITICAL_SLOTS_PCT` 80 / `MEM_BUSY_SEGS_PCT`
  70 / `MEM_CRITICAL_SEGS_PCT` 85), state mapping (`mem_state` /
  `mem_state_from PRESSURE SLOTS SEGS`), the colour/glyph language
  (`mem_state_colour` / `mem_state_glyph`), and the figure-slot logic
  (`mem_cause` over `none | pressure | slots | segments`, `mem_token`,
  `MEM_CAUSE_GLYPH`): the token is always the binding arm's `NN%`, prefixed
  with `▲` whenever the kernel pressure level is 2 or 4 (`▲33%`).
  State comes from the compressor's **two ceilings**, both hard kernel limits it
  panics at: slots (`vm.compressor.pages_compressed` over
  `.pages_compressed_limit`; a swapout never releases one, only a process free
  or exit does - the arm the 2026-09-20 panic hit at 100%) and segments
  (`vm.compressor.segment.total` over `.segment.limit`; relieved by swapout and
  compaction). Swap tracks the segments arm only, so `mem_swap_*` stays a figure
  for the popup and the log and is no longer an input to the state. Pressure 4
  (critical) makes the state CRITICAL on its own and is then the cause;
  pressure 2 (warn) is this machine's resting level under ordinary load
  (measured: on all day at 30% fill), so it changes no state and only adds the
  marker - `pressure` is impossible as a BUSY cause. Per-arm helpers for the
  popup: `mem_arm_state PCT BUSY CRIT`, `mem_arm_gap PCT BUSY CRIT` (`NN to
  amber` / `NN to red` / `NN over red`), `mem_bar_marked PCT WIDTH BUSY CRIT`
  (a `│` tick between cells at each line, so a bar is WIDTH+2 wide and the
  fill is lossless). Helpers: `mem_compressor_raw` (four counters, one fork, a
  short answer collapses to `0 0 0 0` because `sysctl -n` drops a missing key's
  line rather than printing a placeholder), `mem_pct_from VALUE LIMIT`,
  `mem_ratio_from PAGES SEGS` (pages per segment; above ~8 slots fill first),
  `mem_compressor_pcts`, `mem_binding_arm` (the arm at its line binds; both or
  neither over → the higher percentage, ties to slots). Sourced, never run.
  On Linux the macOS sysctls are absent → fill 0, pressure 1 → flat `OK`.
- [`scripts/status-right.sh`](../scripts/status-right.sh) - `mem_segment()`, the
  quiet-when-healthy pill (width ≥ 80 only). It gathers pressure and the four
  compressor counters in one `sysctl` fork (five keys; anything but five lines
  back zeroes the fill), then uses the lib's pure `*_from` derivations.
  `ram_percentage()` parses one `vm_stat` capture directly on macOS and renders
  **alongside** it by design - RAM% is the total-used headline, mem_segment the
  compressor/pressure signal.
  CPU is stale-while-revalidate: a render returns cached data (or `--%`) at
  once, while one lock-guarded, five-second-bounded sampler writes atomically in
  the background. Fresh data appears on the next native status tick; never force
  a refresh from the sampler.
- [`scripts/mem-popup.sh`](../scripts/mem-popup.sh) - `prefix + Alt+m` bounded
  triage (top 5 sampled `phys_footprint` apps + 3 agents). The header is
  built to answer three questions without the docs: what the number is, how
  far it is from the line that changes colour, and what lowers it. It gathers
  the compressor counters once, then renders each ceiling through `render_arm`
  as its own state glyph and figure (coloured by that arm's standing, via
  `mem_arm_state`, while the header glyph stays the overall state), a 20-wide
  `mem_bar_marked` bar with a `│` tick at the amber and red lines, the
  `mem_arm_gap` distance (`27 to amber`, `3 to red`, `2 over red`), and the
  logical size (`x of y GiB`: pages × `hw.pagesize`, segments ×
  `vm.compressor_segment_buffer_size`, defaults 16384 / 65536). A gloss under
  each arm names what it holds and what lowers it; swap sits on the segments
  gloss because only a swapout releases a segment, wired on the state line
  beside `pressure N/4` and its `▲ warn` / `▲ critical` marker. The ratio row
  compares pages-per-segment against the limits' own ratio and says which arm
  fills first. The `Action` row names the heaviest idle/done pane `h` would
  stop first, or the `k` fallback. `render_arm` pads only ASCII fields: POSIX
  printf pads by bytes, so a width on `▓ │ ⬡` or an escape misaligns the row.
  `render()` gathers `mem_hibernate_rows` in the background alongside the app
  snapshot, uncapped ("heaviest" needs every candidate measured), into
  `CURRENT_HIB_ROWS`, which both the action row and `h` read - so the picker
  opens at once. `k` chooses a visible app then a process before handing to
  `pclose --pid`; `a`/`g` open scrollable sampled-app/all-agent details. `h`
  opens a multi-select list of idle/done Claude panes, ranked by the largest
  physical footprint in each pane's process tree. One selection hibernates
  directly; several require confirmation. Every selected pane is attempted,
  and one result line reports hibernated, refused and failed counts. `r`
  refreshes and `q` closes.
- [`../zsh/functions/macos/memwatch`](../../zsh/functions/macos/memwatch) - launchd
  watcher (desktop-only, [`darwin-desktop.nix`](../../nix/modules/darwin-desktop.nix)).
  Every 5 s (`MEMWATCH_INTERVAL`) it reads the pressure level and the four
  compressor counters, derives state and cause through the lib, and on a
  transition into BUSY/CRITICAL posts a banner - `slots 62% (18 to red) · segs
  27% (43 to amber) · swap 6.0G · top: <app>`, the distance via `mem_arm_gap` -
  and appends `<ts>  state=  cause=  pressure=  swap=  slots=  segs=  ratio=`
  plus the top-5 footprint rows to `~/.cache/memwatch.log`. A sustained bad
  state is re-logged and re-bannered only once per `MEMWATCH_COOLDOWN` (600 s)
  *and* only when the reading has moved against the last line written: state
  or cause differs, or either arm by `MEMWATCH_DELTA_PCT` (3) points or more.
  The reference advances only on a write, so slow drift accumulates rather than
  hiding under the delta. There is no heartbeat: a quiet log means nothing
  moved, and the stall probe is the liveness signal. Pressure 2 with both arms
  under their lines is OK and logs nothing; the `pressure=` key is what shows,
  after a week, whether warn pressure really is this machine's resting level.
  The sleep doubles as a
  **liveness probe**: a wake later than `MEMWATCH_STALL_LOG_SECS` (2) logs
  `<ts>  stall=Ns  interval=Ns`, and one later than
  `MEMWATCH_STALL_CRITICAL_SECS` (5) makes the next tick CRITICAL with the
  memwatch-local cause `stall`. The 2026-09-20 panic was preceded by ~2 min of
  userspace stall that a 5 s sleeper sees as it starts; the probe measures
  memwatch's own scheduling, a proxy for watchdogd's thread and not that
  thread, so the thresholds sit well inside the kernel's ~90 s deadline.
  `MEMWATCH_TICKS` bounds the loop (`--once` = 1, and never sleeps). At
  CRITICAL it runs the emergency hibernation tier described under [Automatic
  hibernation](./hibernate.md#automatic-hibernation) (`MEMWATCH_HIBERNATE_SH`, `MEMWATCH_ACTION_COOLDOWN`,
  `MEMWATCH_LOCK`, `AGENT_AUTO_PINS_FILE`), logging `would hibernate %N (…)`,
  `hibernate %N (…) rc=0|rc=6 refused|rc=N failed`, `hibernate deferred:
  tick.lock held` or `no hibernatable agent pane`. The launchd plist carries
  the nix profile on `PATH` (tmux, jq and the bash-5 engine live there; with
  the system PATH alone the action silently never runs) and `LANG=en_GB.UTF-8`
  (tmux sanitises the tab delimiters outside UTF-8). Reload after edits:
  `launchctl kickstart -k "gui/$(id -u)/dev.connorads.memwatch"`; a dry run in
  the tracked `observe` mode is `MEM_CRITICAL_SLOTS_PCT=1 memwatch --once`,
  which must log `would hibernate` and touch no pane.

Tests: [`../zsh/tests/mem-lib.bats`](../../zsh/tests/mem-lib.bats) (lib vocabulary,
including the gather under zsh with `no_unset`),
[`../zsh/tests/mem-popup.bats`](../../zsh/tests/mem-popup.bats) (bounded summary,
the two-arm header and the hibernate flow),
[`../zsh/tests/memwatch.bats`](../../zsh/tests/memwatch.bats) (the watcher: log
grammar, banner, the top-5 rows with no leaked parameter echo, the stall
probe against a real overrunning `sleep` stub, `--once`, and the emergency
tier's mode / pins / refusal / lock / cooldown cases against a stub engine),
and the RAM/mem
pills in [`../zsh/tests/status-right.bats`](../../zsh/tests/status-right.bats).
Keep the gauge legend in [`help.md`](../help.md) in sync with the lib.
