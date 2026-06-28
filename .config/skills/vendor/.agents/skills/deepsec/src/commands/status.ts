import type { FileStatus, ProjectConfig } from "@deepsec/core";
import { listRuns, loadAllFileRecords, readProjectConfig } from "@deepsec/core";
import { BOLD, CYAN, DIM, formatDuration, GREEN, RED, RESET, YELLOW } from "../formatters.js";
import { resolveProjectId } from "../resolve-project-id.js";

export async function statusCommand(opts: { projectId?: string }) {
  const projectId = resolveProjectId(opts.projectId);
  let project: ProjectConfig;
  try {
    project = readProjectConfig(projectId);
  } catch {
    console.log(`No project found for ${BOLD}${projectId}${RESET}`);
    return;
  }

  const records = loadAllFileRecords(projectId);
  const runs = listRuns(projectId);

  const statusCounts: Record<FileStatus, number> = {
    pending: 0,
    processing: 0,
    analyzed: 0,
    error: 0,
  };
  for (const r of records) {
    statusCounts[r.status]++;
  }

  const allFindings = records.flatMap((r) => r.findings);
  const critical = allFindings.filter((f) => f.severity === "CRITICAL").length;
  const high = allFindings.filter((f) => f.severity === "HIGH").length;
  const medium = allFindings.filter((f) => f.severity === "MEDIUM").length;
  const highBug = allFindings.filter((f) => f.severity === "HIGH_BUG").length;
  const bug = allFindings.filter((f) => f.severity === "BUG").length;

  console.log(`${BOLD}Project: ${projectId}${RESET}`);
  console.log(`  Root: ${project.rootPath}`);
  console.log(`  Files tracked: ${records.length}`);
  console.log();

  console.log(`  ${BOLD}Status${RESET}`);
  console.log(`    ${GREEN}analyzed:${RESET}   ${statusCounts.analyzed}`);
  if (statusCounts.processing > 0) {
    console.log(`    ${YELLOW}processing:${RESET} ${statusCounts.processing}`);
  }
  console.log(`    ${DIM}pending:${RESET}    ${statusCounts.pending}`);
  if (statusCounts.error > 0) {
    console.log(`    ${RED}error:${RESET}      ${statusCounts.error}`);
  }
  console.log();

  if (allFindings.length > 0) {
    console.log(`  ${BOLD}Findings${RESET}`);
    console.log(
      `    ${RED}CRITICAL: ${critical}${RESET}  |  ${YELLOW}HIGH: ${high}${RESET}  |  ${CYAN}MEDIUM: ${medium}${RESET}  |  \x1b[35mHIGH_BUG: ${highBug}${RESET}  |  \x1b[35mBUG: ${bug}${RESET}`,
    );

    // Revalidation progress
    const validated = allFindings.filter((f) => f.revalidation);
    if (validated.length > 0) {
      const tp = validated.filter((f) => f.revalidation?.verdict === "true-positive").length;
      const fp = validated.filter((f) => f.revalidation?.verdict === "false-positive").length;
      const fixed = validated.filter((f) => f.revalidation?.verdict === "fixed").length;
      const unc = validated.filter((f) => f.revalidation?.verdict === "uncertain").length;
      const dup = validated.filter((f) => f.revalidation?.verdict === "duplicate").length;
      const dupSuffix = dup > 0 ? `  ${DIM}Dupe: ${dup}${RESET}` : "";
      console.log(
        `    Revalidated: ${validated.length}/${allFindings.length}  ${GREEN}TP: ${tp}${RESET}  ${RED}FP: ${fp}${RESET}  ${CYAN}Fixed: ${fixed}${RESET}  ${YELLOW}Uncertain: ${unc}${RESET}${dupSuffix}`,
      );
    }

    // Triage progress
    const triaged = allFindings.filter((f) => f.triage);
    if (triaged.length > 0) {
      const p0 = triaged.filter((f) => f.triage?.priority === "P0").length;
      const p1t = triaged.filter((f) => f.triage?.priority === "P1").length;
      const p2t = triaged.filter((f) => f.triage?.priority === "P2").length;
      const skipped = triaged.filter((f) => f.triage?.priority === "skip").length;
      console.log(
        `    Triaged: ${triaged.length}/${allFindings.length}  ${RED}P0: ${p0}${RESET}  ${YELLOW}P1: ${p1t}${RESET}  ${CYAN}P2: ${p2t}${RESET}  ${DIM}skip: ${skipped}${RESET}`,
      );
    }
    console.log();
  }

  if (runs.length > 0) {
    console.log(`  ${BOLD}Recent runs${RESET} (${runs.length} total)`);
    for (const run of runs.slice(0, 5)) {
      const elapsed = run.completedAt
        ? formatDuration(new Date(run.completedAt).getTime() - new Date(run.createdAt).getTime())
        : "running";
      const statParts: string[] = [];
      if (run.stats.filesScanned) statParts.push(`scanned: ${run.stats.filesScanned}`);
      if (run.stats.filesProcessed) statParts.push(`processed: ${run.stats.filesProcessed}`);
      if (run.stats.findingsCount) statParts.push(`findings: ${run.stats.findingsCount}`);
      if (run.stats.totalCostUsd) statParts.push(`$${run.stats.totalCostUsd.toFixed(2)}`);
      if (run.stats.totalInputTokens || run.stats.totalOutputTokens) {
        const total = (run.stats.totalInputTokens ?? 0) + (run.stats.totalOutputTokens ?? 0);
        statParts.push(`${(total / 1000).toFixed(0)}k tokens`);
      }
      const stats = statParts.join(", ");
      console.log(
        `    ${DIM}${run.runId}${RESET} ${run.type} ${run.phase} ${elapsed}${stats ? ` (${stats})` : ""}`,
      );
    }
  }
}
