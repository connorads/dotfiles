import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  resolveNpxCliFromNpmExecPath,
  resolveNpxCliPath,
  resolveSpawnCommand,
  spawnP,
  _resetNpxResolutionWarnForTests,
} from "./tts.mjs";

// Exercise managed CLI launches with injected platforms and child processes.
function fakeSpawn(captured) {
  return (cmd, args, opts) => {
    captured.push({ cmd, args, opts });
    const p = new EventEmitter();
    setImmediate(() => p.emit("exit", 0));
    return p;
  };
}

const envWithNpxCli = {
  npm_execpath: "/opt/node/lib/node_modules/npm/bin/npm-cli.js",
  npm_node_execpath: "/opt/node/bin/node",
};
const npxCliPath = "/opt/node/lib/node_modules/npm/bin/npx-cli.js";
const pathExists = (path) => path === npxCliPath;

test("resolveNpxCliFromNpmExecPath finds npx-cli next to npm-cli", () => {
  assert.equal(resolveNpxCliFromNpmExecPath(envWithNpxCli.npm_execpath, pathExists), npxCliPath);
});

test("resolveNpxCliPath finds npx-cli beside node when npm_execpath is unset", () => {
  const node = "C:/Program Files/nodejs/node.exe";
  const expected = "C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js";
  assert.equal(
    resolveNpxCliPath(undefined, node, (path) => path === expected),
    expected,
  );
});

test("resolveSpawnCommand uses the managed CLI on win32 without a shell", () => {
  const resolved = resolveSpawnCommand(
    "npx",
    ["hyperframes", "tts", "C:\\Users\\Test User\\line.txt", "--voice", "am_michael"],
    {},
    "win32",
    envWithNpxCli,
    pathExists,
  );
  assert.ok(resolved);
  assert.equal(resolved.cmd, "hyperframes");
  assert.deepEqual(resolved.args, [
    "tts",
    "C:\\Users\\Test User\\line.txt",
    "--voice",
    "am_michael",
  ]);
  assert.equal(resolved.opts.shell, false);
});

test("resolveSpawnCommand preserves Windows npx shell metacharacters as argv data", () => {
  const resolved = resolveSpawnCommand(
    "npx",
    ["hyperframes", "tts", "hello & calc"],
    {},
    "win32",
    envWithNpxCli,
    pathExists,
  );
  assert.ok(resolved);
  assert.deepEqual(resolved.args, ["tts", "hello & calc"]);
});

test("spawnP uses the managed CLI for legacy npx requests on win32", async () => {
  const captured = [];
  await spawnP(
    "npx",
    ["hyperframes", "tts"],
    {},
    "win32",
    fakeSpawn(captured),
    envWithNpxCli,
    pathExists,
  );
  assert.equal(captured.length, 1);
  assert.equal(captured[0].cmd, "hyperframes");
  assert.deepEqual(captured[0].args, ["tts"]);
  assert.equal(captured[0].opts.shell, false);
});

test("spawnP does not enable shell for npx on darwin/linux", async () => {
  const captured = [];
  await spawnP("npx", ["hyperframes", "tts"], {}, "darwin", fakeSpawn(captured));
  assert.equal(captured[0].cmd, "hyperframes");
  assert.deepEqual(captured[0].args, ["tts"]);
  assert.equal(captured[0].opts.shell, false);
});

test("spawnP does not enable shell for non-npx commands even on win32", async () => {
  const captured = [];
  await spawnP("python3", ["-c", "pass"], {}, "win32", fakeSpawn(captured));
  assert.equal(captured[0].cmd, "python3");
  assert.deepEqual(captured[0].args, ["-c", "pass"]);
  assert.equal(captured[0].opts.shell, undefined);
});

test("spawnP uses the managed CLI without npm on win32", async () => {
  _resetNpxResolutionWarnForTests();
  const captured = [];
  const node = "C:/Program Files/nodejs/node.exe";
  const npxCli = "C:/Program Files/nodejs/node_modules/npm/bin/npx-cli.js";
  const result = await spawnP(
    "npx",
    ["hyperframes", "tts"],
    {},
    "win32",
    fakeSpawn(captured),
    { npm_node_execpath: node },
    (path) => path === npxCli,
  );
  assert.equal(result.status, 0);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].cmd, "hyperframes");
  assert.deepEqual(captured[0].args, ["tts"]);
});

test("non-HyperFrames npx bootstrap is rejected before spawn", () => {
  assert.throws(() => resolveSpawnCommand("npx", ["unmanaged-tool"]), /bootstrap is disabled/);
});

test("managed launches preserve shell metacharacters as literal arguments", () => {
  const result = resolveSpawnCommand("npx", ["hyperframes", "tts", "hello; touch ignored"], { shell: true });
  assert.equal(result.cmd, "hyperframes");
  assert.deepEqual(result.args, ["tts", "hello; touch ignored"]);
  assert.equal(result.opts.shell, false);
});
