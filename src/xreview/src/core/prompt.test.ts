import { expect, test } from "bun:test";
import { buildPrompt, fillTemplate } from "./prompt.ts";

test("slot text is not re-scanned for slots", () => {
  const r = fillTemplate("{{A}}|{{B}}", { A: "{{B}}", B: "b" });
  expect(r).toEqual({ ok: true, value: "{{B}}|b" });
});

test("an unfilled slot is an error, not a literal left in the prompt", () => {
  expect(fillTemplate("{{A}} {{Z}}", { A: "a" })).toEqual({ ok: false, error: "template slot(s) with no value: Z" });
});

test("empty inputs render as (none), guidance as tagged files", async () => {
  const template = await Bun.file(`${import.meta.dir}/../../prompts/review.md`).text();
  const r = buildPrompt(template, {
    guidance: [{ path: "AGENTS.md", text: "Use pnpm.\n" }],
    rubric: null,
    focus: "  ",
    context: "DIFF-HERE",
  });
  if (!r.ok) throw new Error(r.error);
  expect(r.value).toContain('<file path="AGENTS.md">\nUse pnpm.\n</file>');
  expect(r.value).toContain("<rubric>\nAdditional review criteria. Apply them in full.\n(none)\n</rubric>");
  expect(r.value).toContain("<focus>\n(none)\n</focus>");
  expect(r.value).toContain("DIFF-HERE");
  expect(r.value).not.toMatch(/\{\{[A-Z_]+\}\}/);
});

test.each(["review.md", "plan.md"])("%s fills every slot", async (name) => {
  const template = await Bun.file(`${import.meta.dir}/../../prompts/${name}`).text();
  const r = buildPrompt(template, { guidance: [], rubric: "R", focus: "F", context: "C" });
  if (!r.ok) throw new Error(r.error);
  expect(r.value).not.toMatch(/\{\{[A-Z_]+\}\}/);
});
