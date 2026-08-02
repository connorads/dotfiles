import { expect, test, describe } from "bun:test";
import {
  skillToLine,
  skillsToLines,
  skillsToLinesWithFolders,
  renderSourcePreview,
  linesToRefs,
  skillRef,
} from "./display.ts";
import { parseRef } from "./ref.ts";
import type { DiscoveredSkill } from "./types.ts";

const skill = (name: string, description: string): DiscoveredSkill => ({
  source: { path: "/repo", name: "repo", exclude: [] },
  name,
  description,
  dir: `/repo/${name}`,
  files: ["SKILL.md"],
});

const inSource = (source: string, name: string): DiscoveredSkill => ({
  source: { path: `/${source}`, name: source, exclude: [] },
  name,
  description: "",
  dir: `/${source}/${name}`,
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

describe("skillsToLinesWithFolders", () => {
  test("leads each source block with a folder row carrying its count", () => {
    const lines = skillsToLinesWithFolders([
      inSource("elevenlabs", "agents"),
      inSource("elevenlabs", "tts"),
      inSource("expo", "router"),
    ]);
    expect(lines).toEqual([
      "elevenlabs/  (2)",
      "elevenlabs/agents",
      "elevenlabs/tts",
      "expo/  (1)",
      "expo/router",
    ]);
  });

  test("a folder row round-trips to a source ref", () => {
    const [folderLine] = skillsToLinesWithFolders([inSource("expo", "router")]);
    const ref = linesToRefs([folderLine ?? ""])[0] ?? "";
    expect(ref).toBe("expo/");
    expect(parseRef(ref)).toEqual({ kind: "source", source: "expo" });
  });

  test("empty skills → no lines", () => {
    expect(skillsToLinesWithFolders([])).toEqual([]);
  });
});

describe("renderSourcePreview", () => {
  test("header names the group and size, then member lines", () => {
    const members = [inSource("expo", "router"), inSource("expo", "web")];
    expect(renderSourcePreview("expo", members)).toBe(
      "expo/  (2 skills)\n\nexpo/router\nexpo/web",
    );
  });

  test("singular for one member", () => {
    expect(renderSourcePreview("expo", [inSource("expo", "router")])).toBe(
      "expo/  (1 skill)\n\nexpo/router",
    );
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
