// package-loader — bootstrap optional helper packages only when missing, with
// defense-in-depth so a malicious or typo'd dependency can't run on install:
//   • specs are version-pinned (assertPinnedPackageSpecs) — no floating "latest"
//   • install runs `npm install --ignore-scripts` — package lifecycle scripts
//     never execute
//   • `--no-save` into a throwaway tmp dir — the host project is left untouched
//   • requires an interactive y/N (or an explicit $HYPERFRAMES_SKILL_BOOTSTRAP_DEPS=1)
//   • npm is spawned with an argv array (no shell) — never a built command string
// The `installLine` strings below are DISPLAY ONLY (shown in the prompt / error
// text); they are never handed to a shell or executed.
