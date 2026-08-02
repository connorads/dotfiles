import { expect, test, describe } from "bun:test";
import { BUILTIN_PAYLOAD_EXCLUDES, filterPayloadFiles } from "./payload.ts";

describe("filterPayloadFiles", () => {
  test("built-in excludes hide maintenance and generated/cache payload files", () => {
    const files = [
      "SKILL.md",
      ".DS_Store",
      ".git/config",
      ".claude/.cc-writes/state.json",
      ".rumdl_cache/workspace_index.bin",
      "__pycache__/helper.cpython-314.pyc",
      "lib/helper.pyc",
      "lib/helper.pyo",
      "lib/helper.pyd",
      "notes.md.backup",
      "node_modules/pkg/index.js",
      "evals/evals.json",
      "evals/fixtures/case/SKILL.fixture.md",
      "references/guide.md",
    ];

    expect(filterPayloadFiles(files, BUILTIN_PAYLOAD_EXCLUDES)).toEqual([
      "SKILL.md",
      "references/guide.md",
    ]);
  });

  test("SKILL.md is retained even when a pattern matches markdown", () => {
    expect(filterPayloadFiles(["SKILL.md", "notes.md"], ["**/*.md"])).toEqual(["SKILL.md"]);
  });

  test("an excluded nested SKILL.md does not bypass its parent exclusion", () => {
    expect(
      filterPayloadFiles(["SKILL.md", "node_modules/pkg/SKILL.md"], ["**/node_modules/**"]),
    ).toEqual(["SKILL.md"]);
  });

  test("configured excludes use Bun glob syntax relative to the skill dir", () => {
    expect(filterPayloadFiles(["SKILL.md", "tmp/cache.txt", "src/tmp.ts"], ["**/tmp/**"])).toEqual([
      "SKILL.md",
      "src/tmp.ts",
    ]);
  });
});
