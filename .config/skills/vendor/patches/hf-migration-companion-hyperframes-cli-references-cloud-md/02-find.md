
```bash
npx hyperframes auth login              # OAuth 2.0 + PKCE, opens the browser
npx hyperframes auth login --api-key    # CI/headless: hidden prompt, or pipe: echo "$HEYGEN_API_KEY" | ... --api-key
npx hyperframes auth status             # active credential source, identity, billing snapshot
                                        #   exit 0 = signed in and verified; exit 1 = not signed in,
                                        #   or the credential was rejected — signed-out exit 1 is the
                                        #   normal offline state (scripts: `auth status || echo offline`),
                                        #   not a command failure
npx hyperframes auth refresh            # force-refresh an OAuth token before a long job
npx hyperframes auth logout             # clear the stored credential
```
