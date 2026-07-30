import { expect, test } from "bun:test";
import { render } from "./render.ts";

test("every verdict tag occupies the same four columns", () => {
  const lines = (["ok", "flag", "info", "skip"] as const).map((kind) =>
    render({ kind, detail: "x" }),
  );
  expect(lines).toEqual([
    "pin-audit: OK   x",
    "pin-audit: FLAG x",
    "pin-audit: INFO x",
    "pin-audit: SKIP x",
  ]);
  expect(new Set(lines.map((l) => l.indexOf("x"))).size).toBe(1);
});
