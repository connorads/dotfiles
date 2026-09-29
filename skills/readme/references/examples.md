# Examples

Openings from READMEs that follow the shape in SKILL.md. Excerpts are trimmed
(`...` marks a cut) and quoted from each repo's default branch. Read the one
closest to the project in hand.

- [esbuild: signpost with a benchmark chart](#esbuild)
- [uv: pitch and go, chart as proof](#uv)
- [eve: pitch and go, directory tree as proof](#eve)
- [act: CLI, problem first, GIF as proof](#act)
- [delta: config as the first command](#delta)

## esbuild

github.com/evanw/esbuild. 166 words. A wordmark, one row of links, a "Why?"
of one sentence, then the chart. The docs site carries everything else.

````markdown
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./images/wordmark-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="./images/wordmark-light.svg">
    <img alt="esbuild: An extremely fast JavaScript bundler" src="./images/wordmark-light.svg">
  </picture>
  <br>
  <a href="https://esbuild.github.io/">Website</a> |
  <a href="https://esbuild.github.io/getting-started/">Getting started</a> |
  <a href="https://esbuild.github.io/api/">Documentation</a> |
  ...
</p>

## Why?

Our current build tools for the web are 10-100x slower than they could be:

<p align="center">
  <picture>
    ... benchmark-dark.svg / benchmark-light.svg ...
  </picture>
</p>
````

## uv

github.com/astral-sh/uv. One sentence, then a benchmark chart with a caption
saying exactly what was measured.

````markdown
# uv

An extremely fast Python package and project manager, written in Rust.

<p align="center">
  <picture align="center">
    ... dark and light benchmark images ...
  </picture>
</p>

<p align="center">
  <i>Installing <a href="https://trio.readthedocs.io/">Trio</a>'s dependencies with a warm cache.</i>
</p>

## Highlights

- A single tool to replace `pip`, `pip-tools`, `pipx`, `poetry`, `pyenv`, `twine`, `virtualenv`, and
  more.
- [10-100x faster](https://github.com/astral-sh/uv/blob/main/BENCHMARKS.md) than `pip`.
...
````

## eve

github.com/vercel/eve. The product is a folder layout, so the proof is a
commented tree. The first command sits about 80 words from the top.

````markdown
[eve](https://eve.dev/) is a filesystem-first framework for durable AI agents. Core agent capabilities live in
conventional locations, so projects are easier to inspect, extend, and operate.

## The filesystem is the authoring interface

```text
my-agent/
└── agent/
    ├── agent.ts            # Optional: model and runtime config
    ├── instructions.md     # Required: the always-on system prompt
    ├── tools/              # Optional: typed functions the model can call
    ...
```

Read the [documentation](https://eve.dev/docs) for the full project layout and guides.

## Quick start

```bash
npx eve@latest init my-agent
```
````

## act

github.com/nektos/act. 330 words. Two reasons to care, one paragraph on how
it works, a GIF, then links out.

````markdown
Run your [GitHub Actions](https://developer.github.com/actions/) locally! Why would you want to do this? Two reasons:

- **Fast Feedback** - Rather than having to commit/push every time you want to test out the changes ...
- **Local Task Runner** - I love [make](...). However, I also hate repeating myself. ...

# How Does It Work?

When you run `act` it reads in your GitHub Actions from `.github/workflows/` and determines the set of actions that need to be run. ...

![Demo](https://raw.githubusercontent.com/wiki/nektos/act/quickstart/act-quickstart-2.gif)

# Act User Guide

Please look at the [act user guide](https://nektosact.com) for more documentation.
````

## delta

github.com/dandavison/delta. A screenshot, then "Get Started" with the exact
config to paste. The first code block is 56 words from the top.

````markdown
## Get Started

[Install it](https://dandavison.github.io/delta/installation.html) (the package is called "git-delta" in most package managers, but the executable is just `delta`) and add this to your `~/.gitconfig`:

```gitconfig
[core]
    pager = delta
...
```
````
