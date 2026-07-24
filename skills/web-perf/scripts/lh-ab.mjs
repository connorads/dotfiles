#!/usr/bin/env node
// EXECUTE (adapt via env). Local Lighthouse A/B for a first-paint fix: measure
// the metric delta between two git refs WITHOUT deploying. Builds each ref,
// serves the static output over loopback, runs Lighthouse median-of-N against
// each, and prints the deltas.
//
// WHY THIS EXISTS (verify.md 5a): a first-paint fix can make the *mechanism*
// fire - e.g. LCP goes from "never fired" to firing - while the *vital* stays
// flat, because the real bottleneck is elsewhere (a render-blocking stylesheet,
// not the reveal you un-gated). Proving the mechanism is not proving the win.
// A/B the built output before shipping a fix that carries a cost: a fidelity
// deviation, added bytes, or complexity.
//
// SCOPE: static / prerender only (verify.md Tier 0) - it serves a built output
// directory. For SSR routes there is no static dir to serve; boot the server per
// ref yourself and point Lighthouse at it (Tier 1). Ref-switching a live SSR
// server is out of scope here.
//
// LAB CAVEAT: localhost has ~zero latency, so Lighthouse throttling is
// *simulated*. Absolute numbers do NOT match production; the apples-to-apples
// *delta* between the two refs is the signal. This is a decision aid before
// implementing, NOT a CI gate - the gate stays the deterministic Tier 0/1
// structural checks (check-dist.mjs / check-head.mjs). Lighthouse flakes, which
// is why this takes the median of N runs (verify.md 5).
//
// USAGE:
//   node lh-ab.mjs <refA> <refB> [urlPath]
//   node lh-ab.mjs main HEAD /
//
// CONFIG (env, with defaults):
//   LH_BUILD    build command (shell)                (default: "npm run build")
//   LH_DIST     built output dir to serve            (default: "dist")
//   LH_RUNS     Lighthouse runs per ref, median-of   (default: 3)
//   LH_PORT     loopback port for the static server  (default: 4388)
//   LH_FORM     "mobile" | "desktop"                 (default: "mobile")
//   LH_RUNNER   how to fetch+run Lighthouse   (default: auto "pnpm dlx"/"npx -y")
//   CHROME_PATH explicit Chrome binary (else Lighthouse auto-detects)
//
// DEPS: git, Node, a package runner (pnpm or npx) to fetch Lighthouse, and a
// Chrome/Chromium binary for Lighthouse to drive.
//
// DIRTY-TREE / CONCURRENCY: this checks out refs in the working tree, so it
// refuses to run with *tracked* modifications and restores your branch in a
// finally block. Untracked files (this script, build output) are left alone. It
// WILL collide with a second agent editing tracked files on the same branch - in
// that case run it from a fresh `git worktree` (one-time dependency install there
// for node_modules), so the A/B never mutates the shared checkout.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { join, extname, resolve } from "node:path";

const [refA, refB, urlPath = "/"] = process.argv.slice(2);
if (!refA || !refB) {
  console.error("usage: node lh-ab.mjs <refA> <refB> [urlPath]");
  process.exit(2);
}

const BUILD = process.env.LH_BUILD ?? "npm run build";
const DIST = resolve(process.cwd(), process.env.LH_DIST ?? "dist");
const RUNS = Math.max(1, Number(process.env.LH_RUNS ?? 3));
const PORT = Number(process.env.LH_PORT ?? 4388);
const FORM = (process.env.LH_FORM ?? "mobile").toLowerCase();
const URL = `http://127.0.0.1:${PORT}${urlPath}`;

const sh = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: "utf8", ...opts });
const has = (bin) => {
  const r = spawnSync(bin, ["--version"], { stdio: "ignore" });
  return !r.error && r.status === 0;
};

// --- preconditions ---------------------------------------------------------
if (sh("git", ["rev-parse", "--is-inside-work-tree"]).status !== 0) {
  console.error("not a git work tree");
  process.exit(2);
}
for (const ref of [refA, refB]) {
  if (sh("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).status !== 0) {
    console.error(`unknown ref: ${ref}`);
    process.exit(2);
  }
}
// Only *tracked* changes block us; checkout would clobber them. Untracked files
// carry across checkouts untouched.
if (sh("git", ["status", "--porcelain", "--untracked-files=no"]).stdout.trim()) {
  console.error("tracked changes present - commit/stash first, or run from a git worktree");
  process.exit(2);
}
const runner = process.env.LH_RUNNER
  ? process.env.LH_RUNNER.split(" ")
  : has("pnpm")
    ? ["pnpm", "dlx"]
    : has("npx")
      ? ["npx", "-y"]
      : null;
if (!runner) {
  console.error("no pnpm/npx found to run lighthouse; set LH_RUNNER");
  process.exit(2);
}
const original =
  sh("git", ["symbolic-ref", "--quiet", "--short", "HEAD"]).stdout.trim() ||
  sh("git", ["rev-parse", "HEAD"]).stdout.trim();

// --- metrics ---------------------------------------------------------------
const METRICS = [
  ["first-contentful-paint", "FCP", "ms"],
  ["largest-contentful-paint", "LCP", "ms"],
  ["total-blocking-time", "TBT", "ms"],
  ["cumulative-layout-shift", "CLS", ""],
  ["speed-index", "SI", "ms"],
];
const median = (xs) => {
  const a = xs.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const fmt = (unit, v) =>
  v == null ? "n/a" : unit === "ms" ? Math.round(v) + "ms" : v.toFixed(3);

// Async spawn (not spawnSync): Lighthouse drives Chrome, which fetches from the
// in-process static server below. spawnSync would block THIS event loop for the
// whole run, so the server could never answer Chrome - a deadlock. spawn keeps
// the loop live while we await the child.
function lighthouseOnce() {
  const args = [
    ...runner.slice(1),
    "lighthouse",
    URL,
    "--quiet",
    "--only-categories=performance",
    "--output=json",
    "--output-path=stdout",
    "--chrome-flags=--headless=new --no-sandbox",
  ];
  if (FORM === "desktop") args.push("--preset=desktop");
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(runner[0], args);
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code !== 0) {
        console.error(err.slice(-1500));
        return rejectPromise(new Error("lighthouse run failed"));
      }
      try {
        const lhr = JSON.parse(out.slice(out.indexOf("{"))); // strip runner banner
        const o = { score: Math.round((lhr.categories.performance.score ?? 0) * 100) };
        for (const [id] of METRICS) o[id] = lhr.audits[id]?.numericValue ?? null;
        resolvePromise(o);
      } catch (e) {
        rejectPromise(e);
      }
    });
  });
}

async function measure(ref) {
  console.error(`\n=== ${ref}: checkout -> build -> lighthouse x${RUNS} ===`);
  if (sh("git", ["checkout", "--quiet", ref]).status !== 0)
    throw new Error(`checkout ${ref} failed`);
  await rm(DIST, { recursive: true, force: true });
  if (spawnSync(BUILD, { shell: true, stdio: "ignore" }).status !== 0)
    throw new Error(`build failed (LH_BUILD="${BUILD}")`);
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await lighthouseOnce());
  const agg = { score: median(runs.map((r) => r.score)) };
  for (const [id] of METRICS) agg[id] = median(runs.map((r) => r[id]));
  return agg;
}

// --- minimal static server (SSG file-routing), so no external dep ----------
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".otf": "font/otf",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};
const server = createServer(async (req, res) => {
  // Outer guard: a request handler that throws uncaught crashes the process and
  // skips the finally that restores HEAD. Nothing here may escape.
  try {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/") p = "/index.html";
    else if (!extname(p)) p = p.replace(/\/$/, "") + ".html";
    const file = join(DIST, p);
    if (!file.startsWith(DIST)) return void res.writeHead(403).end("forbidden");
    // Read BEFORE writing headers: a missing file (Chrome auto-requests
    // /favicon.ico) must fall through to 404, not crash mid-response with
    // headers already sent.
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      const body = await readFile(join(DIST, "404.html")).catch(() => "not found");
      res.writeHead(404, { "content-type": TYPES[".html"] }).end(body);
    }
  } catch {
    try { res.writeHead(500).end("server error"); } catch { /* headers already sent */ }
  }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

// --- run + report ----------------------------------------------------------
try {
  const a = await measure(refA);
  const b = await measure(refB);
  const pad = (s) => String(s).padEnd(12);
  console.log(`\nurl: ${URL}   form: ${FORM}   median of ${RUNS}   (lab, simulated throttling)\n`);
  console.log(`metric   ${pad(refA)} ${pad(refB)} delta`);
  console.log(`score    ${pad(a.score)} ${pad(b.score)} ${b.score - a.score >= 0 ? "+" : ""}${b.score - a.score}`);
  for (const [id, label, unit] of METRICS) {
    const d = a[id] == null || b[id] == null ? "n/a" : fmt(unit, b[id] - a[id]);
    console.log(`${label.padEnd(8)} ${pad(fmt(unit, a[id]))} ${pad(fmt(unit, b[id]))} ${d}`);
  }
  console.log(`\nDelta is the signal; absolute numbers are simulated (not prod). A flat`);
  console.log(`delta on the vital you targeted means the lever is wrong - the`);
  console.log(`bottleneck is elsewhere.`);
} finally {
  server.close();
  sh("git", ["checkout", "--quiet", original]);
  console.error(`\nrestored HEAD -> ${original}`);
}
