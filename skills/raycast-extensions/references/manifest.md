# Manifest (`package.json`) reference

The Raycast manifest is a **superset of npm's `package.json`**. Add `"$schema": "https://www.raycast.com/schemas/extension.json"` at the top for editor autocomplete + validation.

## Required root fields

| Field | Type | Notes |
|---|---|---|
| `name` | string | Unique, short, **kebab-case** (URL slug in the Store). |
| `title` | string | Display name (Store + Preferences + root search). Title Case. |
| `description` | string | One-sentence Store description. |
| `icon` | string | PNG **512×512** in `assets/`. Optional dark variant via `icon@dark.png`. |
| `author` | string | Your **Raycast Store handle** (not a display name/email). |
| `categories` | string[] | One+ from the fixed enum below, Title Case. |
| `license` | string | Must be `"MIT"` for the public Store. |
| `commands` | object[] | At least one. |

## Common optional root fields

`platforms` (`["macOS"]` and/or `["Windows"]` — restrict install; set accurately if you use platform-specific APIs. The docs conflict on whether it's strictly required — the manifest page marks it required, the store-prep page calls it recommended — so set it explicitly on new extensions rather than relying on a default), `preferences` (extension-wide array), `tools` (AI extensions), `ai` (object: `instructions` + `evals`, or a separate `ai.yaml`), `contributors`/`pastContributors` (Raycast handles), `keywords` (Store search), `owner` + `access` (`"public"|"private"` for org/private), `external` (package names excluded from bundling).

## Categories enum (exact values)

`Applications, Communication, Data, Documentation, Design Tools, Developer Tools, Finance, Fun, Media, News, Productivity, Security, System, Web, Other`

## `commands[]`

| Field | Req | Notes |
|---|---|---|
| `name` | yes | Maps to `src/<name>.ts(x)` **exactly** — mismatch = build failure. kebab-case. |
| `title` | yes | Root-search title. `<verb> <noun>` or `<noun>`, no articles ("Create Task"). |
| `description` | yes | |
| `mode` | yes | `"view"` (renders React UI) · `"no-view"` (async fn, no UI) · `"menu-bar"` (returns `<MenuBarExtra>`). |
| `subtitle` | no | Secondary root-search text (often the service name); omit if it dupes `title`. |
| `icon` | no | Override extension icon (512×512 PNG). |
| `interval` | no | Background refresh: `90s`/`1m`/`12h`/`1d` (**min 1m**). Requires `no-view` or `menu-bar`. |
| `keywords` | no | Extra root-search aliases. |
| `arguments` | no | Inline root-search input (max 3). |
| `preferences` | no | Command-scoped prefs (extend the extension-level ones). |
| `disabledByDefault` | no | Command not enabled on fresh install. |

## `arguments[]` (inline root-search input, ordered, max 3)

`name` (becomes a key on `LaunchProps.arguments`), `type` (`"text"|"password"|"dropdown"`), `placeholder` — all required. Optional `required` (default false). `data` (`[{ "title", "value" }]`) required for dropdown.

## `preferences[]` (extension-level or command-level)

| Field | Req | Notes |
|---|---|---|
| `name` | yes | Key on `getPreferenceValues()`. |
| `title` | yes | Section label (left column). Leave empty on subsequent prefs to group them. |
| `description` | yes | Tooltip. |
| `type` | yes | `textfield` · `password` · `checkbox` · `dropdown` · `appPicker` · `file` · `directory`. |
| `required` | yes | If true, Raycast forces the user to fill it before first run. |
| `label` | for checkbox | Text beside the box. |
| `data` | for dropdown | `[{ "title", "value" }]`. |
| `placeholder` | no | textfield/password. |
| `default` | no | string/bool/object; supports per-platform `{ "macOS": …, "Windows": … }`. |

Use preferences for **all config and credentials** (mark mandatory ones `required: true`), not extra commands. Read at runtime with `getPreferenceValues<Preferences>()` or the command-scoped `getPreferenceValues<Preferences.CommandName>()`.

## `tools[]` (AI extensions)

`name` (→ `src/tools/<name>.ts`), `title`, `description` (this is **AI-facing** — write it for the model), optional `icon`. Full detail in `ai-extensions.md`.

## Folder layout

```text
my-extension/
  package.json            # the manifest
  package-lock.json       # REQUIRED in a Store PR (CI uses npm)
  tsconfig.json
  eslint.config.js        # flat config extending @raycast/eslint-config
  raycast-env.d.ts        # AUTO-GENERATED (Preferences/Arguments types) — never hand-edit; gitignored
  CHANGELOG.md            # required for updates
  README.md              # required if setup/API keys needed
  assets/                 # icon.png (512×512) + runtime images bundled into the extension
  metadata/               # STORE SCREENSHOTS: 2000×1250 PNG (16:10), 3–6, named <ext-name>-1.png …
  media/                  # images referenced from README.md ONLY (not bundled, not store shots)
  src/
    index.tsx             # command "index"
    tools/<tool>.ts       # one file per tools[] entry
```

Keep `assets/` (runtime), `metadata/` (store screenshots), and `media/` (readme) distinct — conflating them is a frequent rejection.

## `scripts` (canonical, from real extensions)

```json
"scripts": {
  "build": "ray build -e dist",
  "dev": "ray develop",
  "lint": "ray lint",
  "fix-lint": "ray lint --fix",
  "publish": "npx @raycast/api@latest publish",
  "prepublishOnly": "echo \"Use \\`npm run publish\\`, not npm publish\" && exit 1"
}
```

The `prepublishOnly` guard blocks an accidental `npm publish` to npmjs. The `ray` binary ships as a bin of `@raycast/api`, so bare `ray …` resolves from `node_modules/.bin`.

## Dependencies (current, 2026)

```json
"dependencies": { "@raycast/api": "^1.104.6", "@raycast/utils": "^2.2.2" },
"devDependencies": {
  "@raycast/eslint-config": "^2.1.1", "@types/node": "^25.x", "@types/react": "^19.x",
  "eslint": "^10.x", "prettier": "^3.x", "react": "^19.x", "typescript": "^5.x"
}
```

React 19, ESLint 10 flat config (`eslint.config.js`, not legacy `.eslintrc`). JSX uses the automatic runtime — no `import React` needed. Pin the **latest** `@raycast/api` for Store submissions.

## CHANGELOG.md format

Newest entry at the top. The in-flight entry uses the literal `{PR_MERGE_DATE}` placeholder (Raycast substitutes the merge date):

```md
# My Extension Changelog
## [Add search filters] - {PR_MERGE_DATE}
- New filter dropdown
- Fixed crash on empty query
## [Initial version] - 2026-05-12
- First release
```

## Annotated example

```json
{
  "$schema": "https://www.raycast.com/schemas/extension.json",
  "name": "my-extension",
  "title": "My Extension",
  "description": "Search and manage things in My Service",
  "icon": "icon.png",
  "author": "your-handle",
  "categories": ["Productivity", "Developer Tools"],
  "license": "MIT",
  "platforms": ["macOS"],
  "commands": [
    {
      "name": "search",
      "title": "Search Items",
      "subtitle": "My Service",
      "description": "Search items in My Service",
      "mode": "view",
      "arguments": [
        { "name": "query", "type": "text", "placeholder": "Search term", "required": false }
      ]
    },
    {
      "name": "sync",
      "title": "Background Sync",
      "description": "Periodically syncs data",
      "mode": "no-view",
      "interval": "10m"
    }
  ],
  "preferences": [
    { "name": "apiToken", "type": "password", "title": "API Token",
      "description": "Personal access token", "required": true },
    { "name": "endpoint", "type": "textfield", "title": "API Endpoint",
      "description": "Base URL", "default": "https://api.example.com", "required": false }
  ],
  "dependencies": { "@raycast/api": "^1.104.6", "@raycast/utils": "^2.2.2" },
  "devDependencies": {
    "@raycast/eslint-config": "^2.1.1", "@types/node": "^25.3.0", "@types/react": "^19.2.0",
    "eslint": "^10.0.1", "prettier": "^3.8.1", "react": "^19.2.0", "typescript": "^5.9.0"
  },
  "scripts": {
    "build": "ray build -e dist", "dev": "ray develop",
    "lint": "ray lint", "fix-lint": "ray lint --fix",
    "publish": "npx @raycast/api@latest publish"
  }
}
```
