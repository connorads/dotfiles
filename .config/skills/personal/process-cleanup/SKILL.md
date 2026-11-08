---
name: process-cleanup
description: >-
  Investigates memory pressure and abandoned development processes on macOS.
  Use when old dev servers, browser workers, test runners or Python servers
  accumulate, swap fills, or the user asks to clean up running processes.
  For reclaiming files and caches, use disk-reclaim.
disable-model-invocation: true
---

# Process cleanup

Which work owns this process, and what evidence says that work has ended?

## Inspect

1. Confirm the target machine. Read its live memory pressure, swap and process table.
   Check tool availability with `command -v ps top lsof vm_stat sysctl`.
   On macOS, use `sysctl vm.swapusage`, `vm_stat`, and
   `ps -axo pid=,ppid=,pgid=,lstart=,etime=,rss=,comm=`.
   A denied or empty probe means unknown state, not an empty machine.
2. Rank memory with `top -l 1 -stats pid,mem`, or Machine Health's footprint view.
   RSS excludes compressed and swapped pages. Summed footprints can count shared memory twice.
   Report these as estimates, not promised reclaimable RAM.
3. Find listeners with `lsof -nP -iTCP -sTCP:LISTEN`.
   For selected PIDs, inspect commands, start times, parents, descendants and working directories.
   Use `lsof -a -p PID -d cwd -Fn` for one selected PID.
   Keep raw commands private; arguments can contain credentials. Never dump process environments.
4. Check owning terminals, tasks, workflows and services.
   For BB, read `bb guide terminals` and inspect the target machine's terminals and relevant threads.
   Idle threads can own background work. No terminal listing does not prove no agent-owned processes exist.

## Classify

Group a server and its workers by verified ancestry and checkout, not executable name alone.
A listener scan misses browser workers and test runners. Include those in the process survey.

| Evidence | Action |
| --- | --- |
| Active task, build, test, commit hook or browser run | Preserve |
| Deliberately persistent service | Preserve; use its service manager if a stop is requested |
| Completed work with a verified owner and leftover process tree | Propose stopping that exact tree |
| Unknown owner, old process, or parent PID 1 alone | Investigate; do not label safe |

Age, low CPU and an idle port do not establish abandonment.
Record all known consumers of shared previews. One consumer finishing does not release the others.
Record candidate machine, PID, start time, checkout, ports, owner evidence and estimated footprint.
Show the candidates before requesting any missing stop authorisation.
Reuse explicit authorisation already given for the same targets.

## Stop and verify

1. Refresh each authorised target's start time, command and ownership immediately before stopping it.
   Skip changed identities and newly active work. Matching commands alone do not exclude PID reuse.
2. Prefer the owning runner's stop command or the specific BB terminal's close operation.
   Otherwise send SIGTERM only to verified authorised PIDs.
   Signal a process group only when every member belongs to the authorised work.
   Never use name-wide kills. A shared shell or agent group can contain unrelated work.
3. Wait for graceful shutdown, then inspect surviving descendants and listeners.
   Refresh survivor identities and ownership before escalation.
   Use SIGKILL only for verified survivors within the authorised scope.
   Report refusals and survivors; sending a signal does not prove termination.
4. Re-read memory pressure and swap. Report observed change separately from process footprint estimates.
   Concurrent work changes the totals. Swap need not return to zero after successful cleanup.

## Prevent recurrence

For test-only servers, prefer the test runner's server lifecycle and verify teardown.
For interactive previews, use a named owner and explicit expiry or retention decision.
Close disposable browser sessions after their work ends.
A reminder skill does not enforce expiry; that requires a runner or supervisor.

Synthetic decision cases live in `evals/regressions.md`. Read them when revising the skill.
