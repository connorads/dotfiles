import { expect, test } from "vitest";
import { countWords } from "./count.js";

test("counts words", () => {
  expect(countWords("a b  c")).toBe(3);
});
