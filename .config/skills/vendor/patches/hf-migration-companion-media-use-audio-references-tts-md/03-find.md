(10 min/month) before paid usage; API keys follow normal API billing. If the
only credential is an expired OAuth token it stops with a hint to run
`npx hyperframes auth refresh`.

```bash
# Only needed if you haven't run `npx hyperframes auth login`:
export HEYGEN_API_KEY=...   # or put it in a project .env
