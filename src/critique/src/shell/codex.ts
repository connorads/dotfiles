// Codex reviewer. `-s read-only` is Codex's OS sandbox: writes fail whatever
// the model tries. project_doc_max_bytes=0 stops Codex auto-loading the
// reviewed repo's AGENTS.md; guidance reaches the reviewer only through the
// prompt, where a PR's is taken from its base.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok } from "../core/result.ts";
import { REPORT_SCHEMA } from "../core/schema.ts";
import { run, tail } from "./proc.ts";
import type { RunReviewer } from "./reviewer.ts";

export const codexArgv = (schemaPath: string, outPath: string, model: string, effort: string): string[] => [
  "codex",
  "exec",
  "-s",
  "read-only",
  "--skip-git-repo-check",
  "-c",
  "project_doc_max_bytes=0",
  "--output-schema",
  schemaPath,
  "-o",
  outPath,
  "-m",
  model,
  "-c",
  `model_reasoning_effort=${effort}`,
  "-",
];

export const runCodex: RunReviewer = async ({ spec, prompt, cwd, workdir }) => {
  const schemaPath = join(workdir, "schema.json");
  const outPath = join(workdir, "last-message.json");
  await writeFile(schemaPath, JSON.stringify(REPORT_SCHEMA));
  const r = await run(codexArgv(schemaPath, outPath, spec.model, spec.effort), { cwd, stdin: prompt });
  if (r.code !== 0) return err(`codex exited ${r.code}: ${tail(r.stderr) || tail(r.stdout)}`);
  const text = await Bun.file(outPath)
    .text()
    .catch(() => null);
  if (text === null || text.trim() === "") return err("codex wrote no final message");
  try {
    return ok(JSON.parse(text) as unknown);
  } catch {
    return err(`codex final message is not JSON: ${tail(text, 3)}`);
  }
};
