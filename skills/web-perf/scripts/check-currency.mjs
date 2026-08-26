#!/usr/bin/env node
// EXECUTE (skill maintenance, not a project template) - re-check the skill's
// version-dated claims against live sources. Reads currency-claims.json (same
// dir), which the freshness sweep maintains: one entry per dated claim, with a
// machine check where one exists and the single best re-read URL otherwise.
//
//   node check-currency.mjs           # check webstatus-mapped claims, list the rest
//   node check-currency.mjs --all     # also print every manual entry's URL
//
// Needs the network; informational only, never a gate - it always exits 0.
// A webstatus feature that gained a browser (or lost Baseline) since an
// entry's `verified` date means: re-read the claim in its file and re-run the
// sweep on that cluster. Manual entries can only be re-read by hand.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { claims } = JSON.parse(
  readFileSync(join(here, "currency-claims.json"), "utf8"),
);
const all = process.argv.includes("--all");

const get = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

let checked = 0;
for (const c of claims.filter((c) => c.check === "webstatus")) {
  checked++;
  try {
    const f = await get(
      `https://api.webstatus.dev/v1/features/${c.handle}`,
    );
    const impls = Object.entries(f.browser_implementations ?? {})
      .map(([b, i]) => `${b}:${i.date ?? i.status ?? "?"}`)
      .join(" ");
    console.log(
      `webstatus ${c.handle}: baseline=${f.baseline?.status ?? "?"} ${impls}`,
    );
    console.log(`  -> ${c.id} (${c.file}, verified ${c.verified})`);
  } catch (e) {
    console.log(`webstatus ${c.handle}: FETCH FAILED (${e.message}) - re-read ${c.url}`);
  }
}
for (const c of claims.filter((c) => c.check === "webkit-bug")) {
  checked++;
  try {
    const b = (await get(`https://bugs.webkit.org/rest/bug/${c.handle}`))
      .bugs?.[0];
    console.log(
      `webkit-bug ${c.handle}: ${b?.status ?? "?"} ${b?.resolution ?? ""}`.trim(),
    );
    console.log(`  -> ${c.id} (${c.file}, verified ${c.verified})`);
  } catch (e) {
    console.log(`webkit-bug ${c.handle}: FETCH FAILED (${e.message}) - re-read ${c.url}`);
  }
}

const manual = claims.filter(
  (c) => c.check === "manual" || c.check === "chrome-changelog",
);
console.log(
  `\n${checked} machine-checked; ${manual.length} manual entries` +
    (all ? ":" : " (--all to list each URL)."),
);
if (all)
  for (const c of manual)
    console.log(`  ${c.file} :: ${c.id}\n    ${c.url}`);
