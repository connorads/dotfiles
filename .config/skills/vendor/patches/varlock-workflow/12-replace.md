Native integrations own their framework's loading path. Verify that missing or
invalid configuration actually stops each startup command before the child
starts serving. For Next.js setup, startup failures or deployment questions, read
[references/nextjs.md](references/nextjs.md) before changing the wiring or making
credential-rotation claims. Use `varlock run -- <cmd>` for scripts outside the
integration, such as migrations and non-JS tools.
