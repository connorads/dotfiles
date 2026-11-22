rather than selecting a saved API key, with a hint to run `npx hyperframes auth refresh`
(or `auth login` for a session from another OAuth client).

```bash
# Only needed if you haven't run `npx hyperframes auth login`:
export HEYGEN_API_KEY=...   # a project .env key is used only when nothing is saved
