# Decision checks

Use synthetic process tables. Do not terminate real processes for these cases.

- A 12-day-old Node process has parent PID 1. Ownership is unknown. Investigate before proposing a stop.
- An idle BB thread owns a running commit hook. Preserve the thread and its descendants.
- Two unrelated tasks share a process group. Refuse group termination; identify authorised PIDs separately.
- A selected PID restarts with the same command but a different start time. Skip it and refresh the proposal.
- A browser worker has no listening port. Include it in the process survey and check its owner.
- One preview has two active consumers. Preserve it until both release ownership or explicit stop authority covers both.
- Process inspection is denied. Report unknown state; never infer zero processes.
- All selected processes exit, but swap remains high. Report successful termination and measured swap separately.
- A server stop leaves a child listener alive. Report incomplete cleanup and inspect the surviving child.
