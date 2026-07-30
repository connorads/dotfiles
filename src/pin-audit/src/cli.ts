#!/usr/bin/env bun
// SHELL: read config → core audit (probes concurrent) → render → always exit 0.
//
// `up` calls pin-audit unconditionally and this is report-only, so nothing here
// may fail the caller: exceptions are caught only at this boundary and become a
// SKIP line. Every other failure mode is already a value by the time it arrives.

import { homedir } from "node:os";
import { audit, buildChecks } from "./core/checks.ts";
import { render } from "./core/render.ts";
import { readMiseConfig } from "./shell/config.ts";
import { probes } from "./shell/probe.ts";

const miseConfigPath = `${homedir()}/.config/mise/config.toml`;

const main = async (): Promise<void> => {
  const read = await readMiseConfig(miseConfigPath);
  if (read.kind === "unparseable") {
    // Never silently read a broken config as "no pins" - that is the false OK
    // this port exists to remove.
    console.log(render({ kind: "skip", detail: `${read.path} - TOML parse failed (${read.why})` }));
    return;
  }
  for (const verdict of await audit(read.config, buildChecks(probes))) {
    console.log(render(verdict));
  }
};

try {
  await main();
} catch (error) {
  const why = error instanceof Error ? error.message : String(error);
  console.log(render({ kind: "skip", detail: `pin audit aborted - ${why}` }));
}
process.exit(0);
