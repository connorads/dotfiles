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

Before changing local BB configuration or plugins, read `~/docs/bb.md` for maintenance procedures and ownership.
Use BB's supplied skills and `bb guide` for platform commands.

For BB SDK gaps, app bugs, provider issues and CLI problems, read `~/src/bb-plugins/docs/sdk-frictions.md`.
Search for an existing entry and extend it rather than adding a duplicate.
Record the gap, workaround, evidence and smallest upstream request.
This feedback log is public. Keep private workspace metadata and security issues out of it.
