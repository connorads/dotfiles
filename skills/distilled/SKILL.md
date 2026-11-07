---
name: distilled
description: >-
  Finds and uses distilled (distilled.cloud), the Effect-native TypeScript SDKs
  published as @distilled.cloud/* packages for AWS, Cloudflare, GCP, Azure,
  Stripe, GitHub, Neon, Supabase, Slack, Sentry, PostHog and about 90 other
  APIs. Use in an Effect v4 project when it calls a third-party or cloud API,
  when asked "do we have a library for X", "is there an Effect SDK for X", or
  before installing an upstream SDK such as stripe or @aws-sdk/*. Also for
  wiring a distilled package's layers, typed errors, pagination and retries.
  Not for building, patching or regenerating a distilled SDK itself
  (distilled-sdk, distilled-sdk-patch and distilled-sdk-update, which ship
  inside the alchemy-run/distilled repo).
---

# Distilled

Distilled publishes one Effect-native SDK per provider as
`@distilled.cloud/<provider>`. Each SDK is generated from the provider's own
API spec. Alchemy's live tests patch the spec where it is wrong. Every
operation returns an `Effect` with typed errors and Schema-decoded output.
Source: `alchemy-run/distilled` on GitHub, one package per `packages/<name>`.

## 1. Check the project fits

Distilled needs Effect v4. Check the repo before you suggest it:

- `effect` in `package.json` is `4.x`, or imports use `effect/http/...`.
- Effect v3 (`@effect/platform` HTTP client): distilled does not work. Use
  the upstream SDK, or plan the v4 migration first.
- No Effect: do not add Effect only to call one API. Use the upstream SDK.

## 2. Answer "do we have a library for X"

1. Look up X in [references/providers.md](references/providers.md). It is a
   dated snapshot grouped by category.
2. Confirm the package is published, because the snapshot can be stale:

   ```sh
   pnpm view @distilled.cloud/<name> version
   ```

3. For a provider not in the snapshot, list the live packages. The npm org
   also holds unrelated Alchemy packages, so read the repo, not the org:

   ```sh
   gh api repos/alchemy-run/distilled/contents/packages --jq '.[].name'
   ```

4. If there is still no package, say so and give the upstream SDK. The
   generator runs only inside the `alchemy-run/distilled` monorepo; its
   `@distilled.cloud/dev` package is not published. To add a provider:
   - Open an "SDK request" issue there with the provider's spec URL first.
     Maintainers usually re-implement outside new-SDK PRs on their own
     branch.
   - To build it, clone the repo. Its `distilled-sdk`, `distilled-sdk-patch`
     and `distilled-sdk-update` skills ship in `.agents/skills/` and load
     inside the clone.

Answer with the package name, its category and one call that does the task.

## 3. Install

```sh
pnpm add @distilled.cloud/<name>@<exact-version> effect
```

- Every package releases together on one `1.0.0-rc.N` version and depends on
  `@distilled.cloud/core`. Pin exact versions. Keep all `@distilled.cloud/*`
  packages in one repo on the same version.
- The release-age quarantine can reject the newest RC. Take the version pnpm
  resolves. Do not bypass the quarantine for it.
- For S3 or Cloudflare R2 only, `@distilled.cloud/s3` is smaller than
  `@distilled.cloud/aws` when it is on npm. `@distilled.cloud/aws/s3`
  re-exports the same client.

## 4. Read the package before you write code

Each package has two import surfaces:

- The root, `@distilled.cloud/<name>`, exports layers, error classes and
  `Retry`. It does not export operations.
- Operations come from a service subpath, `@distilled.cloud/<name>/<service>`.
  Stripe has one service, `stripe`. AWS has one per service, such as `s3`.

Generated names come from each provider's spec, so do not guess them.
Stripe uses `CreateCustomer` and lists customers with `GetCustomers`; there
is no `ListCustomers`. AWS uses camelCase, such as `putObject`. Some READMEs
show root-level operation calls that do not typecheck. Trust the files:

```sh
ls node_modules/@distilled.cloud/<name>/src/services/   # service subpaths
grep -n "export const <Guess>" node_modules/@distilled.cloud/<name>/src/services/<service>.ts
cat node_modules/@distilled.cloud/<name>/src/credentials.ts   # layer + env var
```

Before install, list the services with
`gh api repos/alchemy-run/distilled/contents/packages/<name>/src/services --jq '.[].name'`.

## 5. Wire it

Each SDK needs an HTTP client layer and a credentials layer. Most also need a
protocol layer. Stripe:

```ts
import { Data, Effect, Layer, Stream } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Stripe from "@distilled.cloud/stripe";
import * as StripeApi from "@distilled.cloud/stripe/stripe";

class BillingRejected extends Data.TaggedError("BillingRejected")<{
  reason?: string;
}> {}

const program = StripeApi.CreateCustomer({ email: "ops@example.com" }).pipe(
  Effect.catchTags({
    CardError: (e) => Effect.fail(new BillingRejected({ reason: e.message })),
  }),
  Stripe.Retry.transient,
);

// Paginated operations stream items across pages.
const firstTen = StripeApi.GetCustomersSearch.items({
  query: "email:'ops@example.com'",
}).pipe(Stream.take(10), Stream.runCollect);

const StripeLive = Layer.mergeAll(
  FetchHttpClient.layer,
  Stripe.CredentialsFromEnv, // reads STRIPE_API_KEY
  Stripe.StripeProtocol,
);

program.pipe(Effect.provide(StripeLive), Effect.runPromise);
```

AWS uses `Region.fromEnv()` and `Credentials.fromChain()` from
`@distilled.cloud/aws` in place of the last two layers.

Rules that the examples do not show:

- **Errors.** Error tags are `Schema.TaggedError` classes in the package's
  `errors.ts`. Handle them with `Effect.catchTag` or `Effect.catchTags`. Map
  them to your domain errors at the module boundary.
- **Pagination.** Only operations typed `PaginatedOperationMethod` have
  `.items(input)` and `.pages(input)`, which return a `Stream`. Check the type
  before you write `.items`. Other list operations return one page.
- **Retries.** Each SDK exports a `Retry` module: `Stripe.Retry.transient`,
  `Stripe.Retry.throttling`, `Stripe.Retry.none`, or
  `Stripe.Retry.policy(...)`. Do not wrap calls in `Effect.retry` as well.
- **Credentials.** Credential layers read env vars. Supply them at run time
  with `fnox exec -- <command>`. Do not hardcode secrets.

## 6. Before you fall back to the upstream SDK

Hand-written helpers sit beside the generated code. Examples are
`Stripe.Webhooks.constructEvent` and `aws/src/presign.ts`. List them:

```sh
ls node_modules/@distilled.cloud/<name>/src/
```

Use the upstream SDK only for a missing capability, such as an S3 multipart
upload manager. Keep it in one adapter module and comment why.

## 7. When the SDK is wrong about the wire

A missing typed error, a field that is null on the wire, or a schema decode
failure on a valid response is a spec bug. Work round it narrowly in your
code and record the operation, request and response. Fix it upstream with the
`distilled-sdk-patch` skill in a clone of `alchemy-run/distilled`.
