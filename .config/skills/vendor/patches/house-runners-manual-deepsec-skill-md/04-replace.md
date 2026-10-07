| Uncommitted changes | `cd .deepsec && deepsec process --diff-working` |
| Diff to main | `cd .deepsec && deepsec process --diff origin/main` |
| Entire codebase, right after step 3 | `cd .deepsec && deepsec process` (the final scan from setup already produced the candidate set) |
| Entire codebase, previously onboarded | `cd .deepsec && deepsec scan && deepsec process` |
