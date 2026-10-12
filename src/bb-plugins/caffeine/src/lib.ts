// The host's only way into keep-awake: fixed sh scripts that source
// caffeine-lib.sh, so the tmux pill and the BB chip read and write one
// pidfile. Values travel as positional arguments, never interpolated.
import { spawn } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AGENTS_OWNER, type ActionResult, type Details, type LibStatus } from './domain.ts';
import { DID_NOT_START, outcome, STILL_STUCK, type Op, type Run } from './outcome.ts';

/** $1 is the lib, $2 the one numeric argument. Exit 9 is a guard that refused. */
export const SCRIPTS = {
  status: `. "$1"; command -v caffeinate >/dev/null 2>&1 || { echo unsupported; exit 0; }
u=$(printf '\\037')
printf '%s%s%s%s%s%s%s%s%s\\n' "$(caffeine_state)" "$u" "$(caffeine_pid)" "$u" "$(caffeine_deadline)" "$u" "$(caffeine_owner)" "$u" "$CAFFEINE_PIDFILE"`,
  details: `. "$1"; if caffeine_sleep_disabled; then echo 1; else echo 0; fi; pmset -g batt 2>/dev/null | head -1`,
  start: `. "$1"; caffeine_start "$2"`,
  startLid: `. "$1"; caffeine_start_lid "$2"`,
  extend: `. "$1"; m=$(caffeine_mode); t=$(caffeine_extend_total "$2") || exit $((10 + $?))
if [ "$m" = lid ]; then caffeine_start_lid "$t"; else caffeine_start "$t"; fi`,
  stop: `. "$1"; caffeine_stop`,
  startOwned: `. "$1"; caffeine_start "$2" ${AGENTS_OWNER}`,
  renewOwned: `. "$1"; [ "$(caffeine_owner)" = ${AGENTS_OWNER} ] && caffeine_active || exit 9; caffeine_start "$2" ${AGENTS_OWNER}`,
  stopOwned: `. "$1"; [ "$(caffeine_owner)" = ${AGENTS_OWNER} ] || exit 9; caffeine_stop`,
  clear: `. "$1"; [ "$(caffeine_state)" != ON-LID ] && caffeine_sleep_disabled || exit 9; caffeine_clear_sleep_disabled`,
} as const;
export type Script = keyof typeof SCRIPTS;

/** Resolved per call, so tests can point HOME at a temp dir. */
export const libPath = () => join(homedir(), '.config/tmux/scripts/caffeine-lib.sh');

/**
 * `detached` gives the shell, and the caffeinate it starts, their own process
 * group, so a host worker that is idle-stopped does not take the keep-awake
 * with it. Only reads get a timeout: killing a start between its nohup and the
 * pidfile write would orphan a caffeinate nothing tracks.
 */
export function runScript(script: Script, args: readonly string[] = [], timeoutMs: number | null = null): Promise<Run> {
  return new Promise(resolve => {
    const child = spawn('/bin/sh', ['-c', SCRIPTS[script], 'caffeine', libPath(), ...args], {
      detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = timeoutMs === null ? null : setTimeout(() => { try { process.kill(-child.pid!, 'SIGTERM'); } catch { /* gone */ } }, timeoutMs);
    child.on('error', error => { stderr += `${error.message}\n`; });
    child.on('close', code => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

export type StatusLine =
  | { kind: 'unsupported' }
  | { kind: 'off' }
  | { kind: 'on'; lid: boolean; pid: number; deadline: number | null; owner: string | null; pidfile: string };

/** The status script's one line, fields separated by US (0x1f). */
export function parseStatusLine(stdout: string): StatusLine {
  const line = stdout.trim();
  if (line === 'unsupported') return { kind: 'unsupported' };
  const [state, pidText, deadlineText, owner, pidfile] = line.split('\x1f');
  const pid = Number(pidText);
  if ((state !== 'ON' && state !== 'ON-LID') || !Number.isInteger(pid) || pid <= 0) return { kind: 'off' };
  const deadline = Number(deadlineText);
  return {
    kind: 'on', lid: state === 'ON-LID', pid,
    deadline: Number.isFinite(deadline) && deadline > 0 ? deadline * 1000 : null,
    owner: owner ? owner : null, pidfile: pidfile ?? '',
  };
}

export function parseDetails(stdout: string): Omit<Details, 'busyNow'> {
  const [flag = '', battery = ''] = stdout.split('\n');
  return {
    sleepDisabled: flag.trim() === '1',
    onBattery: battery.includes("'Battery Power'") ? true : battery.includes("'AC Power'") ? false : null,
  };
}

function seconds(value: number, allowZero = false): string {
  const text = String(value);
  if (!/^\d+$/.test(text) || (!allowZero && value <= 0)) throw new Error(`Not a duration in seconds: ${text}`);
  return text;
}

/** Long enough for a caffeinate that dies at exec to be reaped, so the check after a start sees it. */
const settleMs = 250;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export type CaffeineHost = ReturnType<typeof createCaffeineHost>;

/**
 * Every call, reads included, runs through one queue: two overlapping
 * caffeine_start calls would each stop the other's pid and orphan one, and a
 * read that overtakes a write would report the old state after the new one.
 */
export function createCaffeineHost(platform: NodeJS.Platform = process.platform) {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  };

  async function readStatus(): Promise<LibStatus> {
    if (platform !== 'darwin') return { kind: 'unsupported', reason: 'not-macos' };
    try { await access(libPath()); } catch { return { kind: 'unsupported', reason: 'no-lib' }; }
    const run = await runScript('status', [], 10_000);
    if (run.code !== 0) throw new Error(`caffeine status failed: ${run.stderr.trim() || `exit ${run.code}`}`);
    const line = parseStatusLine(run.stdout);
    if (line.kind === 'unsupported') return { kind: 'unsupported', reason: 'no-caffeinate' };
    if (line.kind === 'off') return line;
    // Every start rewrites the pidfile, so its mtime is when this session began.
    const startedAt = await stat(line.pidfile).then(info => info.mtimeMs, () => Date.now());
    return { kind: 'on', lid: line.lid, pid: line.pid, deadline: line.deadline, startedAt, owner: line.owner };
  }

  async function readDetails(): Promise<Omit<Details, 'busyNow'>> {
    if (platform !== 'darwin') return { sleepDisabled: false, onBattery: null };
    return parseDetails((await runScript('details', [], 10_000)).stdout);
  }

  /** The lib returns 0 even when caffeinate died at once, so a start is checked by reading the state back. */
  async function startChecked(op: Op, script: Script, args: string[], owner: string | null): Promise<ActionResult> {
    const result = outcome(op, await runScript(script, args));
    if (!result.ok) return result;
    await sleep(settleMs);
    const status = await readStatus();
    if (status.kind !== 'on' || (owner !== null && status.owner !== owner)) return { ok: false, reason: DID_NOT_START, stoppedPrevious: false };
    return result;
  }

  return {
    status: () => serial(readStatus),
    details: () => serial(readDetails),
    /** secs 0 is indefinite. */
    start: (secs: number) => serial(() => startChecked('start', 'start', [seconds(secs, true)], null)),
    startLid: (secs: number) => serial(async () => outcome('startLid', await runScript('startLid', [seconds(secs)]))),
    extend: (add: number) => serial(async () => {
      const before = await readStatus();
      const lid = before.kind === 'on' && before.lid;
      const result = outcome('extend', await runScript('extend', [seconds(add)]));
      if (!result.ok || lid) return result;
      await sleep(settleMs);
      return (await readStatus()).kind === 'on' ? result : { ok: false as const, reason: DID_NOT_START, stoppedPrevious: true };
    }),
    stop: () => serial(async () => outcome('stop', await runScript('stop'))),
    startOwned: (secs: number) => serial(() => startChecked('startOwned', 'startOwned', [seconds(secs)], AGENTS_OWNER)),
    renewOwned: (secs: number) => serial(async (): Promise<'renewed' | 'not-owned'> => {
      const run = await runScript('renewOwned', [seconds(secs)]);
      if (run.code === 9) return 'not-owned';
      if (run.code !== 0) throw new Error(`caffeine renew failed: ${run.stderr.trim() || `exit ${run.code}`}`);
      return 'renewed';
    }),
    stopOwned: () => serial(async (): Promise<'stopped' | 'not-owned'> => {
      const run = await runScript('stopOwned');
      if (run.code === 9) return 'not-owned';
      if (run.code !== 0) throw new Error(`caffeine stop failed: ${run.stderr.trim() || `exit ${run.code}`}`);
      return 'stopped';
    }),
    clear: () => serial(async (): Promise<ActionResult> => {
      const result = outcome('clear', await runScript('clear'));
      if (!result.ok) return result;
      return (await readDetails()).sleepDisabled ? { ok: false, reason: STILL_STUCK, stoppedPrevious: false } : result;
    }),
  };
}
