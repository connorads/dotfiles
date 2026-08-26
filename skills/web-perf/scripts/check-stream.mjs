#!/usr/bin/env node
// TEMPLATE - flush-timeline probe for a STREAMED HTML response (Tier 1: SSR /
// per-request heads - TanStack Start, Next App Router, Worker SSR, any stack
// that streams a shell then flushes Suspense content). Copy into a project and
// adapt the CONFIG block. Usage:
//   node check-stream.mjs http://localhost:3000/
//   node check-stream.mjs http://localhost:3000/ --strict --max-lines 30
//
// It answers three questions one fetch at a time:
//   1. WHEN does the first flush land, and is the head whole inside it?
//      A head split across flushes delays preload discovery by a network RTT -
//      the browser cannot start the font/CSS fetch it has not parsed yet.
//   2. Do the head invariants still hold ON THE SHELL? Checking the whole
//      document would pass a route that ships its preloads in a late flush,
//      which is the regression that matters. The matchers are duplicated from
//      check-head.mjs on purpose: templates are copied per-project and must
//      stay self-contained, so there is no shared module - keep local edits in
//      sync yourself.
//   3. WHERE do the skeleton-to-content swaps happen? React marks each one
//      with a comment boundary plus an inline swap script; mapping those onto
//      the flush timeline shows which flush actually replaces a skeleton.
//
// CAVEAT, stated up front because it bounds every number below: a fetch reader
// yields whatever the transport hands the runtime, NOT server flush boundaries.
// HTTP/1.1 chunk framing is invisible to fetch, chunks coalesce across TCP
// segments, and any proxy, CDN, gzip window or HTTP/2 layer between you and the
// server can re-cut them. Read the timeline as "the client could not have acted
// on this content earlier than T", never as "the server flushed here". Byte
// counts are post-decompression. Compare relative shapes across runs and
// commits, not absolute timings; for true server-side flush points instrument
// the server.
import { argv, exit } from "node:process";

// ---- CONFIG: adapt every value below to the project -------------------------
// Range for font preloads IN THE SHELL: routes preload different weights, so a
// range, not an exact count.
const FONT_PRELOAD_BUDGET = { min: 1, max: 3 };
// Time to first flush, ms. The shell should leave the server before any data
// fetch resolves; a budget here catches a route that lost its streaming shell
// and reverted to blocking render. null skips the check.
const TIME_TO_FIRST_FLUSH_BUDGET_MS = null; // e.g. 500
// Metric-matched fallback face names IF your fallback @font-face rules are
// inlined into the shell; null skips (the usual external-CSS case).
const FALLBACK_FACES = null; // e.g. ["Display fallback", "Sans fallback"]
// Timeline lines printed before elision. Interesting flushes (first, last,
// shell end, any carrying a React marker) are kept first.
const MAX_TIMELINE_LINES = 20;
// Whole-response timeout, ms - a stalled stream must not hang CI.
const TIMEOUT_MS = 30_000;
// -----------------------------------------------------------------------------

// ---- argv -------------------------------------------------------------------
const flags = new Map();
const positional = [];
for (let i = 2; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const eq = a.indexOf("=");
    if (eq !== -1) flags.set(a.slice(2, eq), a.slice(eq + 1));
    else if (argv[i + 1] && !argv[i + 1].startsWith("--"))
      flags.set(a.slice(2), argv[++i]);
    else flags.set(a.slice(2), "true");
  } else positional.push(a);
}
const url = positional[0];
if (!url || flags.has("help")) {
  console.error(
    "usage: check-stream.mjs <url> [--strict] [--max-lines N] [--timeout MS] [--header 'K: V']",
  );
  exit(url ? 0 : 2);
}
const strict = flags.get("strict") === "true";
const maxLines = Number(flags.get("max-lines") ?? MAX_TIMELINE_LINES);
const timeoutMs = Number(flags.get("timeout") ?? TIMEOUT_MS);
if (!Number.isFinite(maxLines) || maxLines < 1) {
  console.error("check-stream: --max-lines must be a positive integer");
  exit(2);
}
const headers = { accept: "text/html" };
for (const h of [flags.get("header")].flat().filter(Boolean)) {
  const idx = String(h).indexOf(":");
  if (idx === -1) {
    console.error(`check-stream: --header needs 'Name: value', got '${h}'`);
    exit(2);
  }
  headers[String(h).slice(0, idx).trim()] = String(h)
    .slice(idx + 1)
    .trim();
}

// ---- read the body chunk by chunk -------------------------------------------
const t0 = performance.now();
const since = () => Math.round((performance.now() - t0) * 10) / 10;

let res;
try {
  res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
} catch (err) {
  const why = err?.name === "TimeoutError" ? `no response in ${timeoutMs}ms` : (err?.cause?.message ?? err?.message ?? String(err));
  console.error(`check-stream: cannot fetch ${url} (${why})`);
  console.error("  is the server running, and is the URL reachable from here?");
  exit(2);
}
const tHeaders = since();
if (!res.ok) {
  console.error(`check-stream: ${url} responded ${res.status} ${res.statusText}`);
  exit(2);
}
if (!res.body) {
  console.error(`check-stream: ${url} returned no body stream (HEAD response?)`);
  exit(2);
}
const ctype = res.headers.get("content-type") ?? "";
if (!/text\/html/i.test(ctype)) {
  console.error(`check-stream: ${url} is not HTML (content-type: ${ctype || "none"})`);
  exit(2);
}

// Decode incrementally but keep the running text, so a marker or a `</head>`
// straddling two chunks is still found - it is attributed to the flush in which
// it COMPLETES, which is the flush a browser could first act on.
const charset = ctype.match(/charset\s*=\s*"?([\w-]+)/i)?.[1] ?? "utf-8";
let decoder;
try {
  decoder = new TextDecoder(charset);
} catch {
  console.error(`check-stream: unsupported charset '${charset}' in content-type; reading as utf-8`);
  decoder = new TextDecoder();
}
const flushes = []; // { i, at, bytes, from, to }  (from/to = decoded char offsets)
let text = "";
try {
  for await (const chunk of res.body) {
    const at = since();
    const from = text.length;
    text += decoder.decode(chunk, { stream: true });
    flushes.push({ i: flushes.length, at, bytes: chunk.byteLength, from, to: text.length });
  }
  text += decoder.decode();
} catch (err) {
  const why = err?.name === "TimeoutError" ? `stream stalled, aborted at ${timeoutMs}ms` : (err?.cause?.message ?? err?.message ?? String(err));
  console.error(`check-stream: stream failed after ${flushes.length} chunk(s) (${why})`);
  exit(2);
}
const tEnd = since();
if (flushes.length === 0) {
  console.error(`check-stream: ${url} sent an empty body`);
  exit(2);
}
const totalBytes = flushes.reduce((n, f) => n + f.bytes, 0);
// Map a character offset in the joined text back to the flush it arrived in.
const chunkOf = (charIndex) =>
  flushes.find((f) => charIndex < f.to) ?? flushes[flushes.length - 1];

// ---- shell = through </head> + the first flush carrying body bytes ----------
const headClose = text.search(/<\/head\s*>/i);
const headEnd =
  headClose === -1 ? -1 : headClose + text.slice(headClose).match(/<\/head\s*>/i)[0].length;
if (headEnd === -1) {
  console.error(`check-stream: no </head> in ${totalBytes} bytes from ${url}`);
  console.error("  the route may have errored, redirected to a non-HTML body, or be a fragment");
  exit(2);
}
const headFlush = chunkOf(headEnd - 1);
// The first body flush is the first flush that ends AFTER </head>: same flush
// when it carries trailing body bytes, the next one when it stopped on the tag.
const shellFlush = flushes.find((f) => f.to > headEnd) ?? headFlush;
const shell = text.slice(0, shellFlush.to);
const headSplit = headFlush.i > 0;

// ---- head invariants, asserted ON THE SHELL ONLY ----------------------------
const failures = [];
const warnings = [];
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

const links = shell.match(/<link\b[^>]*>/gi) ?? [];
const preloads = links.filter(
  (l) =>
    getAttr(l, "rel")?.toLowerCase() === "preload" &&
    getAttr(l, "as")?.toLowerCase() === "font",
);

check(
  `font preloads in shell within budget ${FONT_PRELOAD_BUDGET.min}-${FONT_PRELOAD_BUDGET.max}`,
  preloads.length >= FONT_PRELOAD_BUDGET.min &&
    preloads.length <= FONT_PRELOAD_BUDGET.max,
  `found ${preloads.length}`,
);

const hrefs = [];
for (const l of preloads) {
  const href = getAttr(l, "href");
  hrefs.push(href);
  // Only bare crossorigin / crossorigin="" / crossorigin="anonymous" match the
  // anonymous-CORS mode of the @font-face fetch.
  const co = getAttr(l, "crossorigin");
  check(
    "font preload carries anonymous crossorigin",
    hasAttr(l, "crossorigin") && co?.toLowerCase() !== "use-credentials",
    href ?? l,
  );
}
const dupes = hrefs.filter((h, i) => h && hrefs.indexOf(h) !== i);
check("no duplicate font preload hrefs", dupes.length === 0, [...new Set(dupes)].join(", "));

if (FALLBACK_FACES) {
  for (const face of FALLBACK_FACES)
    check(`metric fallback face present in shell: ${face}`, shell.includes(face));
  check("fallback faces carry size-adjust", shell.includes("size-adjust:"));
}

// ---- streaming invariants ---------------------------------------------------
const flag = (msg) => (strict ? failures : warnings).push(msg);
if (headSplit)
  flag(
    `head split across flushes (</head> completes in flush ${headFlush.i} at ${headFlush.at}ms, not flush 0) - preloads in the tail are discovered a round trip late`,
  );
if (TIME_TO_FIRST_FLUSH_BUDGET_MS !== null)
  check(
    `time to first flush within ${TIME_TO_FIRST_FLUSH_BUDGET_MS}ms`,
    flushes[0].at <= TIME_TO_FIRST_FLUSH_BUDGET_MS,
    `${flushes[0].at}ms`,
  );

// ---- React fallback-completion markers --------------------------------------
// React streams a Suspense boundary as: an OPEN comment placeholder wrapping
// the fallback, then later a hidden content block, then an inline script that
// swaps the content in and closes the boundary. Each marker is attributed to
// the flush in which its LAST byte arrives.
const MARKERS = [
  // fallback shown, content still pending
  { key: "pending", label: "fallback pending <!--$?-->", re: /<!--\$\?-->/g },
  // boundary already resolved when the server wrote it
  { key: "resolved", label: "resolved inline <!--$-->", re: /<!--\$-->/g },
  { key: "error", label: "boundary errored <!--$!-->", re: /<!--\$!-->/g },
  // the <template id="B:n"> React leaves where the content will be spliced
  {
    key: "placeholder",
    label: "fallback placeholder",
    re: /<template\b[^>]*\bid=["']?B:[^"'\s>]*/gi,
  },
  // the out-of-order <div hidden id="S:n"> carrying the real content
  {
    key: "content",
    label: "content block",
    re: /<div\b[^>]*\bhidden\b[^>]*\bid=["']?[SP]:[^"'\s>]*|<div\b[^>]*\bid=["']?[SP]:[^"'\s>]*[^>]*\bhidden/gi,
  },
  // the inline script CALL that performs the skeleton -> content swap. Calls
  // only ($RC / $RR with stylesheet deps / $RS) - the one-time $RC=function
  // definitions never match, and $RX is the client-render error handoff, not
  // a swap.
  {
    key: "swap",
    label: "SWAP script $RC/$RR/$RS",
    re: /\$R[CRS]\s*\(/g,
  },
  { key: "clientRender", label: "client-render handoff $RX", re: /\$RX\s*\(/g },
];
const markerTotals = new Map(MARKERS.map((m) => [m.key, 0]));
for (const f of flushes) f.markers = new Map();
for (const m of MARKERS) {
  m.re.lastIndex = 0;
  let hit;
  while ((hit = m.re.exec(text)) !== null) {
    const f = chunkOf(hit.index + hit[0].length - 1);
    f.markers.set(m.key, (f.markers.get(m.key) ?? 0) + 1);
    markerTotals.set(m.key, markerTotals.get(m.key) + 1);
    if (hit[0].length === 0) m.re.lastIndex++; // guard against a zero-width match
  }
}
// A swap is where a skeleton is replaced: the flush carrying the swap script.
const swapFlushes = flushes.filter((f) => (f.markers.get("swap") ?? 0) > 0);

// ---- report -----------------------------------------------------------------
const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
const contentLength = res.headers.get("content-length");
const mode =
  flushes.length > 1
    ? `STREAMED (${flushes.length} flushes over ${tEnd}ms)`
    : contentLength
      ? "BUFFERED (one flush with Content-Length - the length was known before the first byte; strong evidence of a non-streamed path, though a known-length body can still be written incrementally)"
      : "SINGLE FLUSH (whole body in one read - buffered, or small enough to coalesce into one)";

console.log(`check-stream: ${url}`);
console.log(
  `  transport   ${res.status} ${ctype.split(";")[0]}` +
    `${res.headers.get("transfer-encoding") ? ` transfer-encoding=${res.headers.get("transfer-encoding")}` : ""}` +
    `${res.headers.get("content-length") ? ` content-length=${res.headers.get("content-length")}` : ""}` +
    `${res.headers.get("content-encoding") ? ` content-encoding=${res.headers.get("content-encoding")}` : ""}`,
);
console.log(`  mode        ${mode}`);
console.log(`  headers at  ${tHeaders}ms`);
console.log(
  `  1st flush   ${flushes[0].at}ms, ${kb(flushes[0].bytes)}` +
    (headSplit ? "  <-- does NOT contain a complete </head>" : "  (contains complete </head>)"),
);
console.log(
  `  shell ends  flush ${shellFlush.i} at ${shellFlush.at}ms, ${kb(Buffer.byteLength(shell))} of ${kb(totalBytes)} total`,
);
console.log(`  last byte   ${tEnd}ms, ${kb(totalBytes)} in ${flushes.length} flush(es)`);
console.log(
  `  shell head  ${preloads.length} font preload(s)` +
    (swapFlushes.length
      ? `; skeleton swaps in flush(es) ${swapFlushes.map((f) => f.i).join(", ")}`
      : "; no React swap markers seen"),
);

// Keep the flushes a reader needs: first, last, shell end, and every flush
// carrying a marker. Fill any remaining budget in arrival order, then elide
// runs of the rest so the output stays bounded on a 500-flush page.
const keep = new Set([0, flushes.length - 1, headFlush.i, shellFlush.i]);
for (const f of flushes) if (f.markers.size > 0) keep.add(f.i);
// Swap flushes are the point of the report; they win the budget over the rest.
const ranked = [
  ...swapFlushes.map((f) => f.i),
  ...[...keep].sort((a, b) => a - b),
];
const shown = new Set();
for (const i of ranked) {
  if (shown.size >= maxLines) break;
  shown.add(i);
}
for (const f of flushes) {
  if (shown.size >= maxLines) break;
  shown.add(f.i);
}
console.log(`\n  flush timeline (${flushes.length} flush(es), showing ${shown.size}):`);
let elided = { n: 0, bytes: 0, markers: 0 };
const drainElision = () => {
  if (elided.n > 0)
    console.log(
      `    ... ${elided.n} flush(es) elided, ${kb(elided.bytes)}` +
        (elided.markers > 0
          ? `, ${elided.markers} marker(s) NOT shown - raise --max-lines`
          : ", no markers"),
    );
  elided = { n: 0, bytes: 0, markers: 0 };
};
for (const f of flushes) {
  if (!shown.has(f.i)) {
    elided.n++;
    elided.bytes += f.bytes;
    for (const n of f.markers.values()) elided.markers += n;
    continue;
  }
  drainElision();
  const notes = [];
  if (f.i === headFlush.i) notes.push("</head>");
  if (f.i === shellFlush.i) notes.push("shell end");
  for (const m of MARKERS)
    if (f.markers.get(m.key)) notes.push(`${m.label} x${f.markers.get(m.key)}`);
  console.log(
    `    [${String(f.i).padStart(3)}] ${String(f.at).padStart(8)}ms  ${kb(f.bytes).padStart(8)}` +
      (notes.length ? `  ${notes.join(" | ")}` : ""),
  );
}
drainElision();

if ([...markerTotals.values()].some((n) => n > 0)) {
  console.log(
    `\n  React boundaries: ${markerTotals.get("pending")} streamed as fallback, ` +
      `${markerTotals.get("resolved")} already resolved inline, ${markerTotals.get("error")} errored; ` +
      `${markerTotals.get("content")} content block(s) paired with ${markerTotals.get("swap")} swap call(s)` +
      (markerTotals.get("clientRender") ? `, ${markerTotals.get("clientRender")} client-render handoff(s)` : ""),
  );
}
console.log(
  "\n  caveat: reader chunks approximate server flushes - HTTP/1.1 chunk framing is\n" +
    "  invisible to fetch and proxies/TCP/gzip re-cut boundaries. Timings bound when a\n" +
    "  client could first act, not when the server wrote. Bytes are post-decompression.",
);

for (const w of warnings) console.error(`  WARN ${w}`);
if (failures.length > 0) {
  console.error(`\ncheck-stream: ${failures.length} failure(s) [${url}]`);
  for (const f of failures) console.error(`  FAIL ${f}`);
  exit(1);
}
console.log(
  `\ncheck-stream: OK [${url}] (${preloads.length} font preloads in shell, all anonymous-CORS, no duplicates)` +
    (warnings.length ? ` - ${warnings.length} warning(s); --strict makes them fail` : ""),
);
