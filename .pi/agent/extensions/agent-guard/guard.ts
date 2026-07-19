// Pure policy core for the pi agent guard: decides whether a tool call must
// be blocked. TypeScript twin of ~/.claude/hooks/_secretpaths.py (secret
// paths) plus ports of the dotfiles' other Bash guards pi otherwise lacks:
// rm -rf (Claude static deny / Codex safety.rules), git add sweeps, and the
// supply-chain bypass flags from guard-protection-bypass.py.
//
// SECRET_PATHS mirrors srt denyRead (~/.config/srt/base.json); the
// secret-path-parity hk step keeps every copy in lock-step. Matching is
// textual - obfuscated access evades it; srt is the OS-level backstop
// (two-layer model, see ~/.config/srt/AGENTS.md).
//
// Escape hatch for secret paths: a SECRETS_OK=1 env prefix on the segment
// (same contract as the Claude/Codex hooks).

// Mirror of srt denyRead - home-relative secret paths.
export const SECRET_PATHS = [
  ".ssh",
  ".config/gh-gate",
  ".config/gh",
  ".aws",
  ".config/gcloud",
  ".netrc",
  ".config/fnox",
  ".fnox",
  "Library/Keychains",
  ".zshrc.local",
  ".docker/config.json",
  ".gnupg",
  ".cloudflared",
  ".gemini",
  ".config/op",
  ".kube",
  ".password-store",
] as const;

const SECRET_COMPONENTS = SECRET_PATHS.map((p) => p.split("/"));

const BYPASS_VAR = "SECRETS_OK";
const BYPASS_FALSEY = new Set(["", "0", "false", "False", "no"]);

// File tools whose `path` input is checked against the secret list. An
// absent path means the tool defaults to cwd, which is never a secret.
const PATH_TOOLS = new Set(["read", "grep", "find", "ls", "edit", "write"]);

// Package managers whose flags the supply-chain check reasons about
// (port of guard-protection-bypass.py TOOLS).
const PKG_TOOLS = new Set([
  "npm", "pnpm", "bun", "bunx", "yarn", "npx", "deno", "mise", "uv", "pip", "pip3", "corepack",
]);
const AGE_FLAGS = new Set([
  "--min-release-age",
  "--minimum-release-age",
  "--minimumreleaseage",
  "--minimum-dependency-age",
  "--before",
]);
const ZERO_RE = /^0[a-z]*$/i;
const ENV_IGNORE_SCRIPTS_RE = /^[A-Za-z0-9_]*ignore_scripts=false$/i;
const ENV_AGE_RE = /^[A-Za-z0-9_]*(?:min_release_age|minimum_release_age|minimum_dependency_age)=0[a-z]*$/i;

const ENV_ASSIGNMENT_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
const SEPARATOR_RE = /^[;&|]+$/;

// Commit commands may mention flags/paths in quoted args - the textual
// checks skip them (twin of _shellparse.NOT_COMMIT_RE). Structural checks
// (rm -rf, git add sweeps) still apply: they gate on the segment's command.
const NOT_COMMIT_RE = /\b(?:git|dotfiles)\b.*\bcommit\b/;

const SECRET_FALLBACK_RE = new RegExp(
  "(?:~|\\$HOME|\\$\\{HOME\\})/("
    + SECRET_PATHS.map((p) => p.replace(/[.\\+*?[^\]$(){}=!<>|:-]/g, "\\$&")).join("|")
    + ")(?:/|$|[\\s'\";|&)])",
);
const FALLBACK_BYPASS_RE = new RegExp(`\\b${BYPASS_VAR}=(\\S*)`);

/**
 * Minimal POSIX-ish shell lexer: whitespace splitting, single/double quotes,
 * backslash escapes, and runs of ;|& emitted as their own tokens (the
 * TypeScript analogue of _shellparse.tokenise). Returns undefined when the
 * command cannot be lexed (unbalanced quote) - callers fall back to a
 * conservative regex.
 */
export function tokenise(command: string): string[] | undefined {
  const tokens: string[] = [];
  let current = "";
  let hasCurrent = false;
  const push = () => {
    if (hasCurrent) {
      tokens.push(current);
      current = "";
      hasCurrent = false;
    }
  };
  let i = 0;
  while (i < command.length) {
    const ch = command[i];
    if (ch === "'") {
      const end = command.indexOf("'", i + 1);
      if (end === -1) return undefined;
      current += command.slice(i + 1, end);
      hasCurrent = true;
      i = end + 1;
    } else if (ch === '"') {
      let j = i + 1;
      let buf = "";
      while (j < command.length && command[j] !== '"') {
        if (command[j] === "\\" && j + 1 < command.length && '"\\$`'.includes(command[j + 1]!)) {
          buf += command[j + 1];
          j += 2;
        } else {
          buf += command[j];
          j += 1;
        }
      }
      if (j >= command.length) return undefined;
      current += buf;
      hasCurrent = true;
      i = j + 1;
    } else if (ch === "\\") {
      if (i + 1 < command.length) {
        current += command[i + 1];
        hasCurrent = true;
      }
      i += 2;
    } else if (/\s/.test(ch!)) {
      push();
      i += 1;
    } else if (ch === ";" || ch === "&" || ch === "|") {
      push();
      let j = i;
      while (j < command.length && ";&|".includes(command[j]!)) j += 1;
      tokens.push(command.slice(i, j));
      i = j;
    } else {
      current += ch;
      hasCurrent = true;
      i += 1;
    }
  }
  push();
  return tokens;
}

/** Split tokens into command segments at ;|& separator tokens. */
export function commandSegments(tokens: string[]): string[][] {
  const segments: string[][] = [];
  let current: string[] = [];
  for (const tok of tokens) {
    if (SEPARATOR_RE.test(tok)) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      continue;
    }
    current.push(tok);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

function envAssignments(segment: string[]): Map<string, string> {
  const envs = new Map<string, string>();
  for (const tok of segment) {
    const m = ENV_ASSIGNMENT_RE.exec(tok);
    if (!m) break;
    envs.set(m[1]!, m[2]!);
  }
  return envs;
}

function stripEnvPrefix(segment: string[]): string[] {
  let i = 0;
  while (i < segment.length && ENV_ASSIGNMENT_RE.test(segment[i]!)) i += 1;
  return segment.slice(i);
}

/**
 * Normalise a path-like string to home-relative components, or undefined
 * when anchored outside home. Bare relative paths are treated as
 * home-relative: pi commonly runs from $HOME and `cat .ssh/id_rsa` must
 * match.
 */
function homeRelativeComponents(candidate: string, home: string): string[] | undefined {
  let rel: string;
  if (candidate.startsWith("~/")) rel = candidate.slice(2);
  else if (candidate === "~") rel = "";
  else if (candidate.startsWith("$HOME/") || candidate === "$HOME") rel = candidate.slice(6).replace(/^\/+/, "");
  else if (candidate.startsWith("${HOME}/") || candidate === "${HOME}") rel = candidate.slice(8).replace(/^\/+/, "");
  else if (candidate.startsWith("~")) return undefined; // ~user or a plain word
  else if (candidate.startsWith("/")) {
    if (candidate === home) rel = "";
    else if (candidate.startsWith(home + "/")) rel = candidate.slice(home.length + 1);
    else return undefined; // absolute outside home is never a secret path
  } else rel = candidate;
  return rel.split("/").filter((c) => c !== "" && c !== ".");
}

/** Secret path the candidate falls under (component-wise prefix), or undefined. */
export function matchedSecret(candidate: string, home: string): string | undefined {
  const components = homeRelativeComponents(candidate, home);
  if (!components || components.length === 0) return undefined;
  for (let s = 0; s < SECRET_PATHS.length; s++) {
    const secret = SECRET_COMPONENTS[s]!;
    if (secret.every((part, k) => components[k] === part)) return SECRET_PATHS[s];
  }
  return undefined;
}

function segmentSecret(segment: string[], home: string): string | undefined {
  for (const tok of segment) {
    // Check the whole token and any =-glued pieces (--flag=~/.ssh/x).
    const pieces = [tok, ...tok.split("=").slice(1)];
    for (const piece of pieces) {
      const secret = matchedSecret(piece, home);
      if (secret) return secret;
    }
  }
  return undefined;
}

function valueOf(tokens: string[], i: number): string | undefined {
  const eq = tokens[i]!.indexOf("=");
  if (eq !== -1) return tokens[i]!.slice(eq + 1);
  return tokens[i + 1];
}

/** Port of guard-protection-bypass.py _segment_reason (supply-chain flags). */
function supplyChainReason(segment: string[]): string | undefined {
  for (const tok of segment) {
    if (ENV_IGNORE_SCRIPTS_RE.test(tok)) return "re-enables install scripts via env (ignore_scripts=false)";
    if (ENV_AGE_RE.test(tok)) return "zeroes the package age-gate via env";
  }
  const command = stripEnvPrefix(segment);
  if (command.length === 0 || !PKG_TOOLS.has(command[0]!)) return undefined;
  if (command[0] === "bun" && command[1] === "pm" && command[2] === "trust") {
    return "trusts a package to run lifecycle scripts (bun pm trust)";
  }
  for (let i = 0; i < command.length; i++) {
    const name = command[i]!.split("=", 1)[0]!.toLowerCase();
    if (name === "--ignore-scripts" && (valueOf(command, i) ?? "").toLowerCase() === "false") {
      return "re-enables install scripts (--ignore-scripts=false)";
    }
    if (name === "--no-ignore-scripts") return "re-enables install scripts (--no-ignore-scripts)";
    if (AGE_FLAGS.has(name)) {
      const value = valueOf(command, i);
      if (value !== undefined && ZERO_RE.test(value)) {
        return "zeroes the package age-gate (e.g. --min-release-age=0 / --before 0d)";
      }
    }
    if (command[0] === "deno" && name === "--allow-scripts") {
      return "enables npm lifecycle scripts in Deno (--allow-scripts)";
    }
  }
  return undefined;
}

function rmRfReason(command: string[]): string | undefined {
  if (command[0] !== "rm") return undefined;
  const flags = command.slice(1).filter((t) => /^-[A-Za-z]+$/.test(t)).join("");
  if (flags.includes("r") && flags.includes("f")) {
    return "uses rm -rf; use `trash` outside temporary directories and leave temporary paths for system cleanup (AGENTS.md)";
  }
  return undefined;
}

function gitAddSweepReason(command: string[]): string | undefined {
  if (command[0] !== "git" || command[1] !== "add") return undefined;
  if (command.slice(2).some((t) => t === "-A" || t === "--all" || t === ".")) {
    return "stages sweepingly (git add -A/--all/.), which picks up unintended changes; stage explicit paths (AGENTS.md)";
  }
  return undefined;
}

function bashBlockReason(command: string, home: string): string | undefined {
  const isCommit = NOT_COMMIT_RE.test(command);
  const tokens = tokenise(command);
  if (tokens === undefined) {
    if (isCommit) return undefined;
    // Conservative fallback: only explicitly home-anchored secret paths.
    const bypass = FALLBACK_BYPASS_RE.exec(command);
    if (bypass && !BYPASS_FALSEY.has(bypass[1]!)) return undefined;
    const match = SECRET_FALLBACK_RE.exec(command);
    if (match) return secretReason(match[1]!);
    return undefined;
  }

  for (const segment of commandSegments(tokens)) {
    const cmd = stripEnvPrefix(segment);
    let dangerous = rmRfReason(cmd) ?? gitAddSweepReason(cmd);
    if (!isCommit) dangerous ??= supplyChainReason(segment);
    if (dangerous) return `This command ${dangerous}.`;
    if (isCommit) continue;

    const bypass = envAssignments(segment).get(BYPASS_VAR);
    if (bypass !== undefined && !BYPASS_FALSEY.has(bypass)) continue;
    const secret = segmentSecret(segment, home);
    if (secret) return secretReason(secret);
  }
  return undefined;
}

function secretReason(secret: string): string {
  return (
    `This touches the protected secret path ~/${secret} (srt denyRead twin; see `
    + "~/.config/srt/AGENTS.md two-layer model). If access is genuinely intended, "
    + `re-run the command with a \`${BYPASS_VAR}=1\` prefix to bypass.`
  );
}

/**
 * Reason to block this tool call, or undefined to let it through.
 * `home` is the absolute home directory (injected so the core stays pure).
 */
export function blockReason(
  toolName: string,
  input: Record<string, unknown>,
  home: string,
): string | undefined {
  const name = toolName.toLowerCase();
  if (name === "bash") {
    const command = typeof input["command"] === "string" ? (input["command"] as string) : "";
    if (!command) return undefined;
    return bashBlockReason(command, home);
  }
  if (PATH_TOOLS.has(name)) {
    const path = typeof input["path"] === "string" ? (input["path"] as string) : undefined;
    if (path === undefined) return undefined;
    const secret = matchedSecret(path, home);
    if (secret) return secretReason(secret);
    return undefined;
  }
  return undefined;
}
