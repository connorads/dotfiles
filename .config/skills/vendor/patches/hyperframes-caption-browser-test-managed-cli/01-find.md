import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { hfBrowser } = createRequire(import.meta.url)("./hf-cli.cjs");

test("caption scripts launch the browser `hyperframes browser path` prints", (t) => {
  const root = mkdtempSync(join(tmpdir(), "hf-browser-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const shell = join(root, "chrome-headless-shell");
  writeFileSync(shell, "");
  const cliDir = join(root, "hf/packages/cli/dist");
  mkdirSync(cliDir, { recursive: true });
  writeFileSync(
    join(cliDir, "cli.js"),
    `if (process.argv.slice(2).join(" ") === "browser path") console.log(${JSON.stringify(shell)});`,
  );
  const before = process.env.HYPERFRAMES_ROOT;
  process.env.HYPERFRAMES_ROOT = join(root, "hf");
  t.after(() => {
    if (before === undefined) delete process.env.HYPERFRAMES_ROOT;
    else process.env.HYPERFRAMES_ROOT = before;
  });
  assert.equal(hfBrowser(), shell);
});
