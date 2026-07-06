import { expect, test, describe } from "bun:test";
import { skillToLine, skillsToLines, linesToRefs, skillRef } from "./display.ts";
import type { DiscoveredSkill } from "./types.ts";

const skill = (name: string, description: string): DiscoveredSkill => ({
  source: { path: "/repo", name: "repo", exclude: [] },
  name,
  description,
  dir: `/repo/${name}`,
  files: ["SKILL.md"],
});

describe("skillToLine", () => {
  test("ref then description, ref is the first token (fzf {1})", () => {
    const line = skillToLine(skill("alpha", "A skill."));
    expect(line).toBe("repo/alpha  A skill.");
  });

  test("multiline description flattened to one line", () => {
    const line = skillToLine(skill("beta", "one\ntwo\n  three"));
    expect(line).toBe("repo/beta  one two three");
  });

  test("empty description leaves the bare ref", () => {
    expect(skillToLine(skill("noname", ""))).toBe("repo/noname");
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

  test("ignores blank lines and takes the first token", () => {
    expect(linesToRefs(["", "repo/alpha  some description"])).toEqual(["repo/alpha"]);
  });
});
