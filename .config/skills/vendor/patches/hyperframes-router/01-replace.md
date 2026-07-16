## After picking — workflow skills are vendored locally

{{marker}}

Every workflow and domain skill in the capability map is vendored alongside this router (`../<workflow-name>/SKILL.md`). Read it from there and continue. Do **not** run `npx hyperframes skills update` or `npx skills add` — skill refreshes here go through the dotfiles vendored-skills review flow, not runtime installs. If a referenced skill is missing, surface that to the user instead of installing it.
