// The audit itself, as a sandwich per check: read the pin (pure), probe
// upstream (effect, never throws), judge (pure). Every output branch lives in a
// `judge`, which sees only values - that is the seam the zsh version lacked,
// and why these need no probe stubbing to test.
//
// Verdict wording is byte-for-byte the zsh original's; the bats suite is the
// differential oracle, so changing the format is a separate job.
//
// Not audited by a *conditional* check - deliberate pins with no recheck
// condition. DELIBERATE_PINS below is this list made executable, because the
// drift check would otherwise re-flag all four on every `up`:
//   npm:executor = "1"  (mise config.toml) - 2.0.0 is a stray off-`latest`
//     major, so `mise upgrade --bump` would regress; hold on 1.x by design.
//   amp exact pin (mise config.toml) - Amp releases several times a day and is
//     exempt from the age gate; the global exact pin is the control itself.

import type { DriftRow, MiseConfig, PinState, Probe, ToolEntry, Verdict } from "./types.ts";

/** Upstream probes as a port; the adapters live in ../shell/probe.ts. */
export interface Probes {
  /** Newest dotted-numeric version `mise ls-remote <tool>` lists. */
  readonly miseLatest: (tool: string) => Promise<Probe>;
  /** `npm view <pkg> version`. */
  readonly npmLatest: (pkg: string) => Promise<Probe>;
  /** Newest versioned non-prerelease release tag on a GitHub repo. */
  readonly ghStableRelease: (repo: string) => Promise<Probe>;
  /** Every tool's requested range vs newest release (`mise outdated --bump`). */
  readonly miseOutdatedBump: () => Promise<Probe>;
}

export interface Check {
  readonly id: string;
  readonly readPin: (cfg: MiseConfig) => PinState;
  readonly probe: (pin: PinState) => Promise<Probe>;
  /** One verdict per conditional pin; the drift check emits one per tool. */
  readonly judge: (pin: PinState, probe: Probe, cfgPath: string) => Verdict | readonly Verdict[];
}

/** A pin is present only when the entry exists and carries a version. */
const versionPin = (entry: ToolEntry | undefined): PinState =>
  entry?.version ? { kind: "pinned", version: entry.version } : { kind: "gone" };

/** A probe not worth making: the pin is gone, so `judge` ignores the result. */
const notProbed: Probe = { kind: "unavailable", why: "pin gone" };

const latestOf = (probe: Probe): string | null =>
  probe.kind === "latestVersion" ? probe.version : null;

const REMBG_TOOL = "pipx:rembg";
const SRT_PACKAGE = "@anthropic-ai/sandbox-runtime";
const SRT_TOOL = `npm:${SRT_PACKAGE}`;
const COSINE_REPO = "CosineAI/cli";
const COSINE_TOOL = `github:${COSINE_REPO}`;

/**
 * Guard: rembg 2.0.70+ hard-pins numpy>=2.3, which the numba/llvmlite chain
 * can't satisfy. Whether a given release fixed that is not probeable from
 * metadata, so this check restates the guard rather than deciding - and a
 * failed probe degrades to "unknown" rather than SKIP.
 */
const rembg = (probes: Probes): Check => ({
  id: "rembg",
  readPin: (cfg) => versionPin(cfg.tools[REMBG_TOOL]),
  probe: (pin) => (pin.kind === "pinned" ? probes.miseLatest(REMBG_TOOL) : Promise.resolve(notProbed)),
  judge: (pin, probe, cfgPath) => {
    if (pin.kind !== "pinned") {
      return { kind: "ok", detail: `rembg - exact pin gone from ${cfgPath}; drop this check` };
    }
    return {
      kind: "info",
      detail:
        `rembg pinned ${pin.version}, latest ${latestOf(probe) ?? "unknown"} - not mechanically ` +
        `checkable: before bumping, recheck whether the numpy>=2.3 floor still breaks the ` +
        `numba/llvmlite chain`,
    };
  },
});

/**
 * Guard: the sandbox-runtime config schema is pre-1.0 and churns. Revisit the
 * exact pin once 1.0 lands.
 */
const sandboxRuntime = (probes: Probes): Check => ({
  id: "sandbox-runtime",
  readPin: (cfg) => versionPin(cfg.tools[SRT_TOOL]),
  probe: (pin) =>
    pin.kind === "pinned" ? probes.npmLatest(SRT_PACKAGE) : Promise.resolve(notProbed),
  judge: (pin, probe, cfgPath) => {
    if (pin.kind !== "pinned") {
      return { kind: "ok", detail: `sandbox-runtime - exact pin gone from ${cfgPath}; drop this check` };
    }
    const latest = latestOf(probe);
    if (latest === null) {
      return { kind: "skip", detail: `sandbox-runtime ${pin.version} - npm probe failed (offline?)` };
    }
    if (latest.startsWith("0.")) {
      return {
        kind: "ok",
        detail: `sandbox-runtime ${pin.version} - latest ${latest} still pre-1.0; keep the exact pin`,
      };
    }
    return {
      kind: "flag",
      detail: `sandbox-runtime ${pin.version} - ${latest} landed (1.0+); revisit the exact pin (${cfgPath} [tools])`,
    };
  },
});

/**
 * Guard: every versioned CosineAI/cli release is flagged pre-release, so the
 * resolver needs prerelease=true. Drop it once a versioned stable release
 * exists. The rolling `latest`/`nightly` tags are not version releases and are
 * ignored.
 */
const cosineCli = (probes: Probes): Check => ({
  id: "CosineAI/cli",
  readPin: (cfg) => (cfg.tools[COSINE_TOOL]?.prerelease ? { kind: "flagSet" } : { kind: "gone" }),
  probe: (pin) =>
    pin.kind === "flagSet" ? probes.ghStableRelease(COSINE_REPO) : Promise.resolve(notProbed),
  judge: (pin, probe, cfgPath) => {
    if (pin.kind !== "flagSet") {
      return { kind: "ok", detail: `CosineAI/cli - prerelease=true gone from ${cfgPath}; drop this check` };
    }
    if (probe.kind !== "stableRelease") {
      return {
        kind: "skip",
        detail: `CosineAI/cli prerelease=true - gh probe failed (gh auth/offline?)`,
      };
    }
    if (probe.tag !== null) {
      return {
        kind: "flag",
        detail: `CosineAI/cli - stable release ${probe.tag} exists; drop prerelease=true (${cfgPath} [tools])`,
      };
    }
    return {
      kind: "ok",
      detail: `CosineAI/cli - all versioned releases still pre-release; keep prerelease=true`,
    };
  },
});

/**
 * Deliberate pins, excluded from drift so the report stays worth reading. Two
 * are already covered by a conditional check above (which states the condition
 * for lifting them); the other two are documented holds in the file header.
 * A range pin absent from this set and drifting is exactly the bug this check
 * exists to surface - `npm:vercel = "50"` sat 9 majors behind for four months
 * because `up` runs `mise upgrade`, which only ever moves *within* a range.
 */
const DELIBERATE_PINS: ReadonlySet<string> = new Set([
  "npm:executor",
  "npm:@anthropic-ai/sandbox-runtime",
  "pipx:rembg",
  "amp",
]);

/** `usage 3 -> 5` reads as further behind than `uv 0.11 -> 0.12`; say so. */
const majorsBehind = (requested: string, bump: string): string => {
  const lead = (range: string): number | null => {
    const first = range.split(".")[0];
    return first !== undefined && /^[0-9]+$/.test(first) ? Number(first) : null;
  };
  const from = lead(requested);
  const to = lead(bump);
  if (from === null || to === null || to - from < 2) return "";
  return ` (${to - from} majors)`;
};

/**
 * Guard: none - this is the unconditional sweep. Every check above watches one
 * *documented* escape hatch; this one watches the range pins nobody wrote a
 * condition for, which is where drift hides. Report-only, like the rest.
 */
const drift = (probes: Probes): Check => ({
  id: "drift",
  readPin: () => ({ kind: "always" }),
  probe: () => probes.miseOutdatedBump(),
  judge: (_pin, probe, cfgPath) => {
    if (probe.kind !== "outdated") {
      return { kind: "skip", detail: "drift - `mise outdated --bump` failed (offline?)" };
    }
    const drifted = probe.rows.filter(
      (row: DriftRow) => row.bump !== null && !DELIBERATE_PINS.has(row.tool),
    );
    if (drifted.length === 0) {
      return { kind: "ok", detail: "drift - every range pin still covers the newest release" };
    }
    return drifted.map((row) => ({
      kind: "flag" as const,
      detail:
        `${row.tool} pinned ${row.requested}, ${row.latest} available` +
        `${majorsBehind(row.requested, row.bump ?? "")} - \`mise upgrade\` cannot cross this ` +
        `range; bump the pin or run \`mise upgrade --bump ${row.tool}\` (${cfgPath} [tools])`,
    }));
  },
});

/** Declaration order is output order, so the report stays stable. */
export const buildChecks = (probes: Probes): readonly Check[] => [
  rembg(probes),
  sandboxRuntime(probes),
  cosineCli(probes),
  drift(probes),
];

/**
 * Every probe is in flight before the first `await` resolves (each callback
 * runs synchronously up to its own await), so the three independent upstream
 * calls overlap; Promise.all preserves declaration order in the output.
 */
export const audit = async (cfg: MiseConfig, checks: readonly Check[]): Promise<Verdict[]> => {
  const judged = await Promise.all(
    checks.map(async (check) => {
      const pin = check.readPin(cfg);
      return check.judge(pin, await check.probe(pin), cfg.path);
    }),
  );
  // A check yields one verdict, except drift, which yields one per drifted tool.
  return judged.flatMap((verdicts) => (Array.isArray(verdicts) ? [...verdicts] : [verdicts]));
};
