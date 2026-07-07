# The workflow VM is defence-in-depth, not a security boundary

Status: accepted

A workflow is Claude-compatible JavaScript, so the extension must execute
model-generated JS in-process; it does so in a `node:vm` context that injects the
DSL helpers and swaps in deterministic `Date`/`Math` shims. `node:vm` is
documented as **not** a security boundary, and the subagents a workflow spawns
already hold the `bash`/`edit`/`write` tools, so the VM was never the wall between
an adversarial model and the host. We therefore treat the VM as defence-in-depth
whose real jobs are (a) enforcing determinism for replay and (b) containing the
blast radius of a one-shot generated script - not as an isolation boundary. We
close the known `.constructor` host-`Function` leak and the `Date`/`Math`
prototype leaks cheaply, but deliberately do **not** move execution out-of-process
into a worker isolate: that multi-day rewrite (async RPC for every `agent()`/
`parallel()`/`pipeline()` call) is only justified if the orchestration script is a
distinct untrusted surface from the agents, and here both trace back to the same
model.

## Considered Options

- **Harden the in-process VM (chosen)** - kill the constructor/prototype leaks,
  document the limit.
- **Out-of-process worker isolate** - a genuine boundary, but a large rewrite of
  the helper plumbing for a threat the spawned agents' `bash` tool already
  reopens.
- **Determinism only** - leave the RCE open by design; rejected as needlessly
  reckless when the leaks are cheap to close.
