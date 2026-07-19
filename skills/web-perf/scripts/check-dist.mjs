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
//   - font preload budget: font preloads are high-priority and dispatched
//     immediately, so extra ones steal bandwidth from the critical path
//     (max ~2-3 per page); the min catches a
//     build that silently DROPS its font preloads - the regression this gate
//     exists for
//   - crossorigin on font preloads: @font-face fetches are anonymous-CORS; a
//     preload without crossorigin - or with crossorigin="use-credentials" -
//     mismatches the credentials mode and the font is fetched twice
//   - preload href appears in the CSS byte-for-byte: a hash drift between the
//     ?url import and the @font-face src means double-fetch
//   - metric fallback faces: a generator like fontaine SILENTLY no-ops when it
//     cannot resolve a font path, reintroducing font-swap layout shift
//   - no stylesheet link: an inline-CSS posture keeps first paint off the
//     render-blocking request; a config change would quietly bring it back
//   - font-display: every FETCHED @font-face (url() src) must carry a
//     non-blocking font-display (swap/optional/fallback) - the descriptor the
//     flash fixes hang on; local()-only metric fallbacks are skipped
//   - immutable cache headers: hashed assets must stay immutable WITH a long
//     max-age, asserted inside the rule's own block (a stray "immutable"
//     elsewhere in the file must not pass), or every repeat view revalidates
//   - font subset size: a ceiling catches a regeneration that dropped the
//     subsetting and reshipped the full face
//   - glyph coverage: rendered copy must stay within the subset's coverage, or a
//     new glyph silently falls back to the metric font
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { isCovered, inFontScope } from "./font-subset.config.mjs";

// ---- CONFIG: adapt every value below to the project -------------------------
const dist = process.argv[2] ?? "dist";
// Range for font preloads per page: min catches a build that dropped its
// preloads entirely; max catches over-preloading. Routes can preload different
// weights, so this is a range, not an exact count.
const FONT_PRELOAD_BUDGET = { min: 1, max: 3 };
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
// Long-TTL threshold for cache-header rules (headers file): adapt per project.
const LONG_TTL_SECONDS = 30 * 86_400;
// Families exempt from the non-blocking font-display check (e.g. an icon font
// deliberately using `block` per fonts.md B4).
const FONT_DISPLAY_EXEMPT = [];
// Fonts served from stable public/ paths carry no content hash, so they can
// never be immutable-by-hash - they need their own explicit long-TTL rule in
// the headers file (version the PATH when the file changes). Set to that
// rule's path pattern (e.g. "/fonts/*"); null when all fonts ship hashed.
const PUBLIC_FONT_PATH = null;
// -----------------------------------------------------------------------------

const failures = [];
const check = (page, name, ok, detail) => {
  if (!ok) failures.push(`${page}: ${name}${detail ? ` (${detail})` : ""}`);
};

const htmlFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => join(e.parentPath ?? e.path, e.name));

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
    `font preloads within budget ${FONT_PRELOAD_BUDGET.min}-${FONT_PRELOAD_BUDGET.max}`,
    preloads.length >= FONT_PRELOAD_BUDGET.min &&
      preloads.length <= FONT_PRELOAD_BUDGET.max,
    `found ${preloads.length}`,
  );

  for (const l of preloads) {
    const href = l.match(/href="([^"]+)"/)?.[1];
    // Only bare crossorigin / crossorigin="" / crossorigin="anonymous" match
    // the anonymous-CORS mode of the @font-face fetch; a missing attribute AND
    // crossorigin="use-credentials" both mismatch and double-fetch.
    check(
      page,
      "font preload carries anonymous crossorigin",
      /\bcrossorigin\b/.test(l) &&
        !/crossorigin="use-credentials"/.test(l),
      href,
    );
    check(
      page,
      "font preload matches an inline @font-face url()",
      Boolean(href) &&
        (html.includes(`url(${href})`) ||
          html.includes(`url("${href}")`) ||
          html.includes(`url('${href}')`)),
      href,
    );
  }

  // Every fetched face must carry a non-blocking font-display; local()-only
  // faces (metric fallbacks) fetch nothing and legitimately omit it.
  for (const face of html.match(/@font-face\s*{[^}]*}/g) ?? []) {
    if (!/url\(/.test(face)) continue;
    const family =
      face.match(/font-family:\s*["']?([^;"'}]+)["']?/)?.[1]?.trim() ??
      "unnamed";
    if (FONT_DISPLAY_EXEMPT.includes(family)) continue;
    check(
      page,
      `@font-face carries non-blocking font-display: ${family}`,
      /font-display:\s*(swap|optional|fallback)\b/.test(face),
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
// Skipped entirely when no ceilings are configured (a build with inlined CSS
// and public/ fonts may legitimately emit no hashed-asset dir at all).
const assetDir = join(dist, HASHED_ASSET_DIR);
let assetFiles = null;
if (Object.keys(FONT_SIZE_CEILINGS).length > 0) {
  try {
    assetFiles = readdirSync(assetDir);
  } catch {
    check(HASHED_ASSET_DIR, "hashed asset dir exists in dist", false);
  }
}
if (assetFiles) {
  for (const [stem, ceiling] of Object.entries(FONT_SIZE_CEILINGS)) {
    const file = assetFiles.find(
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
}

let headers = "";
try {
  headers = readFileSync(join(dist, HEADERS_FILE), "utf8");
} catch {
  check(HEADERS_FILE, "file copied into dist", false);
}
if (headers) {
  // A rule's block = the indented lines under the exact matching path line.
  // Scoping both checks to the block stops a stray "immutable"/max-age
  // anywhere else in the file from passing them.
  const headerBlock = (pathPattern) => {
    const lines = headers.split("\n");
    const start = lines.findIndex((l) => l.trim() === pathPattern);
    if (start === -1) return null;
    const block = [];
    for (let i = start + 1; i < lines.length && /^\s/.test(lines[i]); i++)
      block.push(lines[i]);
    return block.join("\n");
  };
  const blockHasLongTtl = (block) => {
    const age = block?.match(/max-age=(\d+)/);
    return Boolean(age) && Number(age[1]) >= LONG_TTL_SECONDS;
  };

  const hashedRule = headerBlock(`/${HASHED_ASSET_DIR}/*`);
  check(
    HEADERS_FILE,
    `hashed assets cached immutably with long max-age: /${HASHED_ASSET_DIR}/*`,
    Boolean(hashedRule) &&
      hashedRule.includes("immutable") &&
      blockHasLongTtl(hashedRule),
  );
  if (PUBLIC_FONT_PATH) {
    check(
      HEADERS_FILE,
      `public font path has a long-TTL rule: ${PUBLIC_FONT_PATH}`,
      blockHasLongTtl(headerBlock(PUBLIC_FONT_PATH)),
    );
  }
}

if (failures.length > 0) {
  console.error(`check-dist: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log(
  `check-dist: OK (${pages.length} pages, font preloads within ${FONT_PRELOAD_BUDGET.min}-${FONT_PRELOAD_BUDGET.max}, styles inline, headers immutable)`,
);
