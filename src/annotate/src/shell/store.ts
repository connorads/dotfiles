// The event log on disk: read the whole file, fold it, append a line.
//
// Nothing is ever rewritten, so the only race worth serialising is the
// read-fold-append in `stash` - two panes capturing at once must not
// interleave a partial line. An O_EXCL lockfile with a stale-age escape is
// enough for that; readers take no lock at all, because a torn final line is
// exactly what the tolerant parser already handles.

import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { eventLine, foldLog, type Event, type State } from "../core/events.ts";
import { err, ok, type Result } from "../core/result.ts";

export type StoreError = { readonly kind: "io"; readonly message: string };

const asStoreError = (action: string, cause: unknown): StoreError => ({
  kind: "io",
  message: `${action}: ${cause instanceof Error ? cause.message : String(cause)}`,
});

/** Fold the log into state. A log that does not exist yet is empty state. */
export const readState = async (logPath: string): Promise<Result<State, StoreError>> => {
  let text: string;
  try {
    text = await readFile(logPath, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return ok(foldLog(""));
    return err(asStoreError(`cannot read ${logPath}`, cause));
  }
  return ok(foldLog(text));
};

/** Append one event. Creates the state directory on first use. */
export const appendEvent = async (
  logPath: string,
  event: Event,
): Promise<Result<null, StoreError>> => {
  try {
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, eventLine(event), "utf8");
    return ok(null);
  } catch (cause) {
    return err(asStoreError(`cannot append to ${logPath}`, cause));
  }
};

/** How long a lockfile may sit before it is assumed to be a crashed writer. */
const LOCK_STALE_MS = 10_000;
const LOCK_POLL_MS = 25;
const LOCK_WAIT_MS = 2_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Run `body` with the log locked against other writers.
 *
 * The lock is advisory and self-healing: a lockfile older than
 * `LOCK_STALE_MS` is removed rather than waited on, so a killed pane cannot
 * wedge every later capture. Waiting past `LOCK_WAIT_MS` gives up and runs
 * anyway - a lost capture is worse than an interleaved one, and appends of a
 * single line under the pipe-buffer size do not tear in practice.
 */
export const withLock = async <T>(
  logPath: string,
  body: () => Promise<T>,
  clock: () => number = Date.now,
): Promise<T> => {
  const lockPath = `${logPath}.lock`;
  const deadline = clock() + LOCK_WAIT_MS;
  let held = false;

  await mkdir(dirname(logPath), { recursive: true }).catch(() => undefined);

  while (clock() < deadline) {
    try {
      await writeFile(lockPath, String(process.pid), { flag: "wx" });
      held = true;
      break;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") break;
      const age = await lockAge(lockPath, clock);
      if (age !== null && age > LOCK_STALE_MS) {
        await rm(lockPath, { force: true }).catch(() => undefined);
        continue;
      }
      await sleep(LOCK_POLL_MS);
    }
  }

  try {
    return await body();
  } finally {
    if (held) await rm(lockPath, { force: true }).catch(() => undefined);
  }
};

const lockAge = async (lockPath: string, clock: () => number): Promise<number | null> => {
  try {
    const { stat } = await import("node:fs/promises");
    const info = await stat(lockPath);
    return clock() - info.mtimeMs;
  } catch {
    return null;
  }
};
