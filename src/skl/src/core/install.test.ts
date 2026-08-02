import { expect, test, describe } from "bun:test";
import { buildInstallPlan } from "./install.ts";
import type { DiscoveredSkill, Source } from "./types.ts";

const expo: Source = { path: "/sets/expo/.agents/skills", name: "expo", exclude: [] };
const eleven: Source = { path: "/sets/elevenlabs/.agents/skills", name: "elevenlabs", exclude: [] };

const skill = (source: Source, name: string): DiscoveredSkill => ({
  source,
  name,
  description: "",
  dir: `${source.path}/${name}`,
  files: ["SKILL.md"],
});

describe("buildInstallPlan", () => {
  test("groups skills by source root, carrying names in order", () => {
    const plan = buildInstallPlan(
      [skill(expo, "expo-router"), skill(expo, "expo-ui")],
      { global: false },
    );
    expect(plan).toEqual([
      { sourceRoot: "/sets/expo/.agents/skills", names: ["expo-router", "expo-ui"], global: false },
    ]);
  });

  test("one group per distinct source, in first-seen order", () => {
    const plan = buildInstallPlan(
      [skill(expo, "expo-router"), skill(eleven, "music"), skill(expo, "expo-ui")],
      { global: false },
    );
    expect(plan.map((g) => g.sourceRoot)).toEqual([
      "/sets/expo/.agents/skills",
      "/sets/elevenlabs/.agents/skills",
    ]);
    expect(plan[0]?.names).toEqual(["expo-router", "expo-ui"]);
    expect(plan[1]?.names).toEqual(["music"]);
  });

  test("propagates the global flag onto every group", () => {
    const plan = buildInstallPlan([skill(expo, "expo-router")], { global: true });
    expect(plan[0]?.global).toBe(true);
  });

  test("no skills → no groups", () => {
    expect(buildInstallPlan([], { global: false })).toEqual([]);
  });
});
