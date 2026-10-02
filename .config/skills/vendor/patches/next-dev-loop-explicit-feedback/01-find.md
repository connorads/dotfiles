## Report Next.js friction

Only participate in agent feedback when managed Next.js feedback instructions
are already loaded for the project. Their presence means the feature is
enabled; their absence means it is disabled.

When enabled, add qualifying feedback candidates found during verification to
the feedback candidate queue for the current user request, then continue
verification. Do not run the feedback command or open review forms during the
loop or at this Skill's teardown.

The managed instructions own the single reporting pass immediately before the
final response. If they are absent, do not queue or report feedback.
