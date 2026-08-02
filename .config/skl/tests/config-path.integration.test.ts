// Where `skl` looks for config.json. The default is an XDG lookup, not a path
// relative to the source, so the implementation can live in ~/src while its
// config stays in ~/.config (ADR 0006, dotfiles repo). `SKL_CONFIG` overrides
// the file for tests and one-offs; `--path` is a different lever - it replaces
// the sources entirely and never reads a config file at all.
//
// Every case asserts on a fixture-only skill ref (`repo/alpha`), so a run that
// silently fell back to the real ~/.config/skl/config.json fails rather than
// passing on the user's own catalogue.

import { expect, test, describe } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../src/cli.ts");
const REPO = resolve(import.meta.dir, "fixtures/repo");

/** A clean environment: neither seam set, so each case opts into exactly one. */
const baseEnv = (): Record<string, string> => {
  const env = { ...process.env } as Record<string, string>;
  delete env["SKL_CONFIG"];
  delete env["XDG_CONFIG_HOME"];
  return env;
};

const runList = (overrides: Record<string, string>, ...args: string[]) =>
  Bun.spawnSync([process.execPath, CLI, "list", ...args], {
    env: { ...baseEnv(), ...overrides },
  });

const writeConfig = (file: string): Promise<number> =>
  Bun.write(file, JSON.stringify({ paths: [{ path: REPO, name: "repo" }] }));

describe("config file lookup", () => {
  test("SKL_CONFIG names the config file outright", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skl-config-"));
    const file = join(dir, "elsewhere.json");
    await writeConfig(file);

    const out = runList({ SKL_CONFIG: file });
    expect(out.stderr.toString()).toBe("");
    expect(out.exitCode).toBe(0);
    expect(out.stdout.toString()).toContain("repo/alpha");
  });

  test("default is $XDG_CONFIG_HOME/skl/config.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skl-xdg-"));
    await writeConfig(join(dir, "skl", "config.json"));

    const out = runList({ XDG_CONFIG_HOME: dir });
    expect(out.stderr.toString()).toBe("");
    expect(out.exitCode).toBe(0);
    expect(out.stdout.toString()).toContain("repo/alpha");
  });

  test("with no XDG_CONFIG_HOME the default falls back to $HOME/.config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skl-home-"));
    await writeConfig(join(dir, ".config", "skl", "config.json"));

    const out = runList({ HOME: dir });
    expect(out.stderr.toString()).toBe("");
    expect(out.exitCode).toBe(0);
    expect(out.stdout.toString()).toContain("repo/alpha");
  });

  test("a missing config file is an error, not a silent fallback", () => {
    const out = runList({ XDG_CONFIG_HOME: join(tmpdir(), "skl-absent-config") });
    expect(out.exitCode).not.toBe(0);
  });

  test("--path bypasses the config file entirely", () => {
    const out = runList({ XDG_CONFIG_HOME: join(tmpdir(), "skl-absent-config") }, "--path", REPO);
    expect(out.exitCode).toBe(0);
    expect(out.stdout.toString()).toContain("repo/alpha");
  });
});
