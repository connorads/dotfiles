// Claude reviewer. `--permission-mode plan` is not read-only in headless use:
// the user allowlist still applies inside it (see ADR 0001). This flag set is:
// no settings sources (so neither the user's nor the reviewed repo's
// .claude/settings.json can widen permissions), dontAsk (anything not
// allowlisted is denied rather than prompted), an allowlist of read tools plus
// read-only git subcommands, and --settings from core/sandbox.ts, which closes
// what the allowlist cannot.

import { err, ok } from "../core/result.ts";
import { claudeSettings } from "../core/sandbox.ts";
import { REPORT_SCHEMA } from "../core/schema.ts";
import { loadDenyRead } from "./policy.ts";
import { run, tail } from "./proc.ts";
import type { RunReviewer } from "./reviewer.ts";

export const ALLOWED_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
  "Bash(git status:*)",
] as const;

export const claudeArgv = (settings: string, model: string, effort: string): string[] => [
  "claude",
  "-p",
  "--setting-sources",
  "",
  "--settings",
  settings,
  "--strict-mcp-config",
  "--permission-mode",
  "dontAsk",
  "--tools",
  "Read",
  "Grep",
  "Glob",
  "Bash",
  "--allowedTools",
  ...ALLOWED_TOOLS,
  "--json-schema",
  JSON.stringify(REPORT_SCHEMA),
  "--output-format",
  "json",
  "--model",
  model,
  "--effort",
  effort,
];

type Obj = Record<string, unknown>;

export const runClaude: RunReviewer = async ({ spec, prompt, cwd, home, denyWrite }) => {
  const denyRead = await loadDenyRead(home);
  if (!denyRead.ok) return denyRead;
  const settings = JSON.stringify(claudeSettings({ home, denyRead: denyRead.value, denyWrite }));
  const r = await run(claudeArgv(settings, spec.model, spec.effort), { cwd, stdin: prompt });
  let out: Obj;
  try {
    out = JSON.parse(r.stdout) as Obj;
  } catch {
    return err(`claude exited ${r.code}: ${tail(r.stderr) || tail(r.stdout)}`);
  }
  if (out["is_error"] === true || out["structured_output"] === undefined) {
    const why = typeof out["result"] === "string" ? out["result"] : JSON.stringify(out["subtype"] ?? "no structured output");
    return err(`claude: ${tail(why, 3)}`);
  }
  return ok(out["structured_output"]);
};
