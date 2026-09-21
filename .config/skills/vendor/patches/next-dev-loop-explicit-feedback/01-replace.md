## Report Next.js friction

{{marker}}
Only participate in agent feedback when the user explicitly requests sending
Next.js feedback for the current task and managed Next.js feedback instructions
are already loaded for the project. Loaded instructions alone do not authorise
feedback. If either condition is absent, do not queue or report feedback.

Respect project and user privacy opt-outs. Do not enable feedback, change
privacy settings, or bypass an opt-out to fulfil a feedback request.

When both conditions hold and no privacy opt-out applies, add qualifying
de-identified candidates found during verification to the shared friction queue
in the current task context, then continue verification. Do not run the feedback
command or open review forms during the loop or at this Skill's teardown.

The managed instructions own the single feedback pass at the final stopping
point of the overall task, within the user's requested scope.
