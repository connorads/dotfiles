import { expect, test, describe } from "bun:test";
import { buildSkill } from "./discover.ts";
import type { Source } from "./types.ts";

const source: Source = { path: "/root", name: "repo" };

describe("buildSkill", () => {
  test("uses frontmatter name + description, absolute dir, sorted files", () => {
    const skill = buildSkill({
      source,
      relPath: "alpha/SKILL.md",
      raw: "---\nname: alpha\ndescription: A skill.\n---\n",
      siblingFiles: ["references/guide.md", "SKILL.md"],
    });
    expect(skill.name).toBe("alpha");
    expect(skill.description).toBe("A skill.");
    expect(skill.dir).toBe("/root/alpha");
    expect(skill.files).toEqual(["SKILL.md", "references/guide.md"]);
  });

  test("nested skill: dir reflects depth", () => {
    const skill = buildSkill({
      source,
      relPath: "nested/deep/beta/SKILL.md",
      raw: "---\nname: beta\n---\n",
      siblingFiles: ["SKILL.md"],
    });
    expect(skill.dir).toBe("/root/nested/deep/beta");
    expect(skill.name).toBe("beta");
  });

  test("missing name falls back to dir basename", () => {
    const skill = buildSkill({
      source,
      relPath: "noname/SKILL.md",
      raw: "---\ndescription: no name\n---\n",
      siblingFiles: ["SKILL.md"],
    });
    expect(skill.name).toBe("noname");
    expect(skill.description).toBe("no name");
  });

  test("malformed frontmatter: basename name, empty description, never throws", () => {
    const skill = buildSkill({
      source,
      relPath: "malformed/SKILL.md",
      raw: "---\n- a\n- b\n---\n",
      siblingFiles: ["SKILL.md"],
    });
    expect(skill.name).toBe("malformed");
    expect(skill.description).toBe("");
  });

  test("no frontmatter at all: basename name, empty description", () => {
    const skill = buildSkill({
      source,
      relPath: "nofm/SKILL.md",
      raw: "# heading only\n",
      siblingFiles: ["SKILL.md"],
    });
    expect(skill.name).toBe("nofm");
    expect(skill.description).toBe("");
  });
});
