# Cloudflare platform wiring: static Astro (assets-only Worker)

Last verified: 2026-07 (Astro 7.0.9, wrangler 4.111, pnpm 11.12). If
anything below contradicts what you observe during a bootstrap, update this
file to match reality (see "Keep references honest" in SKILL.md).

## Scaffold - skip c3 for static sites

c3 (`pnpm create cloudflare@latest --framework=astro`) force-installs the
`@astrojs/cloudflare` SSR adapter and emits an SSR-shaped `wrangler.jsonc`
(`main`, `nodejs_compat`); it has no assets-only choice. For a purely static
site use create-astro directly and hand-write the Worker config:

```bash
pnpm create astro@latest <dir> --template minimal --no-git --no-install --yes --no-ai --skip-houston
```

- `minimal` template ships `astro/tsconfigs/strict` already.
- `--no-install` then `pnpm install` separately, so quarantine failures
  surface where you can fix them (see below).
- Integrations: `pnpm astro add tailwind mdx preact --yes` is current
  (tailwind = v4 via `@tailwindcss/vite`) **but** it pins carets at
  day-fresh versions, so under quarantine it usually fails - install the
  packages yourself with slightly wider ranges and wire `astro.config.mjs`
  by hand (integration array + vite plugin + `src/styles/global.css` with
  `@import "tailwindcss"`, imported per page/layout).
- The Tailwind-on-rolldown-vite build failure (withastro/astro#16542) did
  not reproduce on astro 7.0.6 + tailwind 4.3.2; still verify `pnpm build`
  emits used utility classes into `dist/_astro/*.css`.

## Assets-only wrangler.jsonc

```jsonc
{
  "name": "<name-no-dots>",
  "compatibility_date": "<see below>",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "404-page" // serves dist/404.html on asset miss
  }
}
```

No `main`, no adapter, no `nodejs_compat`. Add `src/pages/404.astro` so the
build emits `dist/404.html`. Scripts: `"deploy": "astro build && wrangler
deploy"`, `"preview": "astro build && wrangler dev"` (wrangler dev = real
workerd, exercises 404 routing; `astro preview` doesn't).

- **compatibility_date cannot be "today"** when wrangler is
  quarantine-pinned: the bundled workerd rejects dates newer than itself
  ("newest date supported by this server binary is ..."). Use the date the
  error names, or a few days back.
- Right after `wrangler deploy`, the 404 path can briefly return Cloudflare
  `error code: 1042` (with correct 404 status) before serving `404.html` -
  transient propagation, retry before diagnosing.

## Quarantine / trust interactions (generalise beyond Astro)

- Scaffolders pin `^<latest>`; if latest is <4 days old **no version
  satisfies the range** and install fails with
  `ERR_PNPM_NO_MATURE_MATCHING_VERSION`. Widen to `^<major>.0.0` and let
  pnpm resolve the newest mature version - don't bypass the gate.
- `trustPolicy: no-downgrade` false-positives on aged backports
  (semver@6.3.1, chokidar@4.0.3). Global fix now in place:
  `trustPolicyIgnoreAfter: 525600` (1 year, minutes) in
  `~/.config/pnpm/config.yaml`; fresh publishes stay gated.
- **pnpm 11 CI hard-errors** with `ERR_PNPM_IGNORED_BUILDS` until the repo
  records a build-script decision. The key is `allowBuilds` (map, `false` =
  denied) in `pnpm-workspace.yaml` - pnpm 10's `ignoredBuiltDependencies`
  list is silently ignored. esbuild/sharp/workerd all work with scripts
  denied (binaries come via optionalDependencies).

## Lint layer (Astro-specific deviation)

Prettier + `prettier-plugin-astro` and ESLint flat config with
`eslint-plugin-astro` 3.x (`configs["flat/recommended"]` +
`configs["flat/jsx-a11y-recommended"]`, names unchanged from 2.x) instead of
Biome/Ultracite - Biome lacks full `.astro` support. eslint-plugin-astro
requires eslint >=10 while eslint-plugin-jsx-a11y's peer range still caps at
9; upstream intends the combo, so silence it in `pnpm-workspace.yaml`:

```yaml
peerDependencyRules:
  allowedVersions:
    eslint-plugin-jsx-a11y>eslint: "10"
```

Install `typescript-eslint` too and spread its `configs.recommended`:
without it the astro plugin's configs fall back to espree for `.astro`
frontmatter and TS syntax (`interface`, generics) is a parse error.
`tseslint.config()` is deprecated - compose with `defineConfig` from
`eslint/config`. Exclude `pnpm-lock.yaml` in `.prettierignore` or prettier
reformats it and fights pnpm.

Typecheck step is `astro check` (needs `@astrojs/check` + `typescript`).
**Pin `typescript` to `^6`**: bare install now resolves 7.x (the native/Go
compiler), which doesn't expose the programmatic API `astro check` needs -
it errors pointing at withastro/roadmap#1321. In `.astro` content-collection
code import `z` from `astro/zod`; the `astro:content` re-export is
deprecated in Astro 7.

## Deploy

`pnpm run deploy` with keyring OAuth (`~/Library/Preferences/.wrangler/`)
prints the workers.dev URL. Verify `/` (title) and a miss path (404 status +
custom page body). Custom domains later via the
`cloudflare-workers-deployments` skill.
