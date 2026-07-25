import { expect, test, describe } from "bun:test";
import { parseRef } from "./ref.ts";

describe("parseRef", () => {
  test("bare name", () => {
    expect(parseRef("tdd")).toEqual({ kind: "bare", name: "tdd" });
  });
  test("qualified source/name", () => {
    expect(parseRef("agents/tdd")).toEqual({
      kind: "qualified",
      source: "agents",
      name: "tdd",
    });
  });
  test("splits on the FIRST slash only", () => {
    expect(parseRef("a/b/c")).toEqual({ kind: "qualified", source: "a", name: "b/c" });
  });
  test("trailing slash → whole-source ref", () => {
    expect(parseRef("expo/")).toEqual({ kind: "source", source: "expo" });
  });
  test("lone slash → empty source ref (resolve rejects)", () => {
    expect(parseRef("/")).toEqual({ kind: "source", source: "" });
  });
  test("empty string → bare empty name (resolve rejects)", () => {
    expect(parseRef("")).toEqual({ kind: "bare", name: "" });
  });
});
