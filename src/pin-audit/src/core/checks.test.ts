import { describe, expect, test } from "bun:test";
import { audit, buildChecks, type Check, type Probes } from "./checks.ts";
import { render } from "./render.ts";
import type { DriftRow, MiseConfig, Probe, ToolEntry, Verdict } from "./types.ts";

const CFG_PATH = "/home/u/.config/mise/config.toml";

const config = (tools: Record<string, ToolEntry>): MiseConfig => ({ path: CFG_PATH, tools });

const entry = (version: string | null, prerelease = false): ToolEntry => ({ version, prerelease });

/** Probes that fail the test if called - each case opts into what it needs. */
const noProbes: Probes = {
  miseLatest: () => Promise.reject(new Error("miseLatest not stubbed")),
  npmLatest: () => Promise.reject(new Error("npmLatest not stubbed")),
  ghStableRelease: () => Promise.reject(new Error("ghStableRelease not stubbed")),
  miseOutdatedBump: () => Promise.reject(new Error("miseOutdatedBump not stubbed")),
};

/** drift always probes, so cases that don't exercise it still need it answered. */
const quietDrift: Probes = { ...noProbes, miseOutdatedBump: async () => noDrift };

const checkById = (id: string, probes: Probes = noProbes): Check => {
  const found = buildChecks(probes).find((c) => c.id === id);
  if (!found) throw new Error(`no check ${id}`);
  return found;
};

/** judge takes only values, so no stubbing is needed to exercise a branch. */
const verdicts = (id: string, cfg: MiseConfig, probe: Probe): readonly Verdict[] => {
  const check = checkById(id);
  const judged = check.judge(check.readPin(cfg), probe, CFG_PATH);
  return Array.isArray(judged) ? judged : [judged as Verdict];
};

/** The conditional checks each yield exactly one verdict. */
const verdict = (id: string, cfg: MiseConfig, probe: Probe): Verdict => {
  const got = verdicts(id, cfg, probe);
  if (got.length !== 1) throw new Error(`${id} yielded ${got.length} verdicts, expected 1`);
  return got[0] as Verdict;
};

const unavailable: Probe = { kind: "unavailable", why: "offline" };

const row = (tool: string, requested: string, bump: string | null, latest: string): DriftRow => ({
  tool,
  requested,
  current: `${requested}.0`,
  bump,
  latest,
});

const noDrift: Probe = { kind: "outdated", rows: [] };

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

describe("drift", () => {
  const anyCfg = config({});

  test("stays silent while every range pin still covers the newest release", () => {
    const got = verdicts("drift", anyCfg, {
      kind: "outdated",
      rows: [row("uv", "0.11", null, "0.11.33"), row("node", "lts", null, "26.7.0")],
    });
    expect(got.map(render)).toEqual([
      "pin-audit: OK   drift - every range pin still covers the newest release",
    ]);
  });

  test("flags a range pin the newest release has outgrown", () => {
    const got = verdicts("drift", anyCfg, {
      kind: "outdated",
      rows: [row("uv", "0.11", "0.12", "0.12.4")],
    });
    expect(got.map(render)).toEqual([
      "pin-audit: FLAG uv pinned 0.11, 0.12.4 available - `mise upgrade` cannot cross this " +
        `range; bump the pin or run \`mise upgrade --bump uv\` (${CFG_PATH} [tools])`,
    ]);
  });

  test("counts the majors when a pin has fallen more than one behind", () => {
    const got = verdicts("drift", anyCfg, {
      kind: "outdated",
      rows: [row("usage", "3", "5", "5.1.0")],
    });
    expect(got[0]?.detail).toContain("usage pinned 3, 5.1.0 available (2 majors)");
  });

  test("emits one verdict per drifted tool, undrifted ones filtered out", () => {
    const got = verdicts("drift", anyCfg, {
      kind: "outdated",
      rows: [
        row("uv", "0.11", "0.12", "0.12.4"),
        row("node", "lts", null, "26.7.0"),
        row("gcloud", "573", "580", "580.0.0"),
      ],
    });
    expect(got.map((v) => v.kind)).toEqual(["flag", "flag"]);
    expect(got.map((v) => v.detail.split(" ")[0])).toEqual(["uv", "gcloud"]);
  });

  test("never flags a deliberate pin - those are the conditional checks' job", () => {
    const got = verdicts("drift", anyCfg, {
      kind: "outdated",
      rows: [
        row("npm:executor", "1", "2", "2.0.0"),
        row("pipx:rembg", "2.0.69", "2.0.78", "2.0.78"),
        row("npm:@anthropic-ai/sandbox-runtime", "0.0.62", "0.0.73", "0.0.73"),
        row("amp", "0.0.1783547350-gd57707", "0.0.1787054623-g28e34d", "0.0.1787054623-g28e34d"),
      ],
    });
    expect(got.map((v) => v.kind)).toEqual(["ok"]);
  });

  test("a failed probe degrades to SKIP, never to a false all-clear", () => {
    const got = verdicts("drift", anyCfg, unavailable);
    expect(got.map(render)).toEqual([
      "pin-audit: SKIP drift - `mise outdated --bump` failed (offline?)",
    ]);
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
      miseOutdatedBump: async () => noDrift,
    };
    const got = await audit(full, buildChecks(probes));
    expect(got.map((v) => v.kind)).toEqual(["info", "ok", "ok", "ok"]);
  });

  test("flattens drift's per-tool verdicts in with the conditional ones", async () => {
    const probes: Probes = {
      miseLatest: async () => ({ kind: "latestVersion", version: "2.0.76" }),
      npmLatest: async () => ({ kind: "latestVersion", version: "0.0.66" }),
      ghStableRelease: async () => ({ kind: "stableRelease", tag: null }),
      miseOutdatedBump: async () => ({
        kind: "outdated",
        rows: [row("uv", "0.11", "0.12", "0.12.4"), row("gcloud", "573", "580", "580.0.0")],
      }),
    };
    const got = await audit(full, buildChecks(probes));
    expect(got.map((v) => v.kind)).toEqual(["info", "ok", "ok", "flag", "flag"]);
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
      miseOutdatedBump: held("outdated"),
    };

    const running = audit(full, buildChecks(probes));
    await Promise.resolve();
    // All four are blocked on the same gate, so none can have finished first.
    expect(started).toEqual(["mise", "npm", "gh", "outdated"]);
    release();
    expect((await running).map((v) => v.kind)).toEqual(["info", "skip", "skip", "skip"]);
  });

  test("skips the probe entirely when the pin is already gone", async () => {
    // drift is unconditional, so only the three conditional probes stay unstubbed.
    const got = await audit(config({}), buildChecks(quietDrift));
    expect(got.map((v) => v.kind)).toEqual(["ok", "ok", "ok", "ok"]);
  });
});
