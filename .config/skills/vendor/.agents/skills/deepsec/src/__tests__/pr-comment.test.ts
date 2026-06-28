import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureProject, writeFileRecord, writeRunMeta } from "@deepsec/core";
import { afterEach, describe, expect, it } from "vitest";
import { renderPrComment } from "../pr-comment.js";

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  delete process.env.DEEPSEC_DATA_ROOT;
});

function setupProject(): { projectId: string } {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deepsec-comment-"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepsec-root-"));
  process.env.DEEPSEC_DATA_ROOT = dataRoot;
  cleanup = () => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  };
  const projectId = `c-${Date.now().toString(36)}`;
  ensureProject(projectId, root);
  return { projectId };
}

describe("renderPrComment()", () => {
  it("returns null when the run had no findings", () => {
    const { projectId } = setupProject();
    const md = renderPrComment({ projectId, runId: "r1" });
    expect(md).toBeNull();
  });

  it("renders only net-new findings from the specified run", () => {
    const { projectId } = setupProject();

    writeRunMeta({
      runId: "r1",
      projectId,
      rootPath: "/tmp/x",
      createdAt: new Date().toISOString(),
      type: "process",
      phase: "done",
      stats: {},
    });

    writeFileRecord({
      filePath: "src/a.ts",
      projectId,
      candidates: [],
      lastScannedAt: new Date().toISOString(),
      lastScannedRunId: "r0",
      fileHash: "x",
      findings: [
        {
          severity: "HIGH",
          vulnSlug: "sql-injection",
          title: "Concatenated query",
          description: "User-controlled input flows into a string-concatenated SQL query.",
          lineNumbers: [12],
          recommendation: "Use parameterized queries.",
          confidence: "high",
          producedByRunId: "r1", // net-new in this run
        },
        {
          severity: "LOW",
          vulnSlug: "old",
          title: "Pre-existing finding",
          description: "Carried over from an earlier run.",
          lineNumbers: [99],
          recommendation: "n/a",
          confidence: "low",
          producedByRunId: "r-old", // attributable to a prior run
        },
        {
          severity: "MEDIUM",
          vulnSlug: "legacy",
          title: "Legacy finding without producedByRunId",
          description: "Predates the producedByRunId field.",
          lineNumbers: [42],
          recommendation: "n/a",
          confidence: "medium",
          // producedByRunId intentionally omitted — must not appear.
        },
      ],
      analysisHistory: [
        {
          runId: "r1",
          investigatedAt: new Date().toISOString(),
          durationMs: 100,
          agentType: "claude-agent-sdk",
          model: "test",
          modelConfig: {},
          findingCount: 1,
        },
      ],
      status: "analyzed",
    });

    // A different file with a finding from another run — must not leak in.
    writeFileRecord({
      filePath: "src/other.ts",
      projectId,
      candidates: [],
      lastScannedAt: new Date().toISOString(),
      lastScannedRunId: "r0",
      fileHash: "y",
      findings: [
        {
          severity: "CRITICAL",
          vulnSlug: "xss",
          title: "Stale finding from older run",
          description: "Should not appear.",
          lineNumbers: [1],
          recommendation: "irrelevant",
          confidence: "high",
          producedByRunId: "r-old",
        },
      ],
      analysisHistory: [
        {
          runId: "r-old",
          investigatedAt: new Date().toISOString(),
          durationMs: 100,
          agentType: "claude-agent-sdk",
          model: "test",
          modelConfig: {},
          findingCount: 1,
        },
      ],
      status: "analyzed",
    });

    const md = renderPrComment({ projectId, runId: "r1", source: "git-diff:HEAD~1" });
    expect(md).not.toBeNull();
    expect(md!).toContain("deepsec found 1 finding");
    expect(md!).toContain("src/a.ts:L12");
    expect(md!).toContain("Concatenated query");
    // Pre-existing findings from prior runs (or with no run id) are excluded.
    expect(md!).not.toContain("Pre-existing finding");
    expect(md!).not.toContain("Legacy finding without producedByRunId");
    expect(md!).not.toContain("Stale finding from older run");
    expect(md!).toContain("git-diff:HEAD~1");
  });
});
