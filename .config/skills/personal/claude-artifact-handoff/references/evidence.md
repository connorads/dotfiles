# Recipe evidence

## Observed spike

Verified 2026-10-15 with Claude Code 2.1.293, one Claude account, and automatic permission review enabled.
The originating agent used BB's terminal CLI. Credentials stayed inside Claude Code.

| Probe | Observation |
| --- | --- |
| Launch interactive Claude in a BB persistent terminal | Native `Artifact` tool available |
| Request publishing through a brief file | Review rejected `Unrequested Artifact Publish` |
| Request publishing explicitly in terminal input | Native publish succeeded without permission changes |
| Change the marker and request update with the existing URL | Same URL; version increased from 1 to 2 |
| Read through native `Artifact` | Read succeeded; Claude reported the new marker and matching version identifier |
| Collect result files | Originating agent checked matching URLs and distinct publish/update version identifiers |
| Send combined text and Enter | Follow-up text remained in the composer until a later carriage return |
| Close disposable terminal | BB reported it closed |

The explicit-request contrast supports that prompt form for this recipe.
It does not establish a general rule about the permission classifier.
The result files are Claude-authored reports. The terminal transcript independently shows publish, update, and read tool events.

## Limits

The spike does not test browser appearance, counter clicks, capability declarations, remote hosts, or deterministic callbacks.
It does not test concurrent jobs, restart recovery, persistent watching, or comment forwarding to the originating agent.
Do not claim these capabilities from a successful publish.

## Recipe validation

A fresh-context agent followed the draft skill on 2026-10-15 against the same private test artifact.
Its first explicit launch prompt succeeded. Native tool events show a read, an update, and another read.
Claude reported version 3 and the requested source marker in the hosted readback.
The contract's result JSON passed URL, version identifier, marker, and evidence checks in the originating agent.
The test exercised directory trust, transcript expansion, and disposable terminal cleanup.
It needed no follow-up input, so the separate text/Enter sequence retains only the initial spike's evidence.

The result shape in the contract normalises the initial spike's separate publish, update, and verification files.

## Sources to recheck

- [Claude Artifact availability and behaviour](https://code.claude.com/docs/en/artifacts)
- [Interactive CLI invocation](https://code.claude.com/docs/en/cli-reference)
- `bb guide terminal` for installed terminal commands

Recheck live tools when versions or execution hosts differ from the observation.
