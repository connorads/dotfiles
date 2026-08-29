import { describe, expect, test } from "bun:test";
import { exitCodeFor, isFailure, type Outcome } from "./exit.ts";

describe("exitCodeFor", () => {
  test("maps each outcome to the shared agent contract", () => {
    const cases: readonly (readonly [Outcome, number])[] = [
      [{ kind: "ok" }, 0],
      [{ kind: "store", message: "" }, 1],
      [{ kind: "usage", message: "" }, 2],
      [{ kind: "unresolvable", message: "" }, 3],
      [{ kind: "refused", message: "" }, 4],
      [{ kind: "stall", message: "" }, 5],
    ];
    for (const [outcome, code] of cases) expect(exitCodeFor(outcome)).toBe(code);
  });

  // Pressing the capture key with nothing selected must not beep in the middle
  // of a review, so every benign no-op has to land on 0.
  test("a benign no-op carrying a message is still success", () => {
    expect(exitCodeFor({ kind: "ok", message: "annotate: nothing selected" })).toBe(0);
  });
});

describe("isFailure", () => {
  test("only ok goes to stdout", () => {
    expect(isFailure({ kind: "ok" })).toBe(false);
    expect(isFailure({ kind: "store", message: "" })).toBe(true);
    expect(isFailure({ kind: "refused", message: "" })).toBe(true);
  });
});
