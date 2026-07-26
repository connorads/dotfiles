---
name: alchemy
description: >-
  Guides building, deploying, testing, and debugging infrastructure with the
  alchemy-run/alchemy TypeScript infrastructure-as-code tool. Use for Alchemy
  stacks, resources, CLI commands, state, environments, Cloudflare or AWS
  providers, and Alchemy-specific errors. Not for the Alchemy blockchain API
  platform or general cloud guidance unrelated to alchemy-run/alchemy.
license: See LICENSE
---

# Alchemy

Use the smallest relevant local source, then verify anything version-sensitive.

## Find the source

Run the bundled search before answering an Alchemy-specific implementation
question:

```sh
python3 scripts/search.py <specific terms from the task>
```

Add `--area cloudflare`, `--area aws`, or another top-level area when the task
already identifies it. Read the best one to three returned files directly; do
not load a whole provider's documentation.

The generated `references/*.mdx` files preserve upstream documentation bytes.
Their flattened names replace `/` with `--`, so the site link
`/cloudflare/data/d1` maps to `references/cloudflare--data--d1.mdx`. When a
link is ambiguous or absent, search again using its final path segment and
heading text instead of guessing.

## Apply the source

- Treat the references as Alchemy guidance, not generic Cloudflare or AWS
  guidance. Keep provider facts and Alchemy's abstraction distinct.
- Follow the target project's existing package manager and runtime conventions.
- Check installed Alchemy source and types before relying on a snapshot claim
  about an exported name, option, default, version, or CLI flag. If the package
  is not installed, verify against the live upstream source when accuracy
  depends on freshness.
- Preserve Alchemy's Effect-based programming model in examples. Do not rewrite
  examples into an unrelated imperative deployment style merely because it is
  more familiar.
- Search again when an answer crosses domains such as resource definition,
  environments, state, deployment, and testing. One page rarely owns all four.

## Refresh the snapshot

Preview only:

```sh
python3 scripts/update.py
```

Read the reported revision and file changes. Apply only after that review:

```sh
python3 scripts/update.py --apply
```

`--check` detects drift without writing. `--rev <ref>` selects an explicit
revision. `--repo <URL-or-path>` targets a fork or local fixture. Applying over
locally modified generated references requires the deliberate `--force` escape
hatch.

`references/upstream.json` is the provenance source of truth. `LICENSE` and
`NOTICE` record redistribution terms and attribution. `tests/` and `evals/`
are verification support and are not runtime references.
