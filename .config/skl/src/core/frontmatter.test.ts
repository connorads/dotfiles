import { expect, test, describe } from "bun:test";
import { parseFrontmatter } from "./frontmatter.ts";

describe("parseFrontmatter", () => {
  test("reads name and description from a mapping", () => {
    const r = parseFrontmatter("---\nname: alpha\ndescription: A skill.\n---\nbody");
    expect(r).toEqual({ ok: true, value: { name: "alpha", description: "A skill." } });
  });

  test("missing name → name null, keeps description", () => {
    const r = parseFrontmatter("---\ndescription: no name here\n---\n");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBeNull();
      expect(r.value.description).toBe("no name here");
    }
  });

  test("no fenced block → no-frontmatter error", () => {
    const r = parseFrontmatter("# Just a heading\n");
    expect(r).toEqual({ ok: false, error: { kind: "no-frontmatter" } });
  });

  test("non-mapping (YAML list) → name-not-string (not a throw)", () => {
    const r = parseFrontmatter("---\n- a\n- b\n---\n");
    expect(r).toEqual({ ok: false, error: { kind: "name-not-string" } });
  });

  test("name present but not a string → name-not-string", () => {
    const r = parseFrontmatter("---\nname: 42\n---\n");
    expect(r).toEqual({ ok: false, error: { kind: "name-not-string" } });
  });

  test("preserves a multiline (block scalar) description", () => {
    const r = parseFrontmatter("---\nname: beta\ndescription: |\n  one\n  two\n---\n");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.description).toContain("one");
  });
});
