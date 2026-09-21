## Report Next.js friction

Only participate in agent feedback when managed Next.js feedback instructions
are already loaded for the project. Their presence means the feature is
enabled; their absence means it is disabled.

When enabled, add qualifying de-identified candidates found during verification
to the shared friction queue in the current task context, then continue
verification. Do not run the feedback command or open review forms during the
loop or at this Skill's teardown.

The managed instructions own the single feedback pass at the final stopping
point of the overall task. If they are absent, do not queue or report feedback.
