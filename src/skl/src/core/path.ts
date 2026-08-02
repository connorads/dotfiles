// Pure POSIX-style path helpers. Skills use "/" separators; we never touch the
// filesystem here. Hand-rolled by deliberate choice, not oversight: keeping the
// core self-contained means it imports nothing outside core/ (enforced by
// boundary.test.ts), and node:path/posix's `.`/`..` normalisation is something
// these helpers specifically do NOT want — refs are simple relative segments.

/** Expand a leading `~` or `$HOME` to the given home dir. Boundary-only. */
export const expandTilde = (p: string, home: string): string => {
  if (p === "~") return home;
  if (p.startsWith("~/")) return `${home}/${p.slice(2)}`;
  if (p === "$HOME") return home;
  if (p.startsWith("$HOME/")) return `${home}/${p.slice("$HOME/".length)}`;
  return p;
};

/** Drop trailing slashes (but keep a lone "/"). */
const stripTrailing = (p: string): string =>
  p.length > 1 ? p.replace(/\/+$/, "") : p;

/** POSIX dirname: directory portion of a path, "." when there is none. */
export const posixDirname = (p: string): string => {
  const s = stripTrailing(p);
  const idx = s.lastIndexOf("/");
  if (idx === -1) return ".";
  if (idx === 0) return "/";
  return s.slice(0, idx);
};

/** POSIX basename: final path segment. */
export const posixBasename = (p: string): string => {
  const s = stripTrailing(p);
  const idx = s.lastIndexOf("/");
  return idx === -1 ? s : s.slice(idx + 1);
};

/** Join path segments with single slashes, ignoring empty segments. */
export const posixJoin = (...parts: readonly string[]): string => {
  const joined = parts
    .filter((part) => part.length > 0)
    .join("/")
    .replace(/\/+/g, "/");
  return joined.length > 1 ? joined.replace(/\/+$/, "") : joined;
};
