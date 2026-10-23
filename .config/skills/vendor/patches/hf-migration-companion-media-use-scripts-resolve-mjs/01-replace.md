#!/usr/bin/env node
import { spawnSync } from "node:child_process";
const result = spawnSync("hyperframes", ["media-use", "resolve", ...process.argv.slice(2)], {
  stdio: "inherit", shell: false,
  env: { ...process.env, HYPERFRAMES_SKIP_SKILLS: "1", HYPERFRAMES_NO_UPDATE_CHECK: "1" },
});
if (result.error) console.error("Managed HyperFrames CLI unavailable on PATH. Provision it through the local tool workflow.");
process.exitCode = result.status ?? 1;
