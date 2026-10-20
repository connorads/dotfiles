{{marker}}
For commands that need an API key, use `fnox exec -- <command>` with a credential already configured for that workload:

```sh
fnox exec -- ant models list
fnox exec -- python3 my_script.py
```

Keep existing application-managed OAuth profiles in their native store. SDKs and `ant` can use those profiles directly. Do not print tokens, evaluate credential output as shell code, or add plaintext credential exports to shell files. For raw HTTP, prefer an SDK or CLI command that consumes the existing profile. If that cannot serve the task, report the credential-delivery prerequisite rather than extracting its token. Follow the local command-credential guide before changing storage or delivery. Never request credentials in chat.
