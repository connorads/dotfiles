Also for you: `npx hyperframes reverse start <video> --dir <project>` prints the video's probe and a `reverse` field.
`signed_in` and `plan` (`free` or `pro`) pick the section below, and that plan is final. Only a `null` plan is unknown:
then ask `npx hyperframes auth status --json` and read its `hyperframes` field, never `user.subscription`, which is the HeyGen
app's plan and does not unlock Reverse. `<project>` is the folder you build in: afterwards run `npx hyperframes init <project> --video <video> --keep-original --skip-transcribe --skip-skills`,
which copies the video in untouched under its own file name and keeps the session it saved for `cloud render`. Keep the video out of `<project>` until then: `init`
refuses a folder that already holds other files. Outside a plugin, a CLI is an old install (often a global one, which
never updates itself when an agent runs it) shadowing the current release when it does not know `reverse start`, when
its `reverse start` output has `_meta.updateAvailable: true`, or when that output says `signed_in: false` with no
`reverse.next`. Then run `node "<SKILLS>/hyperframes/scripts/plugin-cli.mjs" --cli-version latest --version` once and run `reverse start` again and every later
command of this run as `node "<SKILLS>/hyperframes/scripts/plugin-cli.mjs" --cli-version <that-version> <command>`, so the whole run uses one release. That `reverse start` names the out-of-date install in `reverse.next` with the line
to open your next message to the person with: say it.