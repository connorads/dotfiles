// Upstream probes. Every call is argv-form Bun.spawn (no shell strings), and
// no probe throws: a missing binary, a non-zero exit or an offline network all
// become an `unavailable` value the pure `judge` degrades to SKIP.
//
// The argv is deliberately identical to the zsh original's, so the bats suite's
// mise/gh/npm stubs keep standing in for real upstreams.

import type { Probes } from "../core/checks.ts";
import type { Probe } from "../core/types.ts";

interface Ran {
  readonly ok: boolean;
  readonly stdout: string;
}

const run = async (argv: readonly string[]): Promise<Ran> => {
  try {
    const proc = Bun.spawn([...argv], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    return { ok: code === 0, stdout };
  } catch {
    return { ok: false, stdout: "" }; // binary absent
  }
};

/** A bare dotted-numeric version; `mise ls-remote` also lists channel tags. */
const VERSION_LINE = /^[0-9]+(\.[0-9]+)+$/;

const miseLatest = async (tool: string): Promise<Probe> => {
  const ran = await run(["mise", "ls-remote", tool]);
  if (!ran.ok) return { kind: "unavailable", why: "mise ls-remote failed" };
  const versions = ran.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => VERSION_LINE.test(line));
  // Last listed, not highest: mise emits ascending order and the original took
  // `tail -1`. Keeping that means no version comparator to disagree about.
  return { kind: "latestVersion", version: versions.at(-1) ?? null };
};

const npmLatest = async (pkg: string): Promise<Probe> => {
  const ran = await run(["npm", "view", pkg, "version"]);
  if (!ran.ok) return { kind: "unavailable", why: "npm view failed" };
  const version = ran.stdout.trim();
  return { kind: "latestVersion", version: version === "" ? null : version };
};

/** Versioned tags only - the rolling `latest`/`nightly` tags are not releases. */
const STABLE_TAG_JQ = '[.[].tagName | select(test("^v?[0-9]"))] | first // empty';

const ghStableRelease = async (repo: string): Promise<Probe> => {
  const ran = await run([
    "gh",
    "release",
    "list",
    "--repo",
    repo,
    "--exclude-pre-releases",
    "--limit",
    "20",
    "--json",
    "tagName",
    "--jq",
    STABLE_TAG_JQ,
  ]);
  if (!ran.ok) return { kind: "unavailable", why: "gh release list failed" };
  const tag = ran.stdout.trim();
  return { kind: "stableRelease", tag: tag === "" ? null : tag };
};

export const probes: Probes = { miseLatest, npmLatest, ghStableRelease };
