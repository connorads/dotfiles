import { describe, expect, test } from "bun:test";
import { parseMiseConfig } from "./config.ts";

const PATH = "/cfg/config.toml";

const parsed = (text: string) => {
  const read = parseMiseConfig(text, PATH);
  if (read.kind !== "config") throw new Error(`unparseable: ${read.why}`);
  return read.config;
};

describe("parseMiseConfig", () => {
  test("normalises the bare-string and table forms alike", () => {
    const cfg = parsed(`
[tools]
"npm:@anthropic-ai/sandbox-runtime" = "0.0.62"
"pipx:rembg" = { version = "2.0.69", extras = "cli,cpu" }
"github:CosineAI/cli" = { version = "2", bin = "cos", prerelease = true }
`);
    expect(cfg.tools).toEqual({
      "npm:@anthropic-ai/sandbox-runtime": { version: "0.0.62", prerelease: false },
      "pipx:rembg": { version: "2.0.69", prerelease: false },
      "github:CosineAI/cli": { version: "2", prerelease: true },
    });
  });

  test("reads structure, so reformatting an entry cannot hide a pin", () => {
    const inline = parsed(`[tools]\n"pipx:rembg" = { version = "2.0.69" }\n`);
    const expanded = parsed(`[tools."pipx:rembg"]\nversion = "2.0.69"\n`);
    expect(expanded.tools).toEqual(inline.tools);
  });

  test("a table without a version key is a tool with no pin", () => {
    const cfg = parsed(`[tools]\n"github:CosineAI/cli" = { prerelease = true }\n`);
    expect(cfg.tools["github:CosineAI/cli"]).toEqual({ version: null, prerelease: true });
  });

  test("keys outside [tools] are not tools", () => {
    const cfg = parsed(`"pipx:rembg" = "2.0.69"\n[settings]\nidiomatic_version_file = true\n`);
    expect(cfg.tools).toEqual({});
  });

  test("a config with no [tools] table has no pins", () => {
    expect(parsed(`[settings]\nlockfile = true\n`).tools).toEqual({});
  });

  test("broken TOML is reported, never read as 'no pins'", () => {
    const read = parseMiseConfig(`[tools\n"pipx:rembg" = "2.0.69"\n`, PATH);
    expect(read.kind).toBe("unparseable");
    if (read.kind !== "unparseable") return;
    expect(read.path).toBe(PATH);
    expect(read.why).not.toContain("\n");
  });
});
