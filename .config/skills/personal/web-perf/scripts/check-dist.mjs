#!/usr/bin/env node
// TEMPLATE - first-load invariants asserted on the BUILT output (run after the
// build). When the site is fully prerendered, dist/*.html IS what ships - no
// server needed. Copy into a project and adapt the CONFIG block: face names,
// byte ceilings, preload budget, and the asset/header paths are all
// project-specific (the defaults below assume an Astro + Cloudflare Workers
// layout: hashed assets under _astro/, a _headers file, and CSS inlined into
// each page). If your CSS ships as a separate file instead of inlined, read
// that file for the @font-face cross-check rather than the HTML.
//
// Each check guards a silent regression class:
//   - font preload budget: fonts are Highest priority, so extra preloads steal
//     bandwidth from the critical path (budget ~2-3 per page)
//   - crossorigin on font preloads: @font-face fetches are anonymous-CORS; a
//     preload without crossorigin is discarded and the font fetched twice
//   - preload href appears in the CSS byte-for-byte: a hash drift between the
//     ?url import and the @font-face src means double-fetch
//   - metric fallback faces: a generator like fontaine SILENTLY no-ops when it
//     cannot resolve a font path, reintroducing font-swap layout shift
//   - no stylesheet link: an inline-CSS posture keeps first paint off the
//     render-blocking request; a config change would quietly bring it back
//   - immutable cache headers: hashed assets must stay immutable or every
//     repeat view revalidates each asset
//   - font subset size: a ceiling catches a regeneration that dropped the
//     subsetting and reshipped the full face
//   - glyph coverage: rendered copy must stay within the subset's coverage, or a
//     new glyph silently falls back to the metric font
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { isCovered, inFontScope } from "./font-subset.config.mjs";

// ---- CONFIG: adapt every value below to the project -------------------------
const dist = process.argv[2] ?? "dist";
const FONT_PRELOAD_BUDGET = 3; // count of above-the-fold weights you preload
// Metric-matched fallback face names, as they appear in the built @font-face.
const FALLBACK_FACES = [
  "Display fallback",
  "Serif fallback",
  "Sans fallback",
];
// Byte ceilings per subset woff2, keyed by the stable filename stem the content
// hash is inserted into. Set each comfortably above the current subset size and
// below the un-subset face size, so a lost --unicodes reships-full is caught.
const FONT_SIZE_CEILINGS = {
  "display-latin": 31_000,
  "serif-latin": 38_000,
  "sans-latin": 38_000,
};
const HASHED_ASSET_DIR = "_astro"; // dir holding content-hashed assets
const HEADERS_FILE = "_headers"; // platform header-rules file, if any
// -----------------------------------------------------------------------------

const failures = [];
const check = (page, name, ok, detail) => {
  if (!ok) failures.push(`${page}: ${name}${detail ? ` (${detail})` : ""}`);
};

const htmlFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => join(e.parentPath, e.name));

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// Codepoints of the visible body copy: strip <script>/<style> and all tags,
// decode entities (a stray literal glyph survives; an entity would not), and
// return the set of codepoints that actually need a glyph.
const renderedCodepoints = (html) => {
  const body = html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  const text = body
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED_ENTITIES[n] ?? m);
  return new Set([...text].map((ch) => ch.codePointAt(0)));
};

const codepointHex = (cp) =>
  `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

const pages = htmlFiles(dist);
check(dist, "built pages exist", pages.length > 0);

for (const file of pages) {
  const page = relative(dist, file);
  const html = readFileSync(file, "utf8");
  const links = html.match(/<link\b[^>]*>/g) ?? [];

  // NOTE: this matcher assumes double-quoted attributes in a fixed order. If
  // your build emits single quotes, a different order, or unquoted attributes,
  // widen these regexes or parse the DOM instead (see verify.md Tier 0).
  const preloads = links.filter(
    (l) => /rel="preload"/.test(l) && /as="font"/.test(l),
  );
  check(
    page,
    `font preloads within budget of ${FONT_PRELOAD_BUDGET}`,
    preloads.length === FONT_PRELOAD_BUDGET,
    `found ${preloads.length}`,
  );

  for (const l of preloads) {
    const href = l.match(/href="([^"]+)"/)?.[1];
    check(
      page,
      "font preload carries crossorigin",
      /\bcrossorigin\b/.test(l),
      href,
    );
    check(
      page,
      "font preload matches an inline @font-face url()",
      Boolean(href) &&
        (html.includes(`url(${href})`) || html.includes(`url("${href}")`)),
      href,
    );
  }

  check(
    page,
    "no render-blocking stylesheet link",
    !links.some((l) => /rel="stylesheet"/.test(l)),
  );

  for (const face of FALLBACK_FACES) {
    check(page, `metric fallback face present: ${face}`, html.includes(face));
  }
  check(
    page,
    "fallback faces carry size-adjust",
    html.includes("size-adjust:"),
  );

  // Only in-scope (text/punctuation) glyphs must be in the subset; decorative
  // symbols and emoji are left to the system font by design.
  const uncovered = [...renderedCodepoints(html)]
    .filter((cp) => inFontScope(cp) && !isCovered(cp))
    .map(codepointHex);
  check(
    page,
    "rendered copy stays within the font subset coverage",
    uncovered.length === 0,
    uncovered.length
      ? `widen font-subset.config.mjs + regenerate for ${uncovered.join(", ")}`
      : "",
  );
}

// Subset woff2 must stay subset-sized: catch a regeneration that lost the
// subsetting (e.g. dropped --unicodes) and shipped the full face.
const assetDir = join(dist, HASHED_ASSET_DIR);
for (const [stem, ceiling] of Object.entries(FONT_SIZE_CEILINGS)) {
  const file = readdirSync(assetDir).find(
    (n) => n.startsWith(`${stem}.`) && n.endsWith(".woff2"),
  );
  check(HASHED_ASSET_DIR, `subset font present: ${stem}`, Boolean(file));
  if (file) {
    const bytes = statSync(join(assetDir, file)).size;
    check(
      HASHED_ASSET_DIR,
      `subset font under ${ceiling} bytes: ${stem}`,
      bytes <= ceiling,
      `${bytes} bytes - re-run the subset generator`,
    );
  }
}

let headers = "";
try {
  headers = readFileSync(join(dist, HEADERS_FILE), "utf8");
} catch {
  check(HEADERS_FILE, "file copied into dist", false);
}
if (headers) {
  check(
    HEADERS_FILE,
    "hashed assets cached immutably",
    new RegExp(`^/${HASHED_ASSET_DIR}/\\*$`, "m").test(headers) &&
      headers.includes("immutable"),
  );
}

if (failures.length > 0) {
  console.error(`check-dist: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log(
  `check-dist: OK (${pages.length} pages, ${FONT_PRELOAD_BUDGET} font preloads each, styles inline, headers immutable)`,
);
