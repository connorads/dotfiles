import { expect, test, describe } from "bun:test";
import { historyLine, summariseHistory, renderHistory } from "./history.ts";
import type { DiscoveredSkill } from "./types.ts";

const skill = (source: string, name: string): DiscoveredSkill => ({
  source: { path: `/${source}`, name: source, exclude: [] },
  name,
  description: "",
  dir: `/${source}/${name}`,
  files: ["SKILL.md"],
});

const record = (source: string, name: string, ts: string): string =>
  historyLine(skill(source, name), "inject", "%1", false, ts);

describe("historyLine", () => {
  test("one JSON line with trailing newline, ts passed through", () => {
    const line = historyLine(skill("repo", "alpha"), "inject", "%3", true, "2026-07-16T10:00:00.000Z");
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({
      schema_version: 1,
      ts: "2026-07-16T10:00:00.000Z",
      source: "repo",
      name: "alpha",
      mode: "inject",
      target: "%3",
      submit: true,
    });
  });

  test("copy mode carries a null target", () => {
    const line = historyLine(skill("repo", "alpha"), "copy", null, false, "2026-07-16T10:00:00.000Z");
    expect(JSON.parse(line)).toMatchObject({ mode: "copy", target: null, submit: false });
  });
});

describe("summariseHistory", () => {
  test("empty text → no rows", () => {
    expect(summariseHistory("")).toEqual([]);
  });

  test("counts per source/name, last = latest ts", () => {
    const text =
      record("repo", "alpha", "2026-07-01T00:00:00.000Z") +
      record("repo", "alpha", "2026-07-16T00:00:00.000Z") +
      record("repo", "alpha", "2026-07-10T00:00:00.000Z") +
      record("vendor", "beta", "2026-07-02T00:00:00.000Z");
    expect(summariseHistory(text)).toEqual([
      { ref: "repo/alpha", count: 3, last: "2026-07-16T00:00:00.000Z" },
      { ref: "vendor/beta", count: 1, last: "2026-07-02T00:00:00.000Z" },
    ]);
  });

  test("sorts by count desc, then ref asc for ties", () => {
    const text =
      record("b", "one", "2026-07-01T00:00:00.000Z") +
      record("a", "two", "2026-07-01T00:00:00.000Z") +
      record("c", "big", "2026-07-01T00:00:00.000Z") +
      record("c", "big", "2026-07-02T00:00:00.000Z");
    expect(summariseHistory(text).map((r) => r.ref)).toEqual(["c/big", "a/two", "b/one"]);
  });

  test("skips blank and malformed lines rather than erroring", () => {
    const text = [
      "",
      "not json at all",
      '{"truncated": ',
      '"a bare json string"',
      '{"schema_version":1,"ts":"2026-07-16T00:00:00.000Z","name":"missing-source"}',
      record("repo", "alpha", "2026-07-16T00:00:00.000Z").trimEnd(),
      "  ",
    ].join("\n");
    expect(summariseHistory(text)).toEqual([
      { ref: "repo/alpha", count: 1, last: "2026-07-16T00:00:00.000Z" },
    ]);
  });

  test("tolerates a record without ts", () => {
    const text = '{"schema_version":1,"source":"repo","name":"alpha","mode":"inject","target":null,"submit":false}\n';
    expect(summariseHistory(text)).toEqual([{ ref: "repo/alpha", count: 1, last: "" }]);
  });
});

describe("renderHistory", () => {
  test("count-aligned rows with date-only last", () => {
    expect(
      renderHistory([
        { ref: "vendor/grilling", count: 42, last: "2026-07-16T10:00:00.000Z" },
        { ref: "mine/tdd", count: 3, last: "2026-07-02T09:00:00.000Z" },
      ]),
    ).toEqual(["42  vendor/grilling  last 2026-07-16", " 3  mine/tdd  last 2026-07-02"]);
  });

  test("omits the last-date suffix when no record carried a ts", () => {
    expect(renderHistory([{ ref: "repo/alpha", count: 1, last: "" }])).toEqual(["1  repo/alpha"]);
  });
});
