import { describe, it, expect } from "vitest";
import { clearanceMinutes, acceptHeight } from "./core";
describe("queue clearance", () => {
  it("uses spare capacity to drain the backlog", () => {
    expect(clearanceMinutes(12, 5, 3, 60)).toBe(20);
    expect(clearanceMinutes(12, 5, 4, 60)).toBe(7.5);
    expect(clearanceMinutes(10, 5, 2, 60)).toBe(null);
    expect(clearanceMinutes(0, 5, 2, 60)).toBe(6);
    expect(clearanceMinutes(12, 5, 2, 60)).toBe(null);
  });
});
describe("sandbox height messages", () => {
  const frame = {};
  it("accepts only this iframe and its nonce", () => {
    const data = { type: "visual-height", nonce: "n", height: 300 };
    expect(acceptHeight({}, frame, data, "n")).toBe(null);
    expect(acceptHeight(frame, frame, { ...data, nonce: "other" }, "n")).toBe(null);
    expect(acceptHeight(frame, frame, data, "n")).toBe(300);
  });
  it("rejects invalid values and bounds excessive content", () => {
    for (const height of [NaN, Infinity, -1, "300"]) {
      expect(acceptHeight(frame, frame, { type: "visual-height", nonce: "n", height }, "n")).toBe(null);
    }
    expect(acceptHeight(frame, frame, { type: "visual-height", nonce: "n", height: 5000 }, "n")).toBe(1200);
    expect(acceptHeight(frame, frame, { type: "visual-height", nonce: "n", height: 0 }, "n")).toBe(1);
  });
});
