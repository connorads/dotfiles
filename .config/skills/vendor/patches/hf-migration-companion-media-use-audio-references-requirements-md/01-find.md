## Credential & key priority

Run `npx hyperframes auth status` to see what's configured and which engines a workflow will use (see the skill's **Preflight** section). Keys resolve in this order — **first match wins**:

| Provider                         | Resolution order (first non-empty wins)                                                                                                                                    | Local deps when used                             |
