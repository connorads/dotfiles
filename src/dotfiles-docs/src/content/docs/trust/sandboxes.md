---
title: Sandboxes and scoped tokens
description: Credential-free remote machines, OS-sandboxed agent sessions, and VM-isolated boxes for untrusted code - blast-radius engineering for an agent-heavy workflow.
---

## The itch

I run agents with their permission prompts off, and I run them on remote
machines so they keep working after I close the laptop and leave the house.
That second part is the quiet escalation: it means machines executing
model-driven shell commands around the clock, unattended.

So the question isn't "will an agent ever do something wrong?" - over enough
hours, something will, whether from a prompt injection, a compromised
dependency that beat the [quarantine](/trust/supply-chain/), or plain model
error. The question is what the worst case costs. That splits into two
smaller questions: what can code on that machine *do*, and who can it act
*as*?

## What I do

Three layers, with very different duty cycles - one is always on, two are
insurance. I'll be honest about which is which.

### Remote machines hold no identity

This is the layer that's always working. My desktop is the only machine with
real credentials on it: `gh` is logged in there, and the SSH private key
never leaves it. The remote machines the agents live on have no ambient
authority at all.

Two patterns enforce that. First, SSH agent forwarding is off by default -
each remote host has a pair of aliases in my SSH config, `dev` (no
forwarding, the default, safe to let agents loose on) and `dev-agent`
(forwarding on, for the moment I personally need to push). Reaching for the
`-agent` suffix is a deliberate act, not a standing state.

Second, `gh-gate`. Each remote gets a fine-grained read-only GitHub token at
rest - agents can clone and read issues all day. When work there needs to
push, `gh-gate grant` mints a write token from a GitHub App and pushes it
over; the token expires after an hour, `gh-gate revoke` kills it sooner, and
the App's own permissions are an absolute ceiling on what any minted token
can do. On the desktop, the App's private key sits in the macOS Keychain
behind Touch ID - a fingerprint per grant. The emergency stop is
uninstalling the App, which invalidates every token at once.

The result: a fully compromised remote machine can read the code that's on
it, and that's roughly it. It can't push as me, can't SSH onward to my other
machines, and its write access to GitHub is either absent or measured in
minutes. Data loss is a bad day; identity loss is a bad year.

### An OS sandbox for agent sessions

`asb` wraps CLI agents in an OS-level sandbox (macOS Seatbelt, via
Anthropic's sandbox-runtime) with a declarative policy: secrets directories
like `~/.ssh`, `~/.aws` and the gh-gate config are unreadable, writes are
confined to the project and caches, and network egress is an allowlist.

The design assumption is that the agent's own judgement fails sometimes. The
policy exists for exactly those moments - in testing, an agent refused to
touch `~/.ssh` on its own, but happily tried an unsolicited `curl` and a
write outside the project, and the sandbox stopped both. The model's safety
layer is the first line; the policy is the one that holds.

The same secret-path list is also enforced one layer up, inside each agent's
own permission mechanism: Claude Code gets static deny rules plus a hook that
catches shell readers like `xxd` and `base64`, Codex gets the same check via
its hook contract, and pi gets a guard extension that vets every tool call.
Those guards run everywhere - including sessions that never went through
`asb` - and give the model a reason string it can act on, while the OS
sandbox stays the backstop for anything textual matching can't see. A
pre-commit parity check fails any commit that lets the per-agent copies
drift from the sandbox policy's canonical list.

### A VM for code I don't trust at all

`sbx` is for running software I actively distrust - the unknown binary, the
repo I'm reverse-engineering. It's a throwaway container inside a Linux VM
with no host mounts whatsoever, all capabilities dropped, and no network
until I explicitly grant it. Files go in by explicit copy; the whole box and
its volume can be nuked with one command. It's the inverse of every other
tool here: instead of bringing my environment to the code, the code gets a
bare room and nothing else.

### Which layers actually fire

Honesty over posture: in three and a half months of shell history on this
machine, I never once typed `sbx` or `asb`. Nearly everything I run is my
own code or vetted dependencies, so the sandboxes are insurance - kept
sharp, rarely claimed. The credential asymmetry is different: it's
structural, always on, and does its job precisely by never being noticed.
That's the split worth copying - identity protection as a standing
condition, execution isolation as an available lane.

## Why it compounds

Blast-radius engineering is what lets the fast path stay fast. Because the
worst case is bounded - quarantine under the packages, no identity on the
agent machines, a sandbox lane for anything sketchy - I don't have to
re-litigate "is this safe?" per task, and I never have to choose between
convenience and safety in the moment. The floor was poured once, in config,
in version control.

It also changes what I'm willing to try. An unknown tool or a stranger's
repo isn't a risk assessment, it's `sbx new` - so curiosity gets cheaper,
which is the same compounding argument as everything else here, applied to
trust instead of keystrokes.

## Steal this

Skip the machinery; steal the identity asymmetry. Pick one machine to hold
credentials, and give every other machine paired SSH aliases:

```text
Host dev
    HostName your.server
    ForwardAgent no    # the default you actually use

Host dev-agent
    HostName your.server
    ForwardAgent yes   # the exception you reach for deliberately
```

Then stop storing real tokens on machines that run unattended code: if a
remote needs GitHub access, give it a fine-grained read-only token and mint
write access only when needed (a GitHub App if you want expiry and a
ceiling, or just rotate a short-lived fine-grained PAT by hand). A
compromised box that can't act as you is an incident; one that can is an
identity theft.
