import { describe, expect, test } from "bun:test";
import { audit, buildChecks, type Check, type Probes } from "./checks.ts";
import { render } from "./render.ts";
import type { MiseConfig, Probe, ToolEntry, Verdict } from "./types.ts";

const CFG_PATH = "/home/u/.config/mise/config.toml";

const config = (tools: Record<string, ToolEntry>): MiseConfig => ({ path: CFG_PATH, tools });

const entry = (version: string | null, prerelease = false): ToolEntry => ({ version, prerelease });

/** Probes that fail the test if called - each case opts into what it needs. */
const noProbes: Probes = {
  miseLatest: () => Promise.reject(new Error("miseLatest not stubbed")),
  npmLatest: () => Promise.reject(new Error("npmLatest not stubbed")),
  ghStableRelease: () => Promise.reject(new Error("ghStableRelease not stubbed")),
};

const checkById = (id: string, probes: Probes = noProbes): Check => {
  const found = buildChecks(probes).find((c) => c.id === id);
  if (!found) throw new Error(`no check ${id}`);
  return found;
};

/** judge takes only values, so no stubbing is needed to exercise a branch. */
const verdict = (id: string, cfg: MiseConfig, probe: Probe): Verdict => {
  const check = checkById(id);
  return check.judge(check.readPin(cfg), probe, CFG_PATH);
};

const unavailable: Probe = { kind: "unavailable", why: "offline" };

describe("rembg", () => {
  const pinned = config({ "pipx:rembg": entry("2.0.69") });

  test("reads the exact pin out of [tools]", () => {
    expect(checkById("rembg").readPin(pinned)).toEqual({ kind: "pinned", version: "2.0.69" });
  });

  test("reports the check as droppable once the pin is gone", () => {
    const v = verdict("rembg", config({}), unavailable);
    expect(render(v)).toBe(`pin-audit: OK   rembg - exact pin gone from ${CFG_PATH}; drop this check`);
  });

  test("restates the guard as INFO, never deciding it mechanically", () => {
    const v = verdict("rembg", pinned, { kind: "latestVersion", version: "2.0.76" });
    expect(render(v)).toBe(
      "pin-audit: INFO rembg pinned 2.0.69, latest 2.0.76 - not mechanically checkable: before " +
        "bumping, recheck whether the numpy>=2.3 floor still breaks the numba/llvmlite chain",
    );
  });

  test("a failed probe degrades to 'unknown', not SKIP", () => {
    const v = verdict("rembg", pinned, unavailable);
    expect(v.kind).toBe("info");
    expect(v.detail).toContain("latest unknown");
  });
});

describe("sandbox-runtime", () => {
  const pinned = config({ "npm:@anthropic-ai/sandbox-runtime": entry("0.0.62") });

  test("reports the check as droppable once the pin is gone", () => {
    const v = verdict("sandbox-runtime", config({}), unavailable);
    expect(render(v)).toBe(
      `pin-audit: OK   sandbox-runtime - exact pin gone from ${CFG_PATH}; drop this check`,
    );
  });

  test("keeps the pin while upstream is still pre-1.0", () => {
    const v = verdict("sandbox-runtime", pinned, { kind: "latestVersion", version: "0.0.66" });
    expect(render(v)).toBe(
      "pin-audit: OK   sandbox-runtime 0.0.62 - latest 0.0.66 still pre-1.0; keep the exact pin",
    );
  });

  test("flags once 1.0+ lands", () => {
    const v = verdict("sandbox-runtime", pinned, { kind: "latestVersion", version: "1.0.0" });
    expect(render(v)).toBe(
      `pin-audit: FLAG sandbox-runtime 0.0.62 - 1.0.0 landed (1.0+); revisit the exact pin (${CFG_PATH} [tools])`,
    );
  });

  test("a failed probe degrades to SKIP", () => {
    const v = verdict("sandbox-runtime", pinned, unavailable);
    expect(render(v)).toBe(
      "pin-audit: SKIP sandbox-runtime 0.0.62 - npm probe failed (offline?)",
    );
  });

  test("an empty version listing is a failed probe, not a cleared condition", () => {
    const v = verdict("sandbox-runtime", pinned, { kind: "latestVersion", version: null });
    expect(v.kind).toBe("skip");
  });
});

describe("CosineAI/cli", () => {
  const flagged = config({ "github:CosineAI/cli": entry("2", true) });

  test("reads prerelease=true as the escape hatch, ignoring the version", () => {
    expect(checkById("CosineAI/cli").readPin(flagged)).toEqual({ kind: "flagSet" });
  });

  test("a version pin without prerelease=true is not the escape hatch", () => {
    const cfg = config({ "github:CosineAI/cli": entry("2") });
    expect(checkById("CosineAI/cli").readPin(cfg)).toEqual({ kind: "gone" });
  });

  test("reports the check as droppable once prerelease=true is gone", () => {
    const v = verdict("CosineAI/cli", config({}), unavailable);
    expect(render(v)).toBe(
      `pin-audit: OK   CosineAI/cli - prerelease=true gone from ${CFG_PATH}; drop this check`,
    );
  });

  test("keeps the flag while every versioned release is still pre-release", () => {
    const v = verdict("CosineAI/cli", flagged, { kind: "stableRelease", tag: null });
    expect(render(v)).toBe(
      "pin-audit: OK   CosineAI/cli - all versioned releases still pre-release; keep prerelease=true",
    );
  });

  test("flags once a stable release exists", () => {
    const v = verdict("CosineAI/cli", flagged, { kind: "stableRelease", tag: "v2.1.0" });
    expect(render(v)).toBe(
      `pin-audit: FLAG CosineAI/cli - stable release v2.1.0 exists; drop prerelease=true (${CFG_PATH} [tools])`,
    );
  });

  test("a failed probe degrades to SKIP", () => {
    const v = verdict("CosineAI/cli", flagged, unavailable);
    expect(render(v)).toBe(
      "pin-audit: SKIP CosineAI/cli prerelease=true - gh probe failed (gh auth/offline?)",
    );
  });
});

describe("audit", () => {
  const full = config({
    "pipx:rembg": entry("2.0.69"),
    "npm:@anthropic-ai/sandbox-runtime": entry("0.0.62"),
    "github:CosineAI/cli": entry("2", true),
  });

  test("returns verdicts in declaration order", async () => {
    const probes: Probes = {
      miseLatest: async () => ({ kind: "latestVersion", version: "2.0.76" }),
      npmLatest: async () => ({ kind: "latestVersion", version: "0.0.66" }),
      ghStableRelease: async () => ({ kind: "stableRelease", tag: null }),
    };
    const verdicts = await audit(full, buildChecks(probes));
    expect(verdicts.map((v) => v.kind)).toEqual(["info", "ok", "ok"]);
  });

  test("probes overlap rather than running one after another", async () => {
    const started: string[] = [];
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = (name: string) => async (): Promise<Probe> => {
      started.push(name);
      await gate;
      return unavailable;
    };
    const probes: Probes = {
      miseLatest: held("mise"),
      npmLatest: held("npm"),
      ghStableRelease: held("gh"),
    };

    const running = audit(full, buildChecks(probes));
    await Promise.resolve();
    // All three are blocked on the same gate, so none can have finished first.
    expect(started).toEqual(["mise", "npm", "gh"]);
    release();
    expect((await running).map((v) => v.kind)).toEqual(["info", "skip", "skip"]);
  });

  test("skips the probe entirely when the pin is already gone", async () => {
    const verdicts = await audit(config({}), buildChecks(noProbes));
    expect(verdicts.map((v) => v.kind)).toEqual(["ok", "ok", "ok"]);
  });
});
