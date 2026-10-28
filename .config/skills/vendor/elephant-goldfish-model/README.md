# Elephant-Goldfish Model

Seven explicit-invocation design and review skills from
[google/elephant-goldfish-model](https://github.com/google/elephant-goldfish-model).
The catalogue source is `elephant-goldfish-model/`. No global autoload or plugin
installation is required.

Each skill carries reviewer personas and standards under `references/egm/`,
plus the Apache-2.0 licence. These copies keep resources available after
`skl install elephant-goldfish-model/` copies the skills into a project.
Local patches resolve these resources and preserve native fresh-context review,
user delegation, package-runner policy and host concurrency limits. Reviewer
instructions do not enforce filesystem or tool restrictions.

## Refresh

Follow the [reviewed update procedure](../../personal/update-vendored-skills/SKILL.md).
Use one recorded checkout for all seven skills and their shared resources.
The `v0.1.0` tag uses underscore skill paths; the lock tracks the default branch
with hyphen paths instead. Record the exact revision in the commit message.

1. Prepare the seven skills with the skills CLI in a temporary bucket.
2. Copy shared resources and attribution from that same checkout into each skill.
   Set `checkout` to the recorded checkout and `bucket` to the temporary bucket:

   ```sh
   for skill in "$bucket"/.agents/skills/egm-*; do
     mkdir -p "$skill/references/egm"
     cp -R "$checkout/agents" "$checkout/resources" "$skill/references/egm/"
     cp "$checkout/LICENSE" "$skill/LICENSE"
   done
   cp "$checkout/LICENSE" "$bucket/LICENSE"
   ```

3. Preserve GitHub provenance and pristine CLI hashes in the candidate lock.
   Reapply the `egm-*` patches against a vendor-shaped preview before review.
4. Verify seven catalogue entries and a disposable project installation.
   Check persona, standard and skill-local reference paths in the copied skills.
   Run `skill-patch check` and the scoped dotfiles checks before committing.

Native design and review sessions consume model usage. Packaging checks do not
establish end-to-end workflow support.
