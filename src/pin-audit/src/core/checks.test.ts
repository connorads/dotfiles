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
  hkVersions: () => Promise.reject(new Error("hkVersions not stubbed")),
  handoffVersions: () => Promise.reject(new Error("handoffVersions not stubbed")),
};

/** The always-probing checks, answered so cases that don't exercise them stay quiet. */
const quietDrift: Probes = {
  ...noProbes,
  miseOutdatedBump: async () => noDrift,
  hkVersions: async () => hkMatch,
  handoffVersions: async () => handoffMatch,
};

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

const hk = (pinned: string | null, installed: string | null): Probe => ({
  kind: "hkVersions",
  pinned,
  installed,
});

const hkMatch = hk("2.0.1", "2.0.1");

const CLAUDE_PY = "/home/u/src/handoff/src/handoff/formats/claude.py";
const CODEX_PY = "/home/u/src/handoff/src/handoff/formats/codex.py";

const handoff = (
  claude: [string | null, string | null],
  codex: [string | null, string | null],
): Probe => ({
  kind: "handoffVersions",
  agents: [
    { cli: "claude", pinned: claude[0], pinFile: CLAUDE_PY, installed: claude[1] },
    { cli: "codex", pinned: codex[0], pinFile: CODEX_PY, installed: codex[1] },
  ],
});

const handoffMatch = handoff(["2.1.283", "2.1.283"], ["0.156.0", "0.156.0"]);

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

describe("hk-pin", () => {
  const anyCfg = config({});

  test("OK while hk.pkl and the hk binary name the same version", () => {
    expect(render(verdict("hk-pin", anyCfg, hkMatch))).toBe(
      "pin-audit: OK   hk-pin - hk.pkl and hk binary both 2.0.1",
    );
  });

  test("flags an hk.pkl pin that differs from the binary", () => {
    expect(render(verdict("hk-pin", anyCfg, hk("2.0.0", "2.0.1")))).toBe(
      "pin-audit: FLAG hk-pin - hk.pkl pins 2.0.0, hk binary is 2.0.1; bump amends/import in ~/hk.pkl",
    );
  });

  test("a version it could not read degrades to SKIP", () => {
    expect(verdict("hk-pin", anyCfg, hk(null, "2.0.1")).kind).toBe("skip");
    expect(verdict("hk-pin", anyCfg, hk("2.0.1", null)).kind).toBe("skip");
    expect(verdict("hk-pin", anyCfg, unavailable).kind).toBe("skip");
  });
});

describe("handoff-drift", () => {
  const anyCfg = config({});

  test("OK per agent while handoff's version matches the installed CLI", () => {
    expect(verdicts("handoff-drift", anyCfg, handoffMatch).map(render)).toEqual([
      "pin-audit: OK   handoff-drift - claude 2.1.283 matches handoff",
      "pin-audit: OK   handoff-drift - codex 0.156.0 matches handoff",
    ]);
  });

  test("flags each agent whose installed CLI moved past handoff", () => {
    const probe = handoff(["2.1.215", "2.1.283"], ["0.144.6", "0.156.0"]);
    expect(verdicts("handoff-drift", anyCfg, probe).map(render)).toEqual([
      `pin-audit: FLAG handoff-drift - handoff targets claude 2.1.215, installed is 2.1.283; ` +
        `re-test handoff against it and bump the version in ${CLAUDE_PY}`,
      `pin-audit: FLAG handoff-drift - handoff targets codex 0.144.6, installed is 0.156.0; ` +
        `re-test handoff against it and bump the version in ${CODEX_PY}`,
    ]);
  });

  test("a version it could not read degrades that agent to SKIP", () => {
    const got = verdicts("handoff-drift", anyCfg, handoff([null, "2.1.283"], ["0.156.0", null]));
    expect(got.map((v) => v.kind)).toEqual(["skip", "skip"]);
    expect(verdict("handoff-drift", anyCfg, unavailable).kind).toBe("skip");
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
      hkVersions: async () => hkMatch,
      handoffVersions: async () => handoffMatch,
    };
    const got = await audit(full, buildChecks(probes));
    expect(got.map((v) => v.kind)).toEqual(["info", "ok", "ok", "ok", "ok", "ok", "ok"]);
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
      hkVersions: async () => hkMatch,
      handoffVersions: async () => handoffMatch,
    };
    const got = await audit(full, buildChecks(probes));
    expect(got.map((v) => v.kind)).toEqual(["info", "ok", "ok", "ok", "ok", "ok", "flag", "flag"]);
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
      hkVersions: held("hk"),
      handoffVersions: held("handoff"),
      miseOutdatedBump: held("outdated"),
    };

    const running = audit(full, buildChecks(probes));
    await Promise.resolve();
    // All six are blocked on the same gate, so none can have finished first.
    expect(started).toEqual(["mise", "npm", "gh", "hk", "handoff", "outdated"]);
    release();
    expect((await running).map((v) => v.kind)).toEqual([
      "info",
      "skip",
      "skip",
      "skip",
      "skip",
      "skip",
    ]);
  });

  test("skips the probe entirely when the pin is already gone", async () => {
    // drift, hk-pin and handoff-drift are unconditional, so only the three conditional probes stay unstubbed.
    const got = await audit(config({}), buildChecks(quietDrift));
    expect(got.map((v) => v.kind)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok", "ok"]);
  });
});
