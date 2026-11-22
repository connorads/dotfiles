import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { resolveSpawnCommand, spawnP } from "./tts.mjs";

const npxCliPath = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js";
const envWithNpxCli = {
  npm_execpath: "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
  npm_node_execpath: "C:\\Program Files\\nodejs\\node.exe",
};
const pathExists = (p) => p.replace(/\\/g, "/") === npxCliPath.replace(/\\/g, "/");

function fakeSpawn(captured, exitCode = 0) {
  return (cmd, args, opts) => {
    captured.push({ cmd, args, opts });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", exitCode));
    return child;
  };
}

test("npx hyperframes runs the CLI handed over in HYPERFRAMES_CLI_ENTRY on every platform", () => {
  for (const platform of ["darwin", "linux", "win32"]) {
    const env = { ...envWithNpxCli, HYPERFRAMES_CLI_ENTRY: "/opt/hf/bin/hyperframes.mjs" };
    const resolved = resolveSpawnCommand("npx", ["hyperframes", "tts", "a & b"], {}, platform, env, pathExists);
    assert.equal(resolved.cmd, process.execPath);
    assert.deepEqual(resolved.args, ["/opt/hf/bin/hyperframes.mjs", "tts", "a & b"]);
    assert.equal(resolved.opts.shell, false);
  }
});

test("npx hyperframes without HYPERFRAMES_CLI_ENTRY uses managed hyperframes without a shell", async () => {
  const captured = [];
  const res = await spawnP("npx", ["hyperframes", "tts", "hello & calc"], { shell: true }, "darwin", fakeSpawn(captured), {}, pathExists);
  assert.equal(res.status, 0);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].cmd, "hyperframes");
  assert.deepEqual(captured[0].args, ["tts", "hello & calc"]);
  assert.equal(captured[0].opts.shell, false);
});

test("non-HyperFrames npx bootstrap is rejected before spawn", () => {
  assert.throws(() => resolveSpawnCommand("npx", ["example-tool", "tts"], {}, "darwin", {}, pathExists), /bootstrap is disabled/);
});

test("spawnP does not enable shell for non-npx commands even on win32", async () => {
  const captured = [];
  await spawnP("ffmpeg", ["-version"], {}, "win32", fakeSpawn(captured));
  assert.equal(captured[0].cmd, "ffmpeg");
  assert.deepEqual(captured[0].args, ["-version"]);
  assert.equal(captured[0].opts.shell, undefined);
});
