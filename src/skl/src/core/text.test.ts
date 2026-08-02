import { expect, test, describe } from "bun:test";
import { flatten } from "./text.ts";

describe("flatten", () => {
  test("collapses newlines to a single space", () => {
    expect(flatten("Line one.\nLine two.")).toBe("Line one. Line two.");
  });

  test("collapses runs of spaces", () => {
    expect(flatten("a    b")).toBe("a b");
  });

  test("trims leading and trailing whitespace", () => {
    expect(flatten("  hello \n")).toBe("hello");
  });

  test("empty string stays empty", () => {
    expect(flatten("")).toBe("");
  });
});
