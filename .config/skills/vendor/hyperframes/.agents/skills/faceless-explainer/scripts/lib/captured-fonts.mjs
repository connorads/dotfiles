import { copyFileSync, existsSync, mkdirSync, readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";

// Capture preserves subset and variable-axis descriptors in extracted/page.html.
// Filenames alone cannot identify a face's character coverage.
export function stageCapturedFonts(projectDir, families) {
  const page = join(projectDir, "capture/extracted/page.html");
  const result = { faces: [], families: new Set(), files: new Set() };
  if (!safePath(projectDir, "capture/extracted/page.html", false)) return result;
  const wanted = new Set(families.map((family) => family.toLowerCase()));
  const html = readFileSync(page, "utf8");
  const copied = new Set();
  for (const style of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    const css = style[1].replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of css.matchAll(/@font-face\s*\{([^}]+)\}/gi)) {
      const body = match[1];
      const familyValue = /(?:^|;)\s*font-family\s*:\s*([^;]+)/i.exec(body)?.[1]?.trim();
      if (!familyValue) continue;
      const family = familyValue.replace(/^(['"])(.*)\1$/, "$2");
      if (!wanted.has(family.toLowerCase())) continue;
      const source = /(?:^|;)\s*src\s*:\s*([^;]+)/i.exec(body);
      if (!source) continue;
      const sources = localFontSources(source[1], projectDir);
      if (!sources.length) {
        console.warn("Captured font has no downloaded source: " + family);
        continue;
      }
      for (const file of sources) {
        if (copied.has(file.name)) continue;
        if (!safePath(projectDir, file.target, true)) continue;
        if (!copied.size) mkdirSync(join(projectDir, "assets/fonts"), { recursive: true });
        copyFileSync(file.source, join(projectDir, file.target));
        copied.add(file.name);
        result.files.add(file.target);
      }
      const staged = sources.filter((file) => copied.has(file.name));
      if (!staged.length) continue;
      result.families.add(family.toLowerCase());
      const src = staged.map((file) => file.css).join(", ");
      const rule = "@font-face{" + body.replace(source[1], src) + "}";
      if (!result.faces.includes(rule)) result.faces.push(rule);
    }
  }
  return result;
}

function localFontSources(source, projectDir) {
  const files = [];
  for (const match of source.matchAll(
    /url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)(\s*format\([^)]*\))?/gi,
  )) {
    const url = match[1] ?? match[2] ?? match[3];
    const name = /^assets\/fonts\/([a-z0-9_.-]+\.(?:woff2?|ttf|otf))$/i.exec(url)?.[1];
    if (!name) continue;
    const path = join(projectDir, "capture/assets/fonts", name);
    if (!safePath(projectDir, "capture/assets/fonts/" + name, false)) continue;
    const target = "assets/fonts/captured-" + name;
    files.push({ name, source: path, target, css: 'url("' + target + '")' + (match[4] ?? "") });
  }
  return files;
}

// Project root is the caller's boundary; reject symlinks below that boundary.
function safePath(projectDir, relative, allowMissing) {
  let current = projectDir;
  const parts = relative.split("/");
  try {
    for (let i = 0; i < parts.length; i++) {
      current = join(current, parts[i]);
      let stat;
      try { stat = lstatSync(current); }
      catch (error) { if (allowMissing && error.code === "ENOENT") return true; throw error; }
      if (stat.isSymbolicLink()) return false;
      if (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()) return false;
    }
    return true;
  } catch { return false; }
}
