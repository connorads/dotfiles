# dotfiles-docs

Astro Starlight site explaining the workflow encoded in these dotfiles - the
why-layer, not the mechanics. Deploys later to Cloudflare Workers (assets-only)
at dotfiles.connoradams.co.uk. README targets users; this file is for agents
and maintainers working on the site.

## Golden rule: docs track reality

Every page justifies something that exists in the dotfiles. When a dotfiles
change alters a subsystem a page covers (keybindings, aliases, tool choices,
security posture), update the page in the same commit. Verify claims against
the actual config (`~/.config/tmux/tmux.conf`, `~/.config/zsh/`, etc.) before
writing them - never from memory.

## Commands

```bash
pnpm dev             # dev server, 127.0.0.1:4321 (astro 7: daemonises; stop with `pnpm exec astro dev stop`)
pnpm build           # static build to dist/
pnpm check           # astro check (typecheck)
pnpm preview         # build + wrangler dev (real workerd, exercises 404 routing)
pnpm run deploy      # build + wrangler deploy (NOT `pnpm deploy` - that's pnpm's builtin)
dhk check            # dotfiles-wide hk checks (rumdl gates the markdown here)
```

## Layout

- `src/content/docs/` - all pages; sidebar order lives in `astro.config.mjs`, not the filesystem
- Sections by theme: `speed/`, `portable/`, `agents/`, `trust/`, plus `why.md` (manifesto) and `index.mdx` (splash)
- `src/styles/custom.css` - accent colour only; stock Starlight otherwise, deliberately
- `wrangler.jsonc` - assets-only Worker (no `main`, no adapter); Starlight emits `dist/404.html`

## Conventions

- First person, British English, `-` not em-dashes (rumdl + house rules gate the mechanics; the register is on you)
- Page shape (loose): the itch -> what I do -> why it compounds -> **steal this** (minimal adoptable version, no dotfiles machinery required)
- Stubs carry `sidebar.badge` "Soon" + a one-line promise in a `:::note[Coming soon]` aside; promote by replacing the aside with real sections and dropping the badge
- This is not a repo: it lives inside the dotfiles work-tree. Use `dotfiles` (never bare `git`), stage explicit paths, and ignore unrelated staged changes - `dotfiles commit -- src/dotfiles-docs` scopes a commit to this project

## Gotchas

- Astro 7's dev server is a background daemon; a stale `.astro/` content cache
  survives restarts and can throw `ImageNotFound` for since-deleted assets while
  `pnpm build` passes. Stop the daemon, `trash .astro`, restart.
- Concurrent dotfiles sessions + hk's pre-commit stash can silently revert
  tracked-and-modified files here to HEAD (untracked new files survive, so the
  damage hides in files that already existed). Commit with
  `HK_STASH=none dotfiles commit -- src/dotfiles-docs`, and diff the committed
  content (`dotfiles show HEAD -- src/dotfiles-docs | head`) when other
  sessions are active.

## Deeper docs

- Site structure/framing decisions: commit messages on `src/dotfiles-docs/`
- Dotfiles mechanics the site links to: `~/README.md`, `~/AGENTS.md`
