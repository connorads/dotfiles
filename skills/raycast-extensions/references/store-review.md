# Store preparation & review reference

The real review bar lives at **manual.raycast.com/extensions-guidelines** and **developers.raycast.com/basics/prepare-an-extension-for-store** — `CONTRIBUTING.md` in the repo is a thin stub that just links out.

## Publish / contribute flow

- **New extension**: scaffold ("Create Extension") → build → `npm run build` (validates + type-checks) → `npm run lint` → `npm run publish` (= `npx @raycast/api@latest publish`): authenticates via GitHub, forks/commits/squashes, opens a PR to `raycast/extensions` `main`.
- **Existing extension**: use Raycast's **"Fork Extension"** action (auto-adds you to `contributors`) → edit → add a CHANGELOG entry → `npm run publish`. As a maintainer after others' merged PRs: `npx @raycast/api@latest pull-contributions` before republishing.
- **Org / private**: `npm run publish` goes to the org's private store (no public PR).
- **Lockfile / package manager**: Store CI uses **npm** — commit `package-lock.json`, not `pnpm-lock.yaml`/`yarn.lock`. `pnpm publish` is a built-in that targets the npm registry; use `pnpm run publish` (explicit `run`) if working in pnpm locally.

## Review timeline

Human review by Community Managers, FIFO, first contact ~within a week. PRs go **stale after 14 days** of inactivity and **close after 21** — respond promptly. Open-source MIT is mandatory (review relies on readable source). Post-merge, the author owns ongoing support.

## Asset specs (exact)

- **Icon**: 512×512 PNG in `assets/`, legible in **both** light and dark themes (dark variant via `icon@dark.png`, referenced with the `@dark` suffix). The default Raycast icon → rejection. Generate at icon.ray.so.
- **Screenshots** (`metadata/`): up to **6** (3+ recommended), exactly **2000×1250 PNG (16:10)**, consistent background, no sensitive data or other apps' UI. Filenames `<ext-name>-1.png` … Capture via the dev "Window Capture" with "Save to Metadata".
- **Categories**: ≥1, Title Case, from the fixed enum (Applications, Communication, Data, Documentation, Design Tools, Developer Tools, Finance, Fun, Media, News, Productivity, Security, System, Web, Other).

## Naming (Apple Style Guide title case)

- **Extension `title`**: Title Case, noun-first ("Emoji Search", not "Search Emoji"); avoid generic names. Bad: "Hacker news", "my issues".
- **`name` / command `name` / tool `name`**: kebab-case, unique, maps to a real `src/` file.
- **Command `title`**: `<verb> <noun>` or `<noun>`, no articles ("Create Task", "Search Recent Projects").
- **Action titles**: Title Case. **US English spelling only** (color, not colour). Restricted words like "Assistant" aren't allowed in names.

---

## REVIEW CHECKLIST

Apply top to bottom against an existing extension.

## Manifest / metadata

- [ ] `license: "MIT"` present
- [ ] `author` is a valid Raycast handle; `contributors` includes any new contributor
- [ ] `name` + every command/tool `name` are kebab-case, unique, and map to a real `src/` file
- [ ] `title` Title Case, noun-first, non-generic; command titles `<verb> <noun>`, no articles
- [ ] `description` is one clear sentence; every command has a description
- [ ] ≥1 `categories`, Title Case, from the allowed set
- [ ] `platforms` accurate if platform-specific APIs are used
- [ ] latest `@raycast/api`

## Assets

- [ ] `icon.png` 512×512 PNG, not the default, legible in light + dark (or `@dark` variant)
- [ ] `metadata/` screenshots 2000×1250 PNG, 3–6, consistent bg, no sensitive data / other apps
- [ ] unused assets removed

## Docs

- [ ] `README.md` present if setup/API keys are needed (steps + where to get creds)
- [ ] `CHANGELOG.md` updated: newest at top, `## [Title] - {PR_MERGE_DATE}`, bullet points

## Code / UX

- [ ] `package-lock.json` committed (npm — not pnpm/yarn)
- [ ] `npm run build` (type-check + dist) passes and `npm run lint` is clean
- [ ] credentials/config via the preferences API; mandatory ones `required: true`; text fields have placeholders
- [ ] data fetched via `@raycast/utils` hooks, not hand-rolled `useEffect` + `fetch`
- [ ] `isLoading` wired into the top-level view; `EmptyView` gated on loading
- [ ] errors handled (`showFailureToast` / Failure toast), not left to throw a red screen
- [ ] navigation via `useNavigation`/`Action.Push`, not a custom stack
- [ ] config via preferences, not extra commands
- [ ] actions use Title Case; if any action has an icon, all do
- [ ] US English spelling throughout

## Security / policy

- [ ] no Keychain access (auto-reject)
- [ ] no secrets in source — `password` preferences or OAuth only
- [ ] no external analytics/telemetry; collected data used only to make the connection work
- [ ] binaries only from a trusted server you DON'T control, with an integrity hash; no opaque/heavy bundled binaries
- [ ] complies with the third-party service's ToS (no unauthorised scraping)
- [ ] brings unique value — not duplicating a native Raycast feature (Quicklinks, Snippets, Clipboard History, Calculator) or an existing extension / open PR (prefer contributing to the existing one)
- [ ] AI tools that mutate/delete export a `confirmation` (see `ai-extensions.md`)

## Highest-frequency rejection causes

1. Default icon, or one invisible in light or dark theme.
2. Screenshots wrong size (must be exactly 2000×1250), too few, or with sensitive/other-app content.
3. `license` not MIT.
4. Verb-first or generic extension title.
5. Secrets in source / Keychain access.
6. Hand-rolled fetch instead of the hooks.
7. Missing or misformatted `CHANGELOG.md` (hardcoded date instead of `{PR_MERGE_DATE}`).
8. `pnpm-lock.yaml`/`yarn.lock` committed instead of `package-lock.json`.
9. Duplicating native features or an existing extension.
10. British spelling instead of US English.
