import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  writeFileSync(
    join(root, "hyperframes"),
    `#!${process.execPath}\nif (process.argv.slice(2).join(" ") === "browser path") console.log(${JSON.stringify(shell)});`,
    { mode: 0o755 },
  );
  const before = process.env.PATH;
  process.env.PATH = `${root}${process.platform === "win32" ? ";" : ":"}${before ?? ""}`;
  t.after(() => {
    if (before === undefined) delete process.env.PATH;
    else process.env.PATH = before;
  });
  assert.equal(hfBrowser(), shell);
});
