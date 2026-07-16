## After picking — guarantee the workflow is installed

Once you've picked a workflow, run the update step **before reading its skill** — workflow skills install on demand, so the one you matched may not be on this machine yet (its trigger phrases live in this router precisely so you can route to skills that aren't installed):

```bash
npx hyperframes skills update <workflow-name>
```

Bare name, no leading `/` — e.g. `npx hyperframes skills update pr-to-video`. Naming a skill guarantees it **plus the core domain skills** every workflow depends on are installed and current: a fast no-op when everything already is, a targeted install of just the missing/stale skills when not — never the full set. Then read the workflow's skill and continue. The same command works for an on-demand domain skill from the capability map (e.g. `npx hyperframes skills update figma`).

If the command fails, surface its error to the user instead of improvising the workflow from memory. Manual fallback (no HyperFrames CLI available): `npx skills add heygen-com/hyperframes --skill <workflow-name>`; everything at once: `npx skills add heygen-com/hyperframes --all`.

## Keeping skills current

HyperFrames skills are versioned and install **lazily**: the core set eagerly, the workflows on first use.

- **Core set** — this router, the `hyperframes-*` domain skills, and `media-use`. `npx hyperframes init` (which every creation workflow runs when scaffolding) checks GitHub and refreshes the core set plus anything else already installed. It never _expands_ the install — workflow skills you haven't used are not pulled. Re-running init on an up-to-date machine is a no-op; offline (or rate-limited) it degrades gracefully and never hard-fails. The `--skip-skills` flag is currently neutered (a temporary measure while the skills.sh registry catches up); CI/tests opt out via the `HYPERFRAMES_SKIP_SKILLS=1` env var.
- **Workflow skills** — installed and refreshed at trigger time by the update step above (`skills update <workflow-name>`).

If a task is behaving unexpectedly, or before a long build, confirm the installed skills are current:

- **Check:** `npx hyperframes skills check` (add `--json` for a machine-readable verdict; exits non-zero when anything installed is outdated or the core set is incomplete — workflow skills not yet installed are reported as _available on demand_, not as a failure).
- **Update:** `npx hyperframes skills update` — refreshes the core set plus everything installed to the latest, and removes skills no longer published. Without names it never installs workflows you haven't used; naming skills (`skills update <name…>`) additionally installs those.
- **Full set, explicitly:** `npx hyperframes skills` (or `npx skills add heygen-com/hyperframes --all`).

The CLI also surfaces a one-line reminder when a `render` / `lint` / `validate` run detects stale skills.
