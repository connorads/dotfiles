import { expect, test, describe } from "bun:test";
import { renderPointer } from "./pointer.ts";
import type { DiscoveredSkill } from "./types.ts";

const skill: DiscoveredSkill = {
  source: { path: "/repo", name: "repo" },
  name: "alpha",
  description: "A skill.",
  dir: "/repo/alpha",
  files: ["SKILL.md", "references/guide.md"],
};

describe("renderPointer", () => {
  test("skillName is the bare visible name", () => {
    expect(renderPointer(skill).skillName).toBe("alpha");
  });

  test("bulk contains source/name tag, absolute path, tree, and read instruction", () => {
    const { bulk } = renderPointer(skill);
    expect(bulk).toContain("(skl: repo/alpha)");
    expect(bulk).toContain("/repo/alpha");
    expect(bulk).toContain("├── SKILL.md");
    expect(bulk).toContain("Read SKILL.md at /repo/alpha/SKILL.md and follow it.");
  });

  test("bulk does NOT inline the SKILL.md content (progressive disclosure)", () => {
    const { bulk } = renderPointer(skill);
    expect(bulk).not.toContain("# Alpha");
  });
});
