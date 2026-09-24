#!/usr/bin/env node
// EXECUTE - mechanical PWA checks on a build output dir, and optionally on the
// deployed origin. Replaces nothing a human must still do on a device; it only
// asserts what a build can prove.
//
//   node pwa-check.mjs --dir <deployed-output-dir> [--url <origin>] [--json]
//
// --dir is the directory the host actually serves (dist/, .output/public/,
// out/), not the source tree. Exit 0 = no FAIL (warnings allowed), 1 = at least
// one FAIL, 2 = usage error. Thresholds are Chrome's (verified 2026-09-24 on
// Chrome 154 stable); see references/installability.md.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const MIN_ICON_PX = 144;
const PURPOSES = new Set(["any", "maskable", "monochrome"]);
const SCREENSHOT_MIN = 320;
const SCREENSHOT_MAX = 3840;
const SCREENSHOT_RATIO = 2.3;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = flag("--dir");
const url = flag("--url");
const asJson = args.includes("--json");
if (!dir) {
  console.error("usage: pwa-check.mjs --dir <deployed-output-dir> [--url <origin>] [--json]");
  process.exit(2);
}
if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error(`usage: --dir ${dir} is not a directory`);
  process.exit(2);
}

/** @type {{level: "FAIL"|"WARN"|"OK"|"INFO", check: string, message: string}[]} */
const results = [];
const add = (level, check, message) => results.push({ level, check, message });

const walk = (root) => {
  /** @type {string[]} */
  const out = [];
  const stack = [root];
  while (stack.length) {
    const d = /** @type {string} */ (stack.pop());
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else out.push(p);
    }
  }
  return out;
};
const files = walk(dir);
const inDir = (href) => join(dir, href.replace(/^\.?\//, "").split(/[?#]/)[0]);

// Pixel size from the file header: PNG IHDR, or the first JPEG SOF marker.
const imageSize = (path) => {
  const b = readFileSync(path);
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return undefined;
};
const parseSizes = (s) =>
  String(s ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (t === "any" ? "any" : t.split("x").map(Number)));

// --- manifest discovery: <link rel=manifest> in built HTML, else a manifest file.
const htmlFiles = files.filter((f) => f.endsWith(".html"));
let manifestPath;
for (const h of htmlFiles) {
  const m = readFileSync(h, "utf8").match(/<link[^>]*rel=["']?manifest["']?[^>]*>/i);
  const href = m?.[0].match(/href=["']?([^"'\s>]+)/i)?.[1];
  if (href && !/^https?:/.test(href)) {
    manifestPath = inDir(href);
    add("OK", "manifest-link", `${relative(dir, h)} links ${href}`);
    break;
  }
}
if (!manifestPath) {
  manifestPath = files.find((f) => /(\.webmanifest|manifest\.json)$/.test(f));
  if (manifestPath)
    add("INFO", "manifest-link", `no <link rel=manifest> in built HTML; using ${relative(dir, manifestPath)} (fine if the head is rendered at runtime - confirm the link in the served page)`);
}

/** @type {Record<string, any> | undefined} */
let manifest;
if (!manifestPath || !existsSync(manifestPath)) {
  add("FAIL", "manifest", `no manifest found in ${dir}`);
} else {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    add("OK", "manifest", `${relative(dir, manifestPath)} parses`);
  } catch (e) {
    add("FAIL", "manifest", `${relative(dir, manifestPath)} is not valid JSON: ${/** @type {Error} */ (e).message}`);
  }
}

if (manifest) {
  if (!manifest.id)
    add("WARN", "id", "no `id`: identity falls back to start_url, so changing start_url later forks installed users into a second app");

  const override = manifest.display_override;
  if (Array.isArray(override) && override[0] === "browser")
    add("FAIL", "display", 'display_override[0] is "browser", which Chrome treats as not installable');

  // Icons: Chrome needs one purpose-any icon >= 144px (or sizes "any").
  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  let best = 0;
  let anyVector = false;
  for (const icon of icons) {
    const purposes = String(icon.purpose ?? "any").split(/\s+/).filter(Boolean);
    const unknown = purposes.filter((p) => !PURPOSES.has(p));
    if (unknown.length && unknown.length === purposes.length)
      add("WARN", "icons", `${icon.src}: purpose "${unknown.join(" ")}" is not recognised, so the icon is ignored`);
    const sizes = parseSizes(icon.sizes);
    const file = icon.src ? inDir(new URL(icon.src, "https://x/").pathname) : undefined;
    const real = file && existsSync(file) ? imageSize(file) : undefined;
    for (const s of sizes) {
      if (s === "any" || !real) continue;
      if (real[0] !== s[0] || real[1] !== s[1])
        add("WARN", "icons", `${icon.src}: declared ${s.join("x")} but the file is ${real.join("x")}`);
    }
    if (!purposes.includes("any")) continue;
    for (const s of sizes) {
      if (s === "any") anyVector = true;
      else best = Math.max(best, Math.min(s[0], s[1]));
    }
  }
  if (anyVector || best >= MIN_ICON_PX)
    add("OK", "icons", `purpose-any icon ${anyVector ? 'sizes "any"' : `${best}px`} meets the ${MIN_ICON_PX}px install gate`);
  else
    add("FAIL", "icons", `no purpose-any icon >= ${MIN_ICON_PX}px (largest: ${best || "none"}); maskable-only sets are not installable in Chrome`);

  // Screenshots gate the richer install dialog, not installability.
  const shots = Array.isArray(manifest.screenshots) ? manifest.screenshots : [];
  if (!shots.length) {
    add("WARN", "screenshots", "no screenshots: Chrome shows the plain install prompt, not the richer install dialog");
  } else {
    /** @type {Record<string, Set<string>>} */
    const ratios = {};
    for (const shot of shots) {
      const file = shot.src ? inDir(new URL(shot.src, "https://x/").pathname) : undefined;
      const real = file && existsSync(file) ? imageSize(file) : undefined;
      const declared = parseSizes(shot.sizes).find((s) => s !== "any");
      const [w, h] = /** @type {number[]} */ (real ?? declared ?? [0, 0]);
      if (!["image/png", "image/jpeg"].includes(shot.type ?? "") && !/\.(png|jpe?g)$/i.test(shot.src ?? ""))
        add("WARN", "screenshots", `${shot.src}: only PNG and JPEG are shown`);
      if (!w || !h) continue;
      if (Math.min(w, h) < SCREENSHOT_MIN || Math.max(w, h) > SCREENSHOT_MAX)
        add("WARN", "screenshots", `${shot.src}: ${w}x${h} is outside ${SCREENSHOT_MIN}-${SCREENSHOT_MAX}px per side`);
      if (Math.max(w, h) / Math.min(w, h) > SCREENSHOT_RATIO)
        add("WARN", "screenshots", `${shot.src}: ${w}x${h} exceeds the ${SCREENSHOT_RATIO} longest/shortest ratio`);
      const ff = shot.form_factor ?? "(none)";
      (ratios[ff] ??= new Set()).add((w / h).toFixed(3));
    }
    for (const [ff, set] of Object.entries(ratios))
      if (set.size > 1) add("WARN", "screenshots", `form_factor ${ff}: aspect ratios differ (${[...set].join(", ")}); Chrome needs one per form factor`);
    if (!ratios.wide) add("WARN", "screenshots", 'no form_factor "wide" screenshot: desktop Chrome shows only "wide"');
    if (!ratios.narrow) add("INFO", "screenshots", 'no form_factor "narrow" screenshot for mobile');
  }
}

// --- service worker: every registered script must exist in the served dir.
const scriptish = files.filter((f) => [".js", ".mjs", ".html"].includes(extname(f)));
/** @type {Set<string>} */
const registered = new Set();
for (const f of scriptish) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/serviceWorker\.register\(\s*["'`]([^"'`]+)["'`]/g)) registered.add(m[1]);
  // workbox-window (virtual:pwa-register): new Workbox("/sw.js", { scope }) under any minified name.
  for (const m of src.matchAll(/new [\w$]+\(\s*["'`]([^"'`]+\.m?js)["'`]\s*,\s*\{\s*scope:/g)) registered.add(m[1]);
}
if (!registered.size) {
  add("INFO", "service-worker", "no serviceWorker.register('<literal>') in the output; if registration is built at runtime, check the SW URL with --url");
}
for (const href of registered) {
  if (/^https?:/.test(href)) continue;
  if (existsSync(inDir(href))) add("OK", "service-worker", `${href} is registered and present in ${dir}`);
  else add("FAIL", "service-worker", `${href} is registered but missing from ${dir}: the build wrote it somewhere the host does not serve`);
}

// --- navigateFallback: a denylist naming only /api still hands the app shell to
// every other server-owned navigation (OAuth callbacks, SSR pages).
for (const f of files.filter((p) => /(^|\/)(sw|service-worker)[^/]*\.js$/.test(p))) {
  const src = readFileSync(f, "utf8");
  if (!/NavigationRoute\(/.test(src)) continue;
  const deny = src.match(/denylist:\s*(\[[^\]]*\])/)?.[1] ?? "[]";
  const names = deny.replace(/\\\//g, "/");
  if (!/auth|callback|oauth|login/i.test(names))
    add("WARN", "navigate-fallback", `${relative(dir, f)}: denylist ${names} - every other navigation the server owns (OAuth/OIDC callbacks, server-rendered routes) gets the cached shell`);
  else add("OK", "navigate-fallback", `${relative(dir, f)}: denylist ${names}`);
}

// --- deployed origin: the headers that matter are on the URLs actually served.
if (url) {
  const base = new URL(url);
  const get = (u) => fetch(u, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  try {
    const page = await get(base);
    const html = await page.text();
    const href = html.match(/<link[^>]*rel=["']?manifest["']?[^>]*href=["']?([^"'\s>]+)/i)?.[1];
    if (!href) add("WARN", "manifest-link", `${base.href} serves no <link rel=manifest> in its HTML`);
    else {
      const res = await get(new URL(href, base));
      const type = res.headers.get("content-type") ?? "";
      if (res.status !== 200) add("FAIL", "manifest-headers", `${href}: HTTP ${res.status}`);
      else if (!/json/.test(type)) add("FAIL", "manifest-headers", `${href}: Content-Type "${type}" is not a JSON type, so browsers discard the manifest`);
      else add("OK", "manifest-headers", `${href}: ${type}`);
    }
    for (const sw of registered.size ? registered : new Set(["/sw.js"])) {
      const res = await get(new URL(sw, base));
      const type = res.headers.get("content-type") ?? "";
      const cc = res.headers.get("cache-control") ?? "(none)";
      if (res.status !== 200) {
        add("FAIL", "sw-headers", `${sw}: HTTP ${res.status} on the deployed origin`);
        continue;
      }
      if (!/javascript/.test(type)) add("FAIL", "sw-headers", `${sw}: Content-Type "${type}" - registration rejects non-JavaScript`);
      const maxAge = Number(cc.match(/s-maxage=(\d+)/)?.[1] ?? cc.match(/max-age=(\d+)/)?.[1] ?? 0);
      if (maxAge > 0)
        add("WARN", "sw-headers", `${sw}: Cache-Control "${cc}" - browsers ignore it by default, but a CDN edge honours it and serves the old worker`);
      else add("OK", "sw-headers", `${sw}: ${type}; Cache-Control "${cc}"`);
    }
  } catch (e) {
    add("FAIL", "url", `${base.href}: ${/** @type {Error} */ (e).message}`);
  }
}

const failed = results.some((r) => r.level === "FAIL");
if (asJson) console.log(JSON.stringify({ dir, url: url ?? null, failed, results }, null, 2));
else {
  for (const r of results) console.log(`${r.level} ${r.check}: ${r.message}`);
  const n = (l) => results.filter((r) => r.level === l).length;
  console.log(`\n${n("FAIL")} fail, ${n("WARN")} warn. Installability itself is proven in the browser: DevTools > Application > Manifest.`);
}
process.exit(failed ? 1 : 0);
