---
name: deepsec
description: Use deepsec (an AI-powered vulnerability scanner) — running scans, configuring projects, writing matchers, and authoring plugins. Activates when the user asks how to scan, configure, or extend deepsec in a project that has deepsec installed.
---

# deepsec

`deepsec` is an AI-powered vulnerability scanner. This skill activates
when deepsec ships inside `node_modules/` — typically because the user
ran `npx deepsec …` (which caches the package locally). In the more
common dedicated-git setup the user works inside a clone of
`vercel-labs/deepsec` and the same docs sit at `docs/` from the repo root —
read those instead when this skill fires from outside a node_modules.

When the user asks how to use, configure, or extend deepsec, read the
relevant doc before answering — the docs are the source of truth, not
your training data.

## Where the docs are

`node_modules/deepsec/dist/docs/` (or `<deepsec-clone>/docs/`):

- `getting-started.md` — first-scan walkthrough
- `configuration.md` — full `deepsec.config.ts` reference
- `plugins.md` — plugin slots (matchers, notifiers, ownership, people, executor)
- `writing-matchers.md` — how to grow the matcher set with a coding agent
- `models.md` — model selection, defaults, refusals, future models
- `vercel-setup.md` — getting AI Gateway and Vercel Sandbox keys / tokens
- `architecture.md` — pipeline internals
- `data-layout.md` — `data/` schemas (FileRecord, RunMeta, …)
- `faq.md` — cost, model choice, sandbox mode, FP rate

## Worked example

`node_modules/deepsec/dist/samples/webapp/` (or `<deepsec-clone>/samples/webapp/`)
is a complete reference setup — `deepsec.config.ts` with an inline
plugin, two custom matchers under `matchers/`, an `INFO.md` for AI
prompt context, and a per-project `config.json`. When the user asks
"what should my config look like?", read this directory.

## How to answer common questions

- **"How do I run a scan?"** → `getting-started.md`.
- **"What goes in `deepsec.config.ts`?"** → `configuration.md` + `samples/webapp/deepsec.config.ts`.
- **"How do I add a matcher?"** → `writing-matchers.md` + `samples/webapp/matchers/*.ts`.
- **"How do I write a plugin?"** → `plugins.md` + `samples/webapp/deepsec.config.ts` (inline plugin pattern).
- **"What does deepsec actually do?"** → `architecture.md`.
- **"What's in `data/<id>/files/foo.json`?"** → `data-layout.md`.
- **"Which model / agent should I use?"** → `models.md`.
- **"How do I get an AI Gateway / Sandbox token?"** → `vercel-setup.md`.

Read the doc before paraphrasing. The CLI flag set, defaults, and
plugin-contract field names change — quote the doc, don't recall.
