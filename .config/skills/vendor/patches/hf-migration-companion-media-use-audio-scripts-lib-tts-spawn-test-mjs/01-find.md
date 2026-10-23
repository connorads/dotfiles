} from "./tts.mjs";

// Regression: on Windows, npx resolves to npx.cmd, which spawn() cannot exec
// without shell:true — it fails ENOENT, silently swallowed as ok:false by the
// caller. spawnP takes injectable platform/spawnFn params so this doesn't
// need to touch the real process.platform or mock node:child_process (whose
// ESM exports are non-configurable).
function fakeSpawn(captured) {
  return (cmd, args, opts) => {
