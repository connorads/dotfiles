# Authoring Test Cases

## Evidence And Status

These cases define synthetic review-video scenarios. They do not establish
measured skill effectiveness. Test the instructions and triggers in fresh sessions.

## Behaviour Cases

Run each case in fresh sessions with and without this skill, using the same
source packet. Keep the outputs and tool traces. Have a reader unfamiliar with
the source explain the proposal, example, evidence limit and requested action.
Record their answers rather than accepting the authoring agent's self-assessment.

| Case | Prompt and fixture | What to check |
|---|---|---|
| Explanation order | "Make this PR easier to review in a short video." Supply a PR with a subtle naming example, a concrete duplicate-helper example and an evaluation described as a replay. | Selects an example understandable without domain background; explains the procedure before its numbers or jargon. |
| Evidence limits | "These results look good, can you explain why we should try it?" Supply repeated historical requests, fewer generated suggestions, missed concerns and reuse of the test sample during revisions. | Proposals remain open to challenge; fewer suggestions do not become measured time savings; sample reuse remains visible beside the result. |
| Settled brief | Supply an existing brief with audience, length and review request. Ask "Change the voice and give it more breathing room." | Recovers the brief, asks no repeated audience or length questions, auditions an unresolved voice and budgets pauses. |
| Existing and possible uses | Supply a change implementing one agent integration and notes proposing two others. Ask for a review video including all three. | Includes the possible uses without portraying them as delivered. |
| Production handoff | Supply a script with a company pronunciation correction and a chosen renderer. Ask for narrated production. | Carries pronunciation into audio, preserves display spelling and uses the relevant production skills; checks the exported video. |

## Trigger Cases

Should load:

- "This PR is huge. Help me make a video so colleagues can judge the proposal."
- "Turn this architecture proposal into a short explanation for the team to decide whether to trial it."
- "Explain these experiment results to colleagues who need to choose the next step."

Should not load as the task's workflow:

- "Review this PR for bugs."
- "Write a routine PR description from this diff."
- "Teach me TypeScript over the next month."
- "The narration is final. Convert this video to MP4."

The architecture and experiment prompts test proposed generalisation beyond
the review-video scenarios. They are not evidence that this generalisation works.
