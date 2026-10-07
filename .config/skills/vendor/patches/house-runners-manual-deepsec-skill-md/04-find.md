| Uncommitted changes | `cd .deepsec && npx deepsec process --diff-working` |
| Diff to main | `cd .deepsec && npx deepsec process --diff origin/main` |
| Entire codebase, right after step 3 | `cd .deepsec && npx deepsec process` (the final scan from setup already produced the candidate set) |
| Entire codebase, previously onboarded | `cd .deepsec && npx deepsec scan && npx deepsec process` |
