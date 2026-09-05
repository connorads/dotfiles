import { homedir } from "node:os"

export type Decision =
  | { readonly kind: "pass" }
  | { readonly kind: "deny"; readonly policy: string; readonly reason: string }
  | { readonly kind: "ask"; readonly policy: string; readonly reason: string }

export type Request =
  | { readonly kind: "shell"; readonly command: string }
  | { readonly kind: "path"; readonly path: string }

export const SECRET_PATHS = [
  ".ssh", ".config/gh-gate", ".config/gh", ".aws", ".config/gcloud", ".netrc",
  ".config/fnox", ".fnox", "Library/Keychains", ".zshrc.local", ".docker/config.json",
  ".gnupg", ".cloudflared", ".gemini", ".config/op", ".kube", ".password-store",
] as const

const pass: Decision = { kind: "pass" }
const falsey = new Set(["", "0", "false", "False", "no"])
const envRe = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/
const commitRe = /\b(?:git|dotfiles)\b.*\bcommit\b/

export function tokenise(source: string): string[] | undefined {
  const out: string[] = []
  let word = ""
  let active = false
  const push = (): void => { if (active) out.push(word); word = ""; active = false }
  for (let i = 0; i < source.length;) {
    const char = source[i]!
    if (char === "'" || char === '"') {
      const quote = char
      let j = i + 1
      for (; j < source.length && source[j] !== quote; j += 1) {
        if (quote === '"' && source[j] === "\\" && j + 1 < source.length) j += 1
        word += source[j]!
      }
      if (j === source.length) return undefined
      active = true
      i = j + 1
    } else if (char === "\\") {
      if (i + 1 < source.length) { word += source[i + 1]!; active = true }
      i += 2
    } else if (/\s/.test(char)) {
      push(); i += 1
    } else if (";&|".includes(char)) {
      push()
      let j = i
      while (j < source.length && ";&|".includes(source[j]!)) j += 1
      out.push(source.slice(i, j)); i = j
    } else { word += char; active = true; i += 1 }
  }
  push()
  return out
}

function segments(tokens: readonly string[]): string[][] {
  const out: string[][] = []
  let current: string[] = []
  for (const token of tokens) {
    if (/^[;&|]+$/.test(token)) { if (current.length) out.push(current); current = [] }
    else current.push(token)
  }
  if (current.length) out.push(current)
  return out
}

function env(segment: readonly string[]): Map<string, string> {
  const result = new Map<string, string>()
  for (const token of segment) {
    const match = envRe.exec(token)
    if (!match) break
    result.set(match[1]!, match[2]!)
  }
  return result
}

function command(segment: readonly string[]): string[] {
  let i = 0
  while (i < segment.length && envRe.test(segment[i]!)) i += 1
  return segment.slice(i)
}

function secret(candidate: string): string | undefined {
  let relative = candidate
  const home = homedir()
  if (candidate.startsWith("~/")) relative = candidate.slice(2)
  else if (candidate.startsWith("$HOME/")) relative = candidate.slice(6)
  else if (candidate.startsWith("${HOME}/")) relative = candidate.slice(8)
  else if (candidate.startsWith(home + "/")) relative = candidate.slice(home.length + 1)
  else if (candidate.startsWith("/") || candidate.startsWith("~")) return undefined
  const parts = relative.split("/").filter((part) => part && part !== ".")
  return SECRET_PATHS.find((entry) => {
    const wanted = entry.split("/")
    return wanted.every((part, index) => parts[index] === part)
  })
}

function secretDecision(candidate: string): Decision {
  const found = secret(candidate)
  return found
    ? { kind: "deny", policy: "secret_path", reason: `Blocked protected secret path ~/${found}. Prefix with SECRETS_OK=1 only for a deliberate exception.` }
    : pass
}

function shellSecret(segment: readonly string[]): Decision {
  const bypass = env(segment).get("SECRETS_OK")
  if (bypass !== undefined && !falsey.has(bypass)) return pass
  for (const token of segment) {
    for (const piece of [token, ...token.split("=").slice(1)]) {
      const decision = secretDecision(piece)
      if (decision.kind === "deny") return decision
    }
  }
  return pass
}

function pnpmDecision(argv: readonly string[], vars: ReadonlyMap<string, string>): Decision {
  const bypass = vars.get("NPM_OK")
  if (bypass !== undefined && !falsey.has(bypass)) return pass
  if (argv[0] === "npx") return { kind: "deny", policy: "prefer_pnpm", reason: "Use `pnpm dlx` instead of `npx`, or prefix with NPM_OK=1 when npm is required." }
  const verbs = new Set(["install", "i", "add", "ci", "update", "up", "exec", "dedupe"])
  const verb = argv.slice(1).find((part) => !part.startsWith("-"))
  if (argv[0] === "npm" && verb && verbs.has(verb)) {
    return { kind: "deny", policy: "prefer_pnpm", reason: `Use pnpm instead of \`npm ${verb}\`, or prefix with NPM_OK=1 when npm is required.` }
  }
  return pass
}

function githubDecision(argv: readonly string[], vars: ReadonlyMap<string, string>): Decision {
  if (argv[0] !== "gh") return pass
  if (argv[1] === "pr" && argv[2] === "merge") return { kind: "deny", policy: "github_merge", reason: "Blocked PR merge. Hand back with the PR open and checks green so the user can merge." }
  if (argv[1] !== "api") return pass
  const joined = argv.slice(2).join(" ")
  const mutating = /(?:^|\s)(?:-X\s*(?:POST|PUT|PATCH|DELETE)|--method(?:=|\s+)(?:POST|PUT|PATCH|DELETE)|-[fF](?:\s|\S)|--(?:field|raw-field|input)(?:=|\s))/i.test(joined)
  const explicitGet = /(?:^|\s)(?:-X\s*GET|--method(?:=|\s+)GET)\b/i.test(joined)
  if (!mutating || explicitGet) return pass
  if (/repos\/[^/\s]+\/[^/\s]+\/pulls\/[^/\s]+\/merge\b/i.test(joined)) return { kind: "deny", policy: "github_merge", reason: "Blocked PR merge. Hand back with the PR open and checks green so the user can merge." }
  if (/repos\/[^/\s]+\/[^/\s]+\/(?:rulesets|branches\/[^/\s]+\/protection)\b/i.test(joined)) return { kind: "deny", policy: "github_protection", reason: "Blocked branch-protection write. The user must apply this change." }
  const bypass = vars.get("MUTATE_OK")
  if (bypass !== undefined && !falsey.has(bypass)) return pass
  return { kind: "deny", policy: "github_mutation", reason: "Blocked mutating `gh api` request. Prefix with MUTATE_OK=1 only when the write is intended." }
}

function supplyDecision(argv: readonly string[], segment: readonly string[]): Decision {
  const tool = argv[0]
  if (!tool || !new Set(["npm", "pnpm", "bun", "bunx", "yarn", "npx", "deno", "mise", "uv", "pip", "pip3", "corepack"]).has(tool)) return pass
  const joined = segment.join(" ")
  const bypass = /ignore_scripts=false/i.test(joined) || /--(?:no-ignore-scripts|ignore-scripts=false)\b/i.test(joined) || /--(?:min(?:imum)?-release-age|minimum-dependency-age|before)(?:=|\s+)0[a-z]*\b/i.test(joined) || (tool === "deno" && argv.includes("--allow-scripts")) || (tool === "bun" && argv[1] === "pm" && argv[2] === "trust")
  return bypass ? { kind: "ask", policy: "supply_chain_bypass", reason: "This command weakens supply-chain protections. Confirm only if the bypass is intended." } : pass
}

export function decide(request: Request): Decision {
  if (request.kind === "path") return secretDecision(request.path)
  if (commitRe.test(request.command)) return pass
  const tokens = tokenise(request.command)
  if (!tokens) {
    const explicit = /(?:~|\$HOME|\$\{HOME\})\/(\.ssh|\.config\/gh(?:-gate)?|\.aws|\.netrc|\.gnupg|\.kube)(?:\/|$|\s)/.exec(request.command)
    return explicit ? secretDecision(`~/${explicit[1]!}`) : pass
  }
  let asked: Decision = pass
  for (const segment of segments(tokens)) {
    const argv = command(segment)
    for (const candidate of [shellSecret(segment), githubDecision(argv, env(segment)), pnpmDecision(argv, env(segment)), supplyDecision(argv, segment)]) {
      if (candidate.kind === "deny") return candidate
      if (candidate.kind === "ask") asked = candidate
    }
  }
  return asked
}
