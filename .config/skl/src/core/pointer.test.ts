import { expect, test, describe } from "bun:test";
import { renderPointer } from "./pointer.ts";
import type { DiscoveredSkill } from "./types.ts";

const skill: DiscoveredSkill = {
  source: { path: "/repo", name: "repo", exclude: [] },
  name: "alpha",
  description: "A skill.",
  dir: "/repo/alpha",
  files: ["SKILL.md", "references/guide.md"],
};

describe("renderPointer", () => {
  test("skillName is the bare visible name", () => {
    expect(renderPointer(skill).skillName).toBe("alpha");
  });

  test("bulk contains source/name tag, description, tree, and read instruction", () => {
    const { bulk } = renderPointer(skill);
    expect(bulk).toContain("(skl: repo/alpha)");
    expect(bulk).toContain("A skill.");
    expect(bulk).toContain("├── SKILL.md");
    expect(bulk).toContain("Read SKILL.md at /repo/alpha/SKILL.md and follow it.");
  });

  test("bulk states the path once — no bare dir line, only inside the instruction", () => {
    const { bulk } = renderPointer(skill);
    expect(bulk).toContain("/repo/alpha/SKILL.md");
    expect(bulk).not.toMatch(/^\/repo\/alpha$/m);
  });

  test("empty description omits the description line (no stray blank under the tag)", () => {
    const { bulk } = renderPointer({ ...skill, description: "" });
    expect(bulk.startsWith("(skl: repo/alpha)\n\n")).toBe(true);
  });

  test("multi-line description is flattened to one line", () => {
    const { bulk } = renderPointer({ ...skill, description: "Line one.\nLine two." });
    expect(bulk).toContain("Line one. Line two.");
  });

  test("bulk does NOT inline the SKILL.md content (progressive disclosure)", () => {
    const { bulk } = renderPointer(skill);
    expect(bulk).not.toContain("# Alpha");
  });
});
