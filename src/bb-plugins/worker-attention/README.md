# Worker Attention

Alerts you when a hidden workflow worker is waiting for tool approval.

BB spawns workflow workers as hidden threads with a lifecycle owner and no parent. Their approval prompts reach nobody: push notifications skip hidden threads, the child-needs-attention notice needs a parent, and the run keeps showing "running". See [Workflow worker approvals reach nobody](../docs/sdk-frictions.md#workflow-worker-approvals-reach-nobody).

On `interaction.pending`, for an approval on a hidden thread whose `originPluginId` is `workflows` and that has a lifecycle owner, the plugin:

1. sends a push notification (title "Workflow worker needs approval", body "worker: command"), linked to the worker thread;
2. sends a message to the owner thread naming the worker and the command, so the coordinating agent tells you.

It never approves or denies anything. Visible threads are left to BB's own notifications.

## Develop

```sh
pnpm test        # decision rules in src/decide.ts
pnpm typecheck
pnpm build
```

The decision is a pure function in [src/decide.ts](src/decide.ts); [server.ts](server.ts) only wires the event to the two sends.
