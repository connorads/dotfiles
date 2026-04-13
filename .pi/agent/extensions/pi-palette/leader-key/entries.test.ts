import { describe, it, expect } from "vitest";
import { buildEntries } from "./entries.js";

// Minimal command fixture
function makeCommands(
  cmds: Array<{ name: string; description: string; source: string }>,
) {
  return cmds.map((c) => ({
    name: c.name,
    description: c.description,
    source: c.source,
    sourceInfo: { scope: "global" },
  }));
}

describe("buildEntries", () => {
  it("includes search action at the top", () => {
    const entries = buildEntries([], "x/m", "off");
    const search = entries.find(
      (e) => e.type === "action" && e.key === "/",
    );
    expect(search).toBeDefined();
    if (search!.type === "action") {
      expect(search!.label).toBe("Search");
    }
    // Should be the first entry
    expect(entries[0]!.type).toBe("action");
    if (entries[0]!.type === "action") {
      expect(entries[0]!.key).toBe("/");
    }
  });

  it("always includes session group", () => {
    const entries = buildEntries([], "anthropic/claude-sonnet", "medium");
    const session = entries.find(
      (e) => e.type === "group" && e.group.key === "s",
    );
    expect(session).toBeDefined();
    expect(session!.type).toBe("group");
    if (session!.type === "group") {
      expect(session!.group.items.length).toBeGreaterThan(0);
    }
  });

  it("includes model action with current model", () => {
    const entries = buildEntries([], "anthropic/claude-sonnet", "medium");
    const model = entries.find(
      (e) => e.type === "action" && e.key === "m",
    );
    expect(model).toBeDefined();
    expect(model!.type).toBe("action");
    if (model!.type === "action") {
      expect(model!.description).toContain("claude-sonnet");
    }
  });

  it("includes thinking group with all levels and current indicator", () => {
    const entries = buildEntries([], "x/model", "high");
    const thinking = entries.find(
      (e) => e.type === "group" && e.group.key === "t",
    );
    expect(thinking).toBeDefined();
    if (thinking!.type === "group") {
      expect(thinking!.group.label).toContain("high");
      expect(thinking!.group.items).toHaveLength(6);
      const current = thinking!.group.items.find((i) => i.label === "high");
      expect(current?.description).toBe("current");
      const other = thinking!.group.items.find((i) => i.label === "off");
      expect(other?.description).toBeUndefined();
    }
  });

  it("includes extension commands action when custom commands exist", () => {
    const commands = makeCommands([
      { name: "telescope", description: "fuzzy finder", source: "extension" },
      { name: "custom-tool", description: "a tool", source: "extension" },
    ]);
    const entries = buildEntries(commands, "x/m", "off");
    const ext = entries.find(
      (e) => e.type === "action" && e.key === "e",
    );
    expect(ext).toBeDefined();
  });

  it("excludes built-in commands from extensions action", () => {
    const commands = makeCommands([
      { name: "new", description: "new session", source: "extension" },
      { name: "resume", description: "resume", source: "extension" },
    ]);
    const entries = buildEntries(commands, "x/m", "off");
    // Only built-in commands -> no extensions entry
    const ext = entries.find(
      (e) => e.type === "action" && e.key === "e",
    );
    expect(ext).toBeUndefined();
  });

  it("includes skills action when skills exist", () => {
    const commands = makeCommands([
      { name: "my-skill", description: "does stuff", source: "skill" },
    ]);
    const entries = buildEntries(commands, "x/m", "off");
    const skills = entries.find(
      (e) => e.type === "action" && e.key === "k",
    );
    expect(skills).toBeDefined();
  });

  it("always includes exit action", () => {
    const entries = buildEntries([], "x/m", "off");
    const exit = entries.find(
      (e) => e.type === "action" && e.key === "q",
    );
    expect(exit).toBeDefined();
  });

  it("has no duplicate keys", () => {
    const commands = makeCommands([
      { name: "custom", description: "test", source: "extension" },
      { name: "my-skill", description: "test", source: "skill" },
    ]);
    const entries = buildEntries(commands, "x/m", "off");
    const keys = entries.map((e) =>
      e.type === "group" ? e.group.key : e.key,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});
