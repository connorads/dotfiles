Use the project's actual profile name. If `--non-interactive` exposes missing first-time credentials, have the account owner complete `eas credentials -p ios` privately; repeated noninteractive retries will not complete that setup. Do not automate Apple password/MFA entry or download signing keys. Keep an existing EAS project, Apple team, bundle ID, and App Store Connect app record aligned.

`eas build --auto-submit` can submit the finished build with its matching submit profile. For separate jobs, pass the explicit build ID rather than selecting whichever unrelated build is newest.
