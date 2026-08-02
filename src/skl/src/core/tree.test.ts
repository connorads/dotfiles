import { expect, test, describe } from "bun:test";
import { renderTree } from "./tree.ts";

describe("renderTree", () => {
  test("single file", () => {
    expect(renderTree(["SKILL.md"])).toBe("└── SKILL.md");
  });

  test("nested files with deterministic ordering and connectors", () => {
    const tree = renderTree([
      "SKILL.md",
      "references/guide.md",
      "references/api.md",
      "scripts/run.sh",
    ]);
    expect(tree).toBe(
      [
        "├── SKILL.md",
        "├── references",
        "│   ├── api.md",
        "│   └── guide.md",
        "└── scripts",
        "    └── run.sh",
      ].join("\n"),
    );
  });

  test("order of input does not change output (deterministic)", () => {
    const a = renderTree(["b.md", "a.md", "dir/z.md", "dir/a.md"]);
    const b = renderTree(["dir/a.md", "a.md", "dir/z.md", "b.md"]);
    expect(a).toBe(b);
  });
});
