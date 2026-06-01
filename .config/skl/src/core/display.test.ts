import { expect, test, describe } from "bun:test";
import { skillToLine, skillsToLines, linesToRefs, skillRef } from "./display.ts";
import type { DiscoveredSkill } from "./types.ts";

const skill = (name: string, description: string): DiscoveredSkill => ({
  source: { path: "/repo", name: "repo" },
  name,
  description,
  dir: `/repo/${name}`,
  files: ["SKILL.md"],
});

describe("skillToLine", () => {
  test("ref key is column 1, visible text column 2", () => {
    const line = skillToLine(skill("alpha", "A skill."));
    expect(line).toBe("repo/alpha\trepo/alpha  A skill.");
  });

  test("multiline description flattened to one line", () => {
    const line = skillToLine(skill("beta", "one\ntwo\n  three"));
    expect(line).toBe("repo/beta\trepo/beta  one two three");
  });

  test("empty description omits the separator", () => {
    expect(skillToLine(skill("noname", ""))).toBe("repo/noname\trepo/noname");
  });
});

describe("skillRef", () => {
  test("source/name", () => {
    expect(skillRef(skill("alpha", ""))).toBe("repo/alpha");
  });
});

describe("linesToRefs", () => {
  test("round-trips refs out of selected lines", () => {
    const lines = skillsToLines([skill("alpha", "A"), skill("beta", "B")]);
    expect(linesToRefs(lines)).toEqual(["repo/alpha", "repo/beta"]);
  });

  test("ignores blank lines", () => {
    expect(linesToRefs(["", "repo/alpha\tx"])).toEqual(["repo/alpha"]);
  });
});
