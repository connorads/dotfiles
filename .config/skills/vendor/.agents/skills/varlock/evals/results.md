# Evaluation record

Evaluated 2026-09-21 against the skill at upstream tag `varlock@1.20.0`, Git
revision `674fdcf31c73aede88573efdee24488bd18af879`, with the local workflow patch.
The three prompts and two held-out description cases are in `cases.md`.

## Fresh-agent comparison

Each arm uses a separate agent context. Runs propose actions without accessing
real environment files or executing project mutations. Session agents
`varlock_baseline_eval`, `varlock_patched_eval` and `varlock_adhoc_eval` hold the
full transcripts. Token and wall-time measurements are unavailable.

| Case | Upstream skill | Patched skill | Ad-hoc instruction |
| --- | --- | --- | --- |
| Next startup | Proposes preflight without explicit environment selection; deployment behaviour remains unknown | Reads Next reference, matches loader mode, validates before children and tests build A / runtime B | Identifies investigation but has no exact fix |
| Secrets and hooks | Refuses disclosure but proposes `scan --staged` directly | Keeps hk and existing scanner; tests staged content and two-secret redaction first | Proposes generic staged-secret test without the two regression cases |
| Installation | Uses dev dependency by default and `gh skill install` / update | Chooses dependency scope from runtime use, pins package and routes skill refresh through reviewed vendoring | Requests source and installation discovery |

Representative upstream proposals:

> Add an hk pre-commit step that runs `pnpm exec varlock scan --staged`.

> Obtain the skill through the upstream GitHub CLI route after checking support.

The patched agent reads both `SKILL.md` and `references/nextjs.md`. It proposes
testing index-only secrets and multiple secrets on one line before scanner
adoption. It also distinguishes a reviewed catalogue copy from a verified
latest upstream revision.

Held-out description judgement selects the skill for the `op()` plugin error
and rejects it for plain-dotenv Stripe dashboard rotation. These are single-run
relevance judgements, not measured client autoload rates.

## Executed CLI checks

Varlock 1.19.0, Node 24.21.0 and pnpm 12.4.1. All files and credentials are
disposable synthetic fixtures. Installation keeps scripts disabled.

| Observation | Result |
| --- | --- |
| `load --agent --env development` | Loads selected fixture and omits both synthetic secrets |
| Missing required production inputs | Non-zero exit |
| Invalid URL under `run` | Non-zero exit; child marker absent |
| Valid `run` | Child receives exact secret; captured piped output omits it |
| `run --env development` | Flag rejected |
| Secret staged, working-tree copy clean | `scan --staged` misses the indexed secret |
| Two sensitive values on one line | Scanner output exposes one synthetic value |

The Next.js app evidence is dated and versioned in `references/nextjs.md`.
The app suite is not rerun during skill vendoring. These CLI probes do not
establish Varlock 1.20.0 runtime behaviour.

## Packaging checks

The patch engine's 23 existing tests pass. Patch checking and a second apply
preserve the prepared bytes. The writing-skills checker reports zero errors and
warnings; the optional `skills-ref` validator is not installed. Prose checks pass
for the local reference and evaluation files.

`skl preview vendor/varlock` resolves the catalogue entry. Installing it into a
disposable Git project preserves the patched skill, licence and Next.js reference
byte-for-byte. This check places the installed skills 1.5.26 executable first on
PATH because the machine's default skills shim resolves to a non-executable hk
directory. No shim configuration changes are part of this skill installation.
