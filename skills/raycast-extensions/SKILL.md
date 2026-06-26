---
name: raycast-extensions
description: Build, maintain, and review Raycast extensions (the @raycast/api / TypeScript apps published to github.com/raycast/extensions). Use whenever the user mentions a Raycast extension, command, or tool; the @raycast/api or @raycast/utils packages; List/Detail/Form/ActionPanel/MenuBarExtra UI; useCachedPromise/useFetch/useForm hooks; getPreferenceValues; the ray CLI (ray develop/build/lint/evals); an AI extension or AI tools; preparing/publishing an extension to the Raycast Store; or reviewing an existing extension against store guidelines. Also use for "scaffold a Raycast command", "my Raycast extension errors", "fix the manifest", "add a preference", "add an OAuth login", or porting a CLI/app idea to Raycast — even if they don't say "@raycast/api" explicitly.
---

# Raycast Extensions

Build new Raycast extensions, extend or fix existing ones, and review them against the Raycast Store guidelines — using current `@raycast/api` (v1.10x), `@raycast/utils` (v2.x), React 19, TypeScript, and ESLint 10 flat config.

## Operating rules

- **Prefer official docs when uncertain**: developers.raycast.com (API + guides) and manual.raycast.com/extensions-guidelines (the real review bar). Imitate real extensions in `github.com/raycast/extensions` — `CONTRIBUTING.md` is a thin stub; the conventions live in the source and the docs.
- **Use the `@raycast/utils` hooks for all data fetching** — never hand-roll `useEffect` + `fetch` + `useState`. The hooks give `isLoading`, error toasts, caching, abort, `revalidate`, `mutate`, and pagination for free, and reviewers reject the hand-rolled version.
- **Don't reinvent the framework**: use the preferences API for config (not extra commands), `useNavigation`/`Action.Push` for navigation (not a custom stack), and `showFailureToast` for errors (not bespoke failure toasts). These are explicit store-review rules.
- **Secrets never go in source**: use `password`-type preferences or OAuth (`OAuthService`). Hardcoded keys or Keychain access are auto-rejected.
- This skill covers the framework, not any one service's API. When wiring a third-party API, confirm its current endpoints/SDK rather than guessing.

## First, decide which mode you're in

1. **New extension** — scaffold from a template, then build commands. Start at *Build workflow*.
2. **Extend / fix an existing one** — read the extension's existing structure first and match its conventions (its client singleton, its hooks/, its error helper). Add a CHANGELOG entry. Don't impose a different architecture.
3. **Review an existing extension** (for store-readiness or a PR) — go to *Review workflow* and apply `references/store-review.md`.

If the user's intent is ambiguous (e.g. "help with my Raycast extension"), ask which of these it is before diving in.

## Reference map — read the relevant file, don't load everything

The SKILL.md is the spine. Pull in a reference when the task touches it:

| Read this | When |
|---|---|
| `references/manifest.md` | Writing/auditing `package.json`: commands, modes, preferences, arguments, tools, categories, icons, folder layout. Has a full annotated example. |
| `references/api-and-hooks.md` | Writing command code: List/Detail/Form/Grid, ActionPanel/Action, navigation, feedback (toast/HUD/alert), storage/cache/clipboard, MenuBarExtra, and every `@raycast/utils` hook (useCachedPromise, useFetch, useForm, useExec, useSQL, OAuth). |
| `references/ai-extensions.md` | Anything with AI tools: `src/tools/`, the `Input` type + JSDoc, `confirmation`, the `ai` config, evals (`ray evals`), or `AI.ask` inside a command. |
| `references/store-review.md` | Preparing for the Store, reviewing an extension/PR, or any "is this store-ready?" question. Contains the full review checklist + asset specs. |

## Quick intake (new extension)

Before scaffolding, settle:

- **What it does** and the **commands** it needs — each command is one entry point. For each: a `view` (renders UI), `no-view` (fire-and-forget action, feedback via `showHUD`), or `menu-bar` (`MenuBarExtra`) command?
- **Does the AI need to call it?** If a discrete data fetch/mutation would be useful to Raycast AI, expose it as a **tool** (`src/tools/`) in addition to or instead of a command. See `references/ai-extensions.md`.
- **Config**: API tokens (→ `password` preference or OAuth), tunables (→ `textfield`/`checkbox`/`dropdown` preferences). Per-run input that belongs in root search → `arguments` (max 3).
- **Data source**: REST (`useFetch`), arbitrary async/SDK (`useCachedPromise`), local CLI (`useExec`), local SQLite (`useSQL`).
- **Platforms**: macOS only, or macOS + Windows? (Affects `platforms` and which APIs you can use — `runAppleScript` is macOS-only.)

## Build workflow

### 1) Scaffold

Preferred: Raycast's in-app **"Create Extension"** command (pick a template: Detail / List / Grid / Form / Menu Bar; it wires up eslint + tsconfig). CLI alternative: `npm init raycast-extension -t <template>`. Then `npm install`.

Requires Raycast 1.26+, a current Node (the `@raycast/api` `engines` field tracks the latest LTS — 22.22+ at the time of writing, so use Node 22 LTS or newer), and being signed into Raycast.

### 2) Manifest (`package.json`)

This is where most mistakes live. Get the structure right from `references/manifest.md`. The essentials:

- Required root: `name` (kebab-case slug), `title` (Title Case display), `description`, `icon` (512×512 PNG in `assets/`), `author` (Raycast handle), `categories` (Title Case enum), `license: "MIT"`, `commands[]`. Add `"$schema": "https://www.raycast.com/schemas/extension.json"` for editor validation.
- Each command `name` maps to `src/<name>.ts(x)` exactly, or the build fails.
- Folder layout matters and trips people up: `assets/` = bundled runtime icons; `metadata/` = Store screenshots (2000×1250 PNG); `media/` = README images only. Don't conflate them.

### 3) Command code

- **View command** = a default-exported React component that returns `<List>`/`<Detail>`/`<Form>`/`<Grid>`. **No-view** = a default-exported `async function`. **Menu-bar** = a component returning `<MenuBarExtra>`.
- **Data layer**: reach for the right hook (see table in intake). Wire its `isLoading` into the top-level view and its `pagination` into `<List pagination>`. Put changing inputs in the hook's `args` array — that array is the cache key *and* the deps.
- **Writes/mutations**: use the hook's `mutate` with an `optimisticUpdate` and an Animated→Success/Failure toast, inside try/catch.
- **Errors**: `import { showFailureToast } from "@raycast/utils"` in every catch. For no-view commands use `showHUD` (it survives the window closing); `showToast` disappears with the window.
- **Preferences**: `getPreferenceValues<Preferences>()` (types auto-generated into `raycast-env.d.ts` — never edit that file by hand).
- Full primitives and hook signatures: `references/api-and-hooks.md`.

### 4) Architecture (only as it grows)

A single-command extension stays flat: `src/index.tsx`, maybe `api.ts`, `types.ts`, `preferences.ts`. Once multiple commands share logic, adopt the convention the big extensions (`github`, `linear`) converge on:

```text
src/
  <command>.tsx        # one per manifest command; default export
  api/                 # client singleton + raw data fns (getXClient() that throws if uninit)
  hooks/               # use*.ts wrappers over useCachedPromise that call getXClient()
  helpers/             # pure fns: errors.ts (getErrorMessage), icons.ts, dates.ts
  components/          # shared List.Item / Form / actions pieces
  tools/               # one file per AI tool (if any)
  types.ts
```

The dominant auth pattern: an `OAuthService` + a module-level client in `api/`, wrapped with `withAccessToken(service)` (from `@raycast/utils`) on each command's default export and on each tool. Only call `getXClient()` *inside* a wrapped component/hook/tool — at module top level it throws before auth runs. See `references/api-and-hooks.md` (OAuth section).

### 5) Verify before declaring done

Run, in order:

```bash
npm run lint        # ray lint  (add --fix to autofix)
npm run build       # ray build -e dist — does a full TypeScript type-check the dev build skips
npm run dev         # ray develop — imports into Raycast with hot reload; actually exercise the command
```

`ray build` catches type errors that `ray develop` lets slide, so always run it before you consider a change finished. Then open the command in Raycast and verify the real behaviour — loading state, empty state, the happy path, and at least one error path.

## Review / maintain workflow

When reviewing an existing extension (store-readiness, a PR, or "why is this rejected?"):

1. Read `references/store-review.md` and apply its **review checklist** top to bottom.
2. Run `ray lint` and `ray build -e dist` — these catch a large fraction of review blockers mechanically.
3. Check the high-frequency rejection causes first: default/dark-mode-broken icon; wrong screenshot size; `license` not MIT; verb-first or generic title; secrets in source / Keychain access; hand-rolled fetch instead of the hooks; missing or misformatted `CHANGELOG.md`.
4. For a fix to someone else's extension: add yourself to `contributors`, add a CHANGELOG entry (`## [Title] - {PR_MERGE_DATE}` at the top), and keep the diff minimal and on-convention.

## Publishing

Canonical commands are the `ray`-backed package scripts: `npm run build`, then `npm run publish` (= `npx @raycast/api@latest publish`), which opens a PR against `raycast/extensions`. Two things to flag:

- **Store PRs require npm + a committed `package-lock.json`.** The CI uses npm; a `pnpm-lock.yaml`/`yarn.lock` in the PR gets it rejected. So even if local dev uses pnpm, generate the lockfile with npm for a Store-bound submission, and surface this to the user before committing a lockfile.
- **`pnpm publish` is a built-in pnpm command** that publishes to the npm registry — it does *not* run Raycast's `publish` script. If using pnpm locally, invoke `pnpm run publish` (explicit `run`) or `pnpm dlx @raycast/api@latest publish`. The `prepublishOnly: "... && exit 1"` guard in the manifest exists precisely to stop an accidental `npm publish` to npmjs.

For org/private extensions, `npm run publish` goes to the org's private store (no public PR).

## High-value pitfalls (the why behind the rules)

- **`onSearchTextChange` silently disables built-in `filtering`.** Once you handle search text yourself, the list stops filtering — either implement server-side search or re-enable `filtering`. Add `throttle` if `onSearchTextChange` does network calls, or you fire a request per keystroke.
- **Action order is UX.** The first `Action` is the primary (Enter) action. Put a destructive action first and Enter deletes. Mark destructive actions with `style: Action.Style.Destructive` and order deliberately. In `Form`, primary submit is ⌘↵ (Enter inserts a newline), so `Action.SubmitForm` should be first.
- **`LocalStorage` is async, `Cache` is sync and string-only.** Prefer the `useLocalStorage` / `useCachedState` hooks over touching them directly; never store secrets in `Cache`.
- **AI tool `Input` JSDoc is the model's prompt.** The tool's argument schema is derived from a type named exactly `Input`; the JSDoc on each field is what the model reads to choose arguments. Thin descriptions cause wrong calls. Every mutating tool needs an exported `confirmation`.
- **`{PR_MERGE_DATE}` is a literal placeholder**, not a date you fill in — Raycast substitutes the merge date. Hardcoding a date is a common review nit.

---

When you finish a build or a review, state plainly what you verified (lint/build clean, command exercised in Raycast, which paths you checked) rather than asserting it works untested.
