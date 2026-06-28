import { defineConfig, setLoadedConfig } from "@deepsec/core";
import { afterEach, describe, expect, it } from "vitest";
import { resolveProjectId } from "../resolve-project-id.js";

describe("resolveProjectId", () => {
  afterEach(() => {
    setLoadedConfig(defineConfig({ projects: [] }));
  });

  it("returns the user-provided id when given", () => {
    setLoadedConfig(
      defineConfig({
        projects: [
          { id: "alpha", root: "/tmp/a" },
          { id: "beta", root: "/tmp/b" },
        ],
      }),
    );
    expect(resolveProjectId("beta")).toBe("beta");
    expect(resolveProjectId("anything")).toBe("anything");
  });

  it("auto-resolves to the only project when config has exactly one", () => {
    setLoadedConfig(defineConfig({ projects: [{ id: "lone", root: "/tmp/l" }] }));
    expect(resolveProjectId(undefined)).toBe("lone");
  });

  it("throws with all ids listed when config has multiple projects", () => {
    setLoadedConfig(
      defineConfig({
        projects: [
          { id: "alpha", root: "/a" },
          { id: "beta", root: "/b" },
          { id: "gamma", root: "/g" },
        ],
      }),
    );
    expect(() => resolveProjectId(undefined)).toThrow(/alpha, beta, gamma/);
    expect(() => resolveProjectId(undefined)).toThrow(/Pass --project-id/);
  });

  it("throws with init guidance when config has no projects", () => {
    setLoadedConfig(defineConfig({ projects: [] }));
    expect(() => resolveProjectId(undefined)).toThrow(/no projects found/);
    expect(() => resolveProjectId(undefined)).toThrow(/deepsec init/);
  });
});
