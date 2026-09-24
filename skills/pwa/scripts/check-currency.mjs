#!/usr/bin/env node
// EXECUTE (skill maintenance, not a project template) - re-check the skill's
// version-dated claims against live sources. Reads currency-claims.json (same
// dir): one entry per dated claim, with a machine check where one exists and
// the single best re-read URL otherwise.
//
//   node check-currency.mjs           # run machine checks, count the rest
//   node check-currency.mjs --all     # also print every manual entry's URL
//
// Needs the network; informational only, never a gate - it always exits 0.
// A package whose latest version or publish date moved since an entry's
// `verified` date, or a webstatus feature that gained a browser, means: re-read
// the claim in its file and re-verify it.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { claims } = JSON.parse(readFileSync(join(here, "currency-claims.json"), "utf8"));
const all = process.argv.includes("--all");

const get = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

let checked = 0;
for (const c of claims.filter((c) => c.check === "npm")) {
  checked++;
  try {
    const p = await get(`https://registry.npmjs.org/${c.handle.replace("/", "%2F")}`);
    const latest = p["dist-tags"]?.latest ?? "?";
    const published = (p.time?.[latest] ?? "?").slice(0, 10);
    const moved = c.expect && latest !== c.expect ? `  MOVED from ${c.expect}` : "";
    console.log(`npm ${c.handle}: latest=${latest} published=${published}${moved}`);
    if (moved) console.log(`  -> re-read ${c.id} (${c.file}, verified ${c.verified})`);
  } catch (e) {
    console.log(`npm ${c.handle}: FETCH FAILED (${e.message}) - re-read ${c.url}`);
  }
}
for (const c of claims.filter((c) => c.check === "webstatus")) {
  checked++;
  try {
    const f = await get(`https://api.webstatus.dev/v1/features/${c.handle}`);
    const impls = Object.entries(f.browser_implementations ?? {})
      .map(([b, i]) => `${b}:${i.date ?? i.status ?? "?"}`)
      .join(" ");
    console.log(`webstatus ${c.handle}: baseline=${f.baseline?.status ?? "?"} ${impls}`);
    console.log(`  -> ${c.id} (${c.file}, verified ${c.verified})`);
  } catch (e) {
    console.log(`webstatus ${c.handle}: FETCH FAILED (${e.message}) - re-read ${c.url}`);
  }
}
for (const c of claims.filter((c) => c.check === "github-issue")) {
  checked++;
  try {
    const i = await get(`https://api.github.com/repos/${c.handle}`);
    const changed = c.expect && i.state !== c.expect ? `  CHANGED from ${c.expect}` : "";
    console.log(`issue ${c.handle}: ${i.state} updated=${(i.updated_at ?? "?").slice(0, 10)}${changed}`);
    if (changed) console.log(`  -> re-read ${c.id} (${c.file}, verified ${c.verified})`);
  } catch (e) {
    console.log(`issue ${c.handle}: FETCH FAILED (${e.message}) - re-read ${c.url}`);
  }
}

const manual = claims.filter((c) => c.check === "manual");
console.log(`\n${checked} machine-checked; ${manual.length} manual entries` + (all ? ":" : " (--all to list each URL)."));
if (all) for (const c of manual) console.log(`  ${c.file} :: ${c.id}\n    ${c.url}`);
