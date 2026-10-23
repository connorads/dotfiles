import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { invocation } from "./plugin-cli.mjs";

test("uses installed CLI, preserves literal args and disables remote maintenance", () => {
  const args = ["render", "literal $value & spaces"];
  const call = invocation(args, { env: { PATH: "/bin", HYPERFRAMES_SKIP_SKILLS: "0" } });
  assert.equal(call.command, "hyperframes");
  assert.deepEqual(call.args, args);
  assert.deepEqual(call.env, { PATH: "/bin", HYPERFRAMES_SKIP_SKILLS: "1", HYPERFRAMES_NO_UPDATE_CHECK: "1", HYPERFRAMES_NO_TELEMETRY: "1" });
  for (const name of ["skills", "upgrade", "usage"]) assert.throws(() => invocation([name]));
  assert.throws(() => invocation(["--script"]), /requires/);
});

test("helper preserves cwd, literal arguments, opt-outs and exit status", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hf-managed-launcher-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const project = join(dir, "project with spaces"); mkdirSync(project);
  const helper = join(dir, "helper.mjs");
  writeFileSync(helper, 'console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), skip: process.env.HYPERFRAMES_SKIP_SKILLS, telemetry: process.env.HYPERFRAMES_NO_TELEMETRY })); process.exit(7);');
  const result = spawnSync(process.execPath, [new URL("./plugin-cli.mjs", import.meta.url).pathname, "--script", helper, "literal $value & spaces"], { cwd: project, encoding: "utf8" });
  assert.equal(result.status, 7, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { cwd: realpathSync(project), args: ["literal $value & spaces"], skip: "1", telemetry: "1" });
});
