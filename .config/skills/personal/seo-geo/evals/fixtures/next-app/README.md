# rotaly-web

Marketing site for Rotaly (rota and shift scheduling for hospitality and retail teams).

## Develop

```sh
pnpm install
pnpm dev
```

## Deploy

Vercel, Git integration.

| Branch | Environment | Domain |
| --- | --- | --- |
| `main` | Production | `rotaly.io`, `www.rotaly.io` |
| `staging` | Preview (branch domain) | `staging.rotaly.io` - custom domain assigned to the `staging` branch so sales can demo upcoming pages |
| any PR | Preview | `*.vercel.app` |

Content for the blog comes from the headless CMS (see `lib/posts.ts`). Pricing comes from `/api/plans` so finance can change it without a deploy.

Launch is planned for the end of the month.
