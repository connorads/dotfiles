#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { isMainModule } from "./lib/main-module.mjs";

export function invocation(args, { env = process.env, node = process.execPath } = {}) {
  if (args[0] === "skills" || args[0] === "upgrade")
    throw new Error("Refresh skills and tools through the reviewed local update workflow.");
  if (args[0] === "usage")
    throw new Error("Harness credential probes are disabled by local policy.");
  const childEnv = { ...env, HYPERFRAMES_SKIP_SKILLS: "1", HYPERFRAMES_NO_UPDATE_CHECK: "1" };
  if (args[0] === "--script") {
    if (!args[1]) throw new Error("--script requires a Node script path.");
    return { command: node, args: args.slice(1), env: childEnv };
  }
  return { command: "hyperframes", args, env: childEnv };
}
if (isMainModule(import.meta.url)) {
  try {
    const call = invocation(process.argv.slice(2));
    const result = spawnSync(call.command, call.args, { env: call.env, stdio: "inherit", shell: false });
    if (result.error) throw new Error("Managed HyperFrames CLI unavailable on PATH. Provision it through the local tool workflow.");
    process.exitCode = result.status ?? 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
