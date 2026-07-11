#!/usr/bin/env node
// TEMPLATE - first-load invariants asserted on a BOOTED route's rendered HTML
// (Tier 1: SSR / per-request heads - TanStack Start, Worker SSR, any stack
// with no static dist/*.html to grep). Copy into a project and adapt the
// CONFIG block. Usage:
//   node check-head.mjs http://localhost:3000/          # fetch the booted route
//   curl -fsS http://localhost:3000/ | node check-head.mjs   # or pipe HTML in
//
// The structural matchers are rendering-mode agnostic and deliberately
// duplicated from check-dist.mjs: templates are copied per-project and must
// stay self-contained, so there is no shared module - keep local edits in
// sync yourself.
//
// Each check guards a silent regression class:
//   - font preload budget: min catches a route that DROPPED its preloads (the
//     regression this gate exists for), max catches over-preloading - fonts
//     are Highest priority and steal bandwidth from critical CSS / the LCP
//   - crossorigin on font preloads: @font-face fetches are anonymous-CORS; a
//     missing attribute AND crossorigin="use-credentials" both mismatch the
//     credentials mode and double-fetch the font
//   - duplicate preload hrefs: a head rendered twice (layout + route, or a
//     framework dedupe miss) ships the same preload twice
//   - metric fallback faces (OFF by default): only assertable here when the
//     fallback @font-face CSS is inlined into the head; SSR stacks usually
//     ship CSS as external files - leave null and assert on the built CSS
//     file instead
import { readFileSync } from "node:fs";

// ---- CONFIG: adapt every value below to the project -------------------------
// Range for font preloads on the fetched route: routes can preload different
// weights, so a range, not an exact count.
const FONT_PRELOAD_BUDGET = { min: 1, max: 3 };
// Metric-matched fallback face names IF your fallback @font-face rules are
// inlined into the head; null skips the check (the usual external-CSS case).
const FALLBACK_FACES = null; // e.g. ["Display fallback", "Sans fallback"]
// -----------------------------------------------------------------------------

const arg = process.argv[2];
let html;
if (arg) {
  const res = await fetch(arg);
  if (!res.ok) {
    console.error(`check-head: ${arg} responded ${res.status}`);
    process.exit(1);
  }
  html = await res.text();
} else {
  html = readFileSync(0, "utf8");
}
const source = arg ?? "stdin";

const failures = [];
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}${detail ? ` (${detail})` : ""}`);
};

// Tolerant of quote style and attribute order (SSR heads vary more than a
// single static build does).
const getAttr = (tag, name) => {
  const m = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"),
  );
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : null;
};
const hasAttr = (tag, name) =>
  new RegExp(`\\b${name}(?=[\\s=>]|/>)`, "i").test(tag);

const links = html.match(/<link\b[^>]*>/gi) ?? [];
const preloads = links.filter(
  (l) =>
    getAttr(l, "rel")?.toLowerCase() === "preload" &&
    getAttr(l, "as")?.toLowerCase() === "font",
);

check(
  `font preloads within budget ${FONT_PRELOAD_BUDGET.min}-${FONT_PRELOAD_BUDGET.max}`,
  preloads.length >= FONT_PRELOAD_BUDGET.min &&
    preloads.length <= FONT_PRELOAD_BUDGET.max,
  `found ${preloads.length}`,
);

const hrefs = [];
for (const l of preloads) {
  const href = getAttr(l, "href");
  hrefs.push(href);
  // Only bare crossorigin / crossorigin="" / crossorigin="anonymous" match
  // the anonymous-CORS mode of the @font-face fetch.
  const co = getAttr(l, "crossorigin");
  check(
    "font preload carries anonymous crossorigin",
    hasAttr(l, "crossorigin") && co?.toLowerCase() !== "use-credentials",
    href ?? l,
  );
}
const dupes = hrefs.filter((h, i) => h && hrefs.indexOf(h) !== i);
check(
  "no duplicate font preload hrefs",
  dupes.length === 0,
  [...new Set(dupes)].join(", "),
);

if (FALLBACK_FACES) {
  for (const face of FALLBACK_FACES) {
    check(`metric fallback face present: ${face}`, html.includes(face));
  }
  check("fallback faces carry size-adjust", html.includes("size-adjust:"));
}

if (failures.length > 0) {
  console.error(`check-head: ${failures.length} failure(s) [${source}]`);
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log(
  `check-head: OK [${source}] (${preloads.length} font preloads, all anonymous-CORS, no duplicates)`,
);
