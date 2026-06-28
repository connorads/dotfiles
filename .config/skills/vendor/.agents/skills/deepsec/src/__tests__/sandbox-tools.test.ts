import { describe, expect, it } from "vitest";
import { buildInstallAgentToolsScript } from "../sandbox/setup.js";

describe("sandbox agent tools bootstrap", () => {
  it("installs fd for agent file search", () => {
    const script = buildInstallAgentToolsScript();
    expect(script).toContain("install_fd_from_github");
    expect(script).toContain("fd-find");
    expect(script).toContain("command -v fd");
  });
});
