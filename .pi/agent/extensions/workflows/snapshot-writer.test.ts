import assert from "node:assert/strict";
import test from "node:test";

import { parseRunId, type RunId, type WorkflowRunSnapshot } from "./domain.ts";
import { WorkflowSnapshotWriter, type SnapshotWriteScheduler } from "./snapshot-writer.ts";

test("soft snapshot writes are debounced to the latest snapshot", async () => {
  const store = new RecordingSnapshotStore();
  const scheduler = new FakeScheduler();
  const writer = new WorkflowSnapshotWriter({
    store,
    generation: 3,
    flushMs: 50,
    scheduler,
  });

  writer.touch(makeSnapshot({ updatedAt: 10 }));
  writer.touch(makeSnapshot({ updatedAt: 20 }));
  writer.touch(makeSnapshot({ updatedAt: 30 }));

  assert.equal(store.writes.length, 0);
  assert.equal(scheduler.scheduled.length, 1);

  await scheduler.runNext();
  assert.deepEqual(store.writes.map((write) => [write.snapshot.updatedAt, write.generation]), [[30, 3]]);
});

test("immediate writes drain pending soft state and cancel the timer", async () => {
  const store = new RecordingSnapshotStore();
  const scheduler = new FakeScheduler();
  const writer = new WorkflowSnapshotWriter({ store, scheduler });

  writer.touch(makeSnapshot({ updatedAt: 10 }));
  await writer.writeNow(makeSnapshot({ updatedAt: 40, status: "running" }));

  assert.equal(scheduler.scheduled.length, 0);
  assert.deepEqual(store.writes.map((write) => write.snapshot.updatedAt), [40]);
});

test("drainAndDispose prevents stale soft writes after terminal state is owned elsewhere", async () => {
  const store = new RecordingSnapshotStore();
  const scheduler = new FakeScheduler();
  const writer = new WorkflowSnapshotWriter({ store, scheduler });

  writer.touch(makeSnapshot({ updatedAt: 10 }));
  await writer.drainAndDispose();
  writer.touch(makeSnapshot({ updatedAt: 20 }));
  await scheduler.runNext();

  assert.deepEqual(store.writes.map((write) => write.snapshot.updatedAt), [10]);
});

test("writeNow rejects after disposal", async () => {
  const store = new RecordingSnapshotStore();
  const writer = new WorkflowSnapshotWriter({ store });

  await writer.drainAndDispose();

  await assert.rejects(() => writer.writeNow(makeSnapshot({ updatedAt: 20 })), /after writer disposal/u);
  assert.equal(store.writes.length, 0);
});

test("drainAndDispose still disposes when flushing fails", async () => {
  const store = new RecordingSnapshotStore();
  const scheduler = new FakeScheduler();
  const writer = new WorkflowSnapshotWriter({ store, scheduler });

  store.error = new Error("disk full");
  writer.touch(makeSnapshot({ updatedAt: 10 }));

  await assert.rejects(() => writer.drainAndDispose(), /disk full/u);
  writer.touch(makeSnapshot({ updatedAt: 20 }));

  assert.equal(scheduler.scheduled.length, 0);
  await assert.rejects(() => writer.writeNow(makeSnapshot({ updatedAt: 30 })), /after writer disposal/u);
});

class RecordingSnapshotStore {
  readonly writes: Array<{ readonly snapshot: WorkflowRunSnapshot; readonly generation: number | undefined }> = [];
  error: Error | undefined;

  async updateRun(snapshot: WorkflowRunSnapshot, generation?: number): Promise<void> {
    if (this.error !== undefined) throw this.error;
    this.writes.push({ snapshot, generation });
  }
}

class FakeScheduler implements SnapshotWriteScheduler {
  readonly scheduled: Array<() => void> = [];

  schedule(callback: () => void, _ms: number): () => void {
    this.scheduled.push(callback);
    return () => {
      const index = this.scheduled.indexOf(callback);
      if (index !== -1) this.scheduled.splice(index, 1);
    };
  }

  async runNext(): Promise<void> {
    const callback = this.scheduled.shift();
    if (callback === undefined) return;
    callback();
    await Promise.resolve();
    await Promise.resolve();
  }
}

function makeSnapshot(over: Partial<Omit<WorkflowRunSnapshot, "runId" | "schemaVersion">> = {}): WorkflowRunSnapshot {
  return {
    schemaVersion: 2,
    runId: mustRunId("wf_writer01"),
    projectKey: "project",
    cwd: "/tmp/project",
    status: "running",
    workflowName: "workflow",
    sourceKind: "inline",
    sourceHash: "hash",
    scriptFile: "script.js",
    args: null,
    meta: {},
    toolAllowlist: ["read"],
    excludedTools: ["workflow"],
    budgetTotal: null,
    budgetSpent: 0,
    agentCalls: 0,
    agents: [],
    phases: [],
    logs: [],
    startedAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function mustRunId(value: string): RunId {
  const parsed = parseRunId(value);
  if (parsed.ok) return parsed.value;
  throw parsed.error;
}
