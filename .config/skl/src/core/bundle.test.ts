import { expect, test, describe } from "bun:test";
import { renderBundle } from "./bundle.ts";
import type { DiscoveredSkill } from "./types.ts";

const skill: DiscoveredSkill = {
  source: { path: "/repo", name: "repo", exclude: [] },
  name: "alpha",
  description: "A skill.",
  dir: "/repo/alpha",
  files: ["SKILL.md", "references/guide.md"],
};

describe("renderBundle", () => {
  test("opens with a skill tag carrying name and source, closes with </skill>", () => {
    const out = renderBundle(skill, [{ path: "SKILL.md", content: "# Alpha" }]);
    expect(out.startsWith('<skill name="alpha" source="repo">\n')).toBe(true);
    expect(out.endsWith("\n</skill>")).toBe(true);
  });

  test("inlines each file's content under a path-tagged block (the pointer's inverse)", () => {
    const out = renderBundle(skill, [
      { path: "SKILL.md", content: "# Alpha\nbody" },
      { path: "references/guide.md", content: "guide" },
    ]);
    expect(out).toContain('<file path="SKILL.md">\n# Alpha\nbody\n</file>');
    expect(out).toContain('<file path="references/guide.md">\nguide\n</file>');
  });

  test("files appear in the given order", () => {
    const out = renderBundle(skill, [
      { path: "SKILL.md", content: "a" },
      { path: "references/guide.md", content: "b" },
    ]);
    expect(out.indexOf("SKILL.md")).toBeLessThan(out.indexOf("references/guide.md"));
  });

  test("trailing newlines in content are normalised to one before the close tag", () => {
    const out = renderBundle(skill, [{ path: "SKILL.md", content: "x\n\n\n" }]);
    expect(out).toContain('<file path="SKILL.md">\nx\n</file>');
  });

  test("no files → just the wrapping tags", () => {
    expect(renderBundle(skill, [])).toBe('<skill name="alpha" source="repo">\n</skill>');
  });

  test("preserves fenced code blocks verbatim (the reason for tags over fences)", () => {
    const content = "```ts\nconst x = 1;\n```";
    const out = renderBundle(skill, [{ path: "SKILL.md", content }]);
    expect(out).toContain(content);
  });
});
