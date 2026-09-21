---
name: varlock
description: >-
  Guides adopting, configuring and debugging Varlock environment management.
  Use for .env.schema, Varlock CLI commands, secret-provider plugins, dotenv
  migrations to Varlock and Varlock framework integrations. Not for general
  credential handling or authentication work unrelated to Varlock.
license: See LICENSE
---

# Varlock

Use Varlock to define, validate and load project environment configuration.

<!-- LOCAL PATCH (connorads dotfiles): Use reviewed skill installs, protected diagnostics and verified framework checks -->

Use the target project's existing package manager and hooks. This reviewed skill
is maintained through the catalogue's vendor-and-patch workflow; task-time skill
installation or refresh must not replace it. `evals/` contains evaluation prompts
and results, not runtime instructions.

> **Docs**: https://varlock.dev
> **Repo**: https://github.com/dmno-dev/varlock

Varlock uses `.env.schema` (instead of `.env.example`) to provide a single source of truth for your project's env vars. Schema info is expressed using `@decorator` style comments. Sensitive values can be set in git-ignored `.env.local` files, passed in via the environment, or use functions to load from secure backends like 1Password, Vault, AWS, etc.

Basic `.env.schema` example:
```env-spec
# @defaultSensitive=false @defaultRequired=infer
# @currentEnv=$APP_ENV
# @generateTsTypes(path=env.d.ts)
# ---

# @type=enum(dev, staging, prod)
APP_ENV=dev

# @type=url
API_URL=https://api.example.com

# Description of this var
# @sensitive @required @type=string(startsWith=sk-)
# @docs(https://xyzapi.com/docs/auth)
XYZ_API_KEY=
```

Keep `.env.schema` limited to schema, non-secret defaults and provider references.
A filename or Git tracking status does not establish that a file contains no
secrets. Use `varlock load --agent` for diagnostics; redaction depends on correct
sensitivity metadata. The child process still receives resolved secrets.

**Invocation:** For a pnpm dependency, use `pnpm exec varlock <command>`; package
scripts can use `varlock` directly. Use `bun run varlock <command>` only in an
existing Bun project. Use `pnpm` for package installation, never `npm` or `npx`.
Bare commands below assume a verified standalone binary or package-script PATH.

## CRITICAL: Security rules

These rules are non-negotiable:

### Do not expose secrets

```bash
# NEVER do these - exposes secrets to agent context
cat .env
cat .env.local
echo $SECRET_KEY
printenv | grep API

# Agent diagnostics
varlock load --agent    # JSON output, sensitive values redacted
# Read schema content only when established to contain no secret values.
```

If the user needs to see a sensitive value, tell them to run `varlock reveal VAR_NAME`.

### File access rules

- **Read and edit:** schema and non-secret configuration only when its contents
  are established as non-secret. Committed `.env` files can contain credentials;
  do not dump them into agent context. Use redacted diagnostics for unknown files.
- **Do not read or edit:** `.env`, `.env.local`, `.env.[env].local`, or other gitignored value/override files — these may contain unencrypted secrets
- **Do not log or quote** raw secret values in code, comments, or chat

### Sensitivity rules

- Items marked `@sensitive` must not have that decorator removed without confirming with the user
- Ask the user to edit secret values in their local/gitignored env files or their secret provider (1Password, AWS, etc.) — never fill in secrets yourself

### When the user asks to "show me the .env file"

Use `varlock load --agent` to inspect redacted configuration. Do not display
value files, including tracked environment files, to answer this request.

### When the user asks to "update/set a secret"

Do not write secret values yourself. Tell the user to either:
1. Update it in their secret provider (1Password, AWS, etc.) and then help them wire it up
2. Edit the value in their `.env.local` file manually
  - ideally encrypt it by using `varlock(prompt)` as the value, then run `varlock load` to be prompted

Then run `varlock load --agent` to validate.

## File roles

| File | Role | Agent may edit? |
|------|------|-----------------|
| `.env.schema` | Schema, defaults, decorators, descriptions | Only established non-secret content |
| `.env.[env]` | Environment-specific tracked config (e.g. `.env.production`) | Only established non-secret content |
| `.env`, `.env.local` | Local/gitignored values and overrides | No — tell user to edit |
| `.env.[env].local` | Environment-specific local overrides (gitignored) | No — tell user to edit |
| `.env.example` | Legacy example file; migrate into schema | Review with user |

Ensure `.env.schema` and tracked env-specific files are not gitignored (`!.env.schema`, `!.env.production`, etc. in `.gitignore` if needed).

### Environment-specific files and precedence

When `@currentEnv` is set in `.env.schema` (e.g., `@currentEnv=$APP_ENV`), varlock automatically loads matching environment-specific files. Files are applied in increasing precedence order:

`.env.schema` < `.env` < `.env.local` < `.env.[currentEnv]` < `.env.[currentEnv].local` < `process.env`

For example, if `APP_ENV=staging`, then `.env.staging` and `.env.staging.local` will be loaded automatically if they exist. A value in `.env.local` overrides one in `.env.schema`, and `process.env` always wins.

A bare `KEY=` sets no value at all, so it does not override a value from a lower-precedence file. Use `KEY=""` to override with an empty string.

## Schema syntax

### Root decorators (file header)

Root decorators go in comment blocks at the top of the file, before the first item. A `# ---` divider usually separates the header from items.

| Decorator | Purpose | If absent |
|-----------|---------|-----------|
| `@currentEnv=$VAR` | Sets which item determines the active environment | — |
| `@defaultRequired=bool\|infer` | Default required state for items in this file | `true` |
| `@defaultSensitive=bool\|inferFromPrefix(PREFIX)` | Default sensitive state for items in this file | `true` |
| `@generateTsTypes(path=./env.d.ts)` | Auto-generate TypeScript env declarations (deprecated alias: `@generateTypes(lang=ts)`) | — |
| `@generatePythonEnv` / `@generateRustEnv` / `@generateGoEnv` / `@generatePhpEnv` / `@generateJavaEnv` / `@generateCsharpEnv` `(path=...)` | Generate a typed env module for that language | — |
| `@import(path, ...keys?)` | Import schema/values from another .env file or directory | — |
| `@plugin(@varlock/name-plugin)` | Load a plugin | — |
| `@setValuesBulk(resolver)` | Inject multiple values from an external source | — |
| `@disable` | Disable loading this file (can use `=forEnv(test)`) | `false` |

- `@defaultSensitive` defaults to `true` — all items are sensitive unless explicitly marked `@public` or `@sensitive=false`. Set `@defaultSensitive=false` to flip the default.
- `@defaultRequired=infer`: items with a value in the schema are required, items without are optional. Without this decorator, items default to required
- `varlock init` writes `@defaultRequired=infer` and `@defaultSensitive=false` into the schema it generates, so most existing projects run with those rather than the absent-decorator behavior. Read the file header before assuming either
- Item defaults (`@defaultRequired`, `@defaultSensitive`) only apply to items defined in the same file. An item defined only in a `.env.local` or an imported file falls back to the built-in defaults (required, sensitive), no matter what the root schema sets
- `@defaultSensitive=inferFromPrefix(PUBLIC_)`: items with keys starting with `PUBLIC_` are not sensitive, all others are
- `@import()` accepts `enabled=expr` for conditional imports and `allowMissing=true` for optional imports

### Item decorators

Decorators in comment lines directly preceding a config item are attached to that item. A blank line breaks the association.

| Decorator | Purpose |
|-----------|---------|
| `@required` / `@optional` | Override default required state |
| `@sensitive` / `@public` | Override default sensitive state |
| `@type=dataType` | Set validation/coercion type |
| `@example="value"` | Example value (for docs, not used at runtime) |
| `@docs(url)` or `@docs(label, url)` | Link to related documentation (can be used multiple times) |
| `@icon=collection:name` | Iconify icon ID for generated docs |
| `@auditIgnore` | Suppress "unused in code" warning from `varlock audit` |

Decorator values can use resolver functions: `@required=forEnv(prod)`, `@sensitive=not(forEnv(dev))`.

### Common data types (`@type=`)

`string(startsWith=X)`, `string(matches=regex("^pattern$"))`, `number`, `boolean`, `url`, `email`, `port`, `enum(a, b, c)`, `ipAddress`, `semver`

Plain `string` is the default — do not add `@type=string`, just omit `@type` entirely. Only use `@type` when you need a specific type or string constraints. See https://varlock.dev/reference/data-types/

### Resolver functions (values)

Instead of static values, items can use resolver functions:

```env-spec
# Reference another item ($VAR and ${VAR} are shorthand for ref(VAR))
FULL_URL=${API_URL}/v2/users

# Execute a CLI command
SECRET=exec(`op read "op://vault/item/field"`)

# Conditional logic
API_URL=if(eq($APP_ENV, prod), https://api.example.com, http://localhost:3000)

# First non-empty value
FALLBACK_VAR=fallback($PRIMARY, $SECONDARY, "default")

# Map one value to another
APP_ENV=remap($CI_BRANCH, "main", production, regex(".*"), preview, undefined, development)

# Check environment (based on @currentEnv)
# @required=forEnv(prod, staging)
PROD_ONLY_KEY=
```

Key functions: `ref()`, `concat()`, `exec()`, `fallback()`, `if()`, `eq()`, `not()`, `isEmpty()`, `ifs()`, `remap()`, `forEnv()`

See https://varlock.dev/reference/functions/

## Setting sensitive values

There are two main approaches — they can be used together.

### Approach 1: Plugins (version-controlled secret references)

Varlock plugins let you declaratively reference secrets from external providers directly in your `.env.schema`. The references are safe to commit — actual values are fetched at load time.

```env-spec title=".env.schema"
# @plugin(@varlock/1password-plugin)
# @initOp(token=$OP_TOKEN, allowAppAuth=forEnv(dev))
# ---
# @sensitive @type=opServiceAccountToken
OP_TOKEN=
# @sensitive
MY_SECRET=op(op://my-vault/item-name/field-name)
```

Each plugin provides its own resolver functions (e.g., `op()` for 1Password, `awsSecret()` for AWS). See [Plugins](#plugins) below for the full list and https://varlock.dev/guides/plugins/ for setup details.

### Approach 2: Local encryption with `varlock()` (git-ignored files)

For secrets stored locally in git-ignored files like `.env.local`, use the `varlock()` function for device-local encryption so nothing is stored in plaintext:

```env-spec title=".env.local"
# Encrypted value — decrypted automatically at load time
API_KEY=varlock("local:<encrypted-payload>")

# Prompt mode — on next `varlock load`, user is prompted to enter the value
# which is encrypted and written back to this file automatically
NEW_SECRET=varlock(prompt)
```

**How to encrypt values:**
- **Interactive prompt:** Set the value to `varlock(prompt)` and run `varlock load` — the user will be prompted securely, and the encrypted value replaces the placeholder automatically
- **Encrypt in bulk:** `varlock encrypt --file .env.local` encrypts all sensitive plaintext values in-place
- **Encrypt a single value:** `varlock encrypt` prompts for a value and prints the encrypted result to copy/paste
- **Pipe via stdin:** To encrypt a value without exposing it in your context (e.g., a generated key or a value read from another tool), pipe it into `varlock encrypt`:
  ```bash
  some-cli-that-outputs-secret | varlock encrypt
  # prints: SOME_SENSITIVE_KEY=varlock("local:<encrypted>")
  ```
  This keeps the plaintext secret out of shell history and agent context.

Encryption is hardware-backed on macOS (Secure Enclave + Touch ID), Windows (DPAPI + Windows Hello), and Linux (TPM2), with a file-based fallback on all platforms. On macOS, `keychain()` is also available as a built-in alternative that stores values in the system keychain.

See https://varlock.dev/guides/local-encryption/

## Organization

Inspect manifests, workspace configuration and entry points before designing the env layout. Ask only about requirements the repository cannot establish.

**Single project:** one `.env.schema` at the repo root is usually enough.

**Monorepo / multi-app:** use `@import()` to share common config:

```env-spec title="apps/web/.env.schema"
# Import shared config from root (directory form: also loads root .env / .env.local)
# @import(../../)
# Import from a sibling service (specific keys only)
# @import(../api/.env.schema, pick=[SHARED_API_URL, SHARED_DB_HOST])
# ---
APP_PUBLIC_URL=http://localhost:3000
```

- **Root schema** — shared service URLs, org-wide defaults, common keys
- **Per-app schemas** — app-specific items, importing what they need from root/siblings
- Keep imports explicit; avoid circular imports

Discuss with the user: which values belong at the root vs per-package, which environments they use.

See https://varlock.dev/guides/import/

## Plugins

Plugins add resolver functions, data types, and decorators for external secret providers. Install with `@plugin()` in your `.env.schema`:

```env-spec
# @plugin(@varlock/1password-plugin)
```

Install provider plugins through the project's package manager with pinned,
reviewed versions and existing install-script protections. The standalone plugin
downloader is a separate acquisition path; a version pin does not apply the
package manager's quarantine or integrity checks. Do not silently fall back to it.

**Available plugins:** 1Password, AWS Secrets Manager, Azure Key Vault, Bitwarden, Dashlane, Doppler, Google Secret Manager, HashiCorp Vault, Infisical, Akeyless, KeePass, Keeper, Passbolt, Proton Pass, Pass, macOS Keychain (built-in).

See https://varlock.dev/plugins/overview/ for setup details for each plugin.

## Integrations (frameworks / runtimes)

Pick the official integration for the project's framework — do not guess. Check https://varlock.dev/integrations/overview/ for the specific guide (Next.js, Vite, Astro, SvelteKit, Bun, Cloudflare, Expo, etc.).

Typical steps:
1. Confirm `varlock` is installed using its package manifest and `varlock --version`; `init` changes files
2. Follow the integration guide for build/dev wiring, generated types, and any required config
3. Prefer the integration's recommended entry point (`varlock/auto-load`, Vite plugin, etc.) over ad-hoc `process.env` usage

Native integrations own their framework's loading path. Verify that missing or
invalid configuration actually stops each startup command before the child
starts serving. For Next.js setup, startup failures or deployment questions, read
[references/nextjs.md](references/nextjs.md) before changing the wiring or making
credential-rotation claims. Use `varlock run -- <cmd>` for scripts outside the
integration, such as migrations and non-JS tools.

**Migrating from dotenv:** replace `dotenv/config` or `dotenvx run` with the varlock equivalent — see https://varlock.dev/guides/migrate-from-dotenv/

**Non-JS apps/services:** use `varlock run -- <cmd>` to inject configuration.
Raw `load` output in shell, env or JSON formats can contain secrets; do not capture
it in agent context. Piped output redaction does not establish TTY redaction or
isolation from the child. See https://varlock.dev/integrations/other-languages/

## Setup

**Installing varlock:**
- **JS projects:** Pin the reviewed version with `pnpm add --save-exact varlock@<version>`.
  Add `-D` only when production execution does not import or invoke the package.
  Use the existing Bun equivalent only in a Bun project. Keep install-script
  protections enabled.
- **Standalone binary (non-JS or global use):** See https://varlock.dev/getting-started/installation/

**Getting started:**
1. Run `varlock init --agent` to auto-generate an initial `.env.schema` from existing `.env` / `.env.example` files
2. Review the generated schema with the user — init heuristics are a draft, not final
3. Use the reviewed catalogue copy. When project adoption is requested and `skl`
   is available, run `skl install vendor/varlock` from that repository to copy the
   patched bytes. An explicit request to refresh this skill belongs to the
   catalogue's reviewed vendoring workflow, not an upstream self-update command.

## Schema checklist

After init or when editing `.env.schema`:

1. Review auto-generated items — heuristics are not final
2. Add description comments where names are not self-explanatory
3. Set `@type` only when not a plain string (omit `@type=string`)
4. Mark `@required` / `@optional` as needed (or adjust root `@defaultRequired`)
5. Confirm `@sensitive` on secrets, keys, tokens, and credentials with the user
6. Move useful values to `@example`; delete dummy placeholders
7. Add `@docs()` links where helpful
8. Remove redundant values from other `.env` files after defaults move into the schema

## Validation loop

After schema changes:

```bash
varlock load --agent
```

Fix schema and tracked env files based on validation errors. Do not patch gitignored `.local` value files to silence schema errors — ask the user to update secrets locally.

## CLI quick reference

Run `varlock --help` or `varlock <command> --help` for full flags and options.

| Command | Use when |
|---------|----------|
| `varlock init --agent` | Setting up varlock non-interactively |
| `varlock load --agent` | Validating config safely (JSON, sensitive values redacted) |
| `varlock load` | Showing human-readable validation to the user |
| `varlock run -- <cmd>` | Injecting resolved env into a process |
| `varlock printenv VAR_NAME` | Raw value output; keep sensitive values out of agent context |
| `varlock reveal` | Securely view/copy a sensitive value |
| `varlock encrypt` | Encrypt values (single or `--file` for bulk) |
| `varlock scan` | Optional known-value scan; verify staged-content and output-redaction behaviour before agent or hook use |
| `varlock audit` | Detect drift between schema and code usage |
| `varlock codegen` | Explicitly trigger code generation from schema (usually triggered automatically; `typegen` is a deprecated alias) |
| `varlock lock` | Lock biometric session (requires re-auth on next decrypt) |

## Updating an existing project

Keep `.env.schema` as the source of truth. Edit schema and tracked `.env.[env]` files only — not gitignored `.local` files.

1. **Schema changes** — add/remove/rename items in `.env.schema`, update code to match, then `varlock load --agent`
2. **Secrets** — leave sensitive values empty in schema; ask the user to set them locally or in their secret provider
3. **Plugins** — add `@plugin()` in the header and prefer plugin resolvers over raw `exec()` when available
4. **Codegen** — `@generateTsTypes` (and the other `@generate*Env` decorators) run on load by default; use `auto=false` and `varlock codegen` if you need explicit control
5. **Before commit** - run `varlock load --agent` and the repository's existing
   checks. Keep its secret scanner and hook manager, including hk. Do not install
   a competing hook with `varlock scan --install-hook`. Before adding Varlock's
   scanner, test a partially staged file and two synthetic secrets on one line;
   neither staged-blob coverage nor complete finding redaction follows from the
   `--staged` flag. Run `varlock audit` if you renamed keys or suspect drift.

See [Schema](https://varlock.dev/guides/schema/), [Secrets](https://varlock.dev/guides/secrets/), and [Monorepos](https://varlock.dev/guides/monorepos/) for deeper patterns.

## Advanced

- Multiple environments: https://varlock.dev/guides/environments/
- Split large schemas with `@import`: https://varlock.dev/guides/import/
- Device-local encryption: https://varlock.dev/guides/local-encryption/
- `package.json` config (`varlock.loadPath`): https://varlock.dev/reference/cli-commands/
- Built-in variables (`$VARLOCK_ENV` for auto-detecting environment): https://varlock.dev/reference/builtin-variables/

## Docs

For details beyond this skill, use the Varlock Docs MCP tool if installed in your AI tool, or refer to https://varlock.dev/guides/schema as a starting point.
