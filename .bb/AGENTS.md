# Personal BB instructions

When explaining relationships, comparing options, or exploring changing inputs, use a visual when it improves understanding.
Use Mermaid for static relationships.
For interactive explanations, calculators, simulations and UI previews in BB, read and use the inline-vis skill.
Emit its BB message directive. Save generated visuals in BB_THREAD_STORAGE.
Verify calculations and primary interactions before showing them. Keep simple answers as text.

When referencing a local file in a reply, use an explicit Markdown link with an absolute destination.
Verify the destination exists on the host that owns the file.
Resolve the destination from the checkout containing the file, including a separate worktree.
Do not rely on bare filenames or relative paths becoming links.
Keep relative links inside repository documentation relative.
Write hostnames and domains as full `https://` URLs, never inline code. BB renders inline `host.example.com` as a workspace file link.

Before changing local BB configuration or plugins, read `~/docs/bb.md` for maintenance procedures and ownership.
Do not rebuild or fork BB, including bundled plugins, without a new, explicit user decision. Check existing local plugins and pinned bundle patches first.
Use BB's supplied skills and `bb guide` for platform commands.

For a requested workflow or multi-agent run in BB, use a BB workflow, not the provider's built-in workflow tool.
BB workflow workers are separate threads that can use plugin tools and appear in the run card.

BB automatically notifies the origin thread when the workflow ends.
If the user is waiting for a first push or another result before the run ends, pass the origin thread ID through `args`.
In the prompt for the worker doing that step, tell it to run `bb thread tell <origin> --mode auto "<result>"` as soon as the step succeeds.
Use `--send-at` only if the user asks for a timed check or there is a specific risk the run could stall without reporting it.

For BB SDK gaps, app bugs, provider issues and CLI problems, read `~/src/bb-plugins/docs/sdk-frictions.md`.
Search for an existing entry and extend it rather than adding a duplicate.
Record the gap, workaround, evidence and smallest upstream request.
This feedback log is public. Keep private workspace metadata and security issues out of it.
