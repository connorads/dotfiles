// A temp HOME holding the real caffeine-lib.sh, and stand-ins first on PATH for
// the three things a test must not touch for real: caffeinate (a long sleep
// that records its pid), pmset (a flag file) and sudo (refuses, or runs the
// pmset stand-in). Importing this rewrites process.env; restore() puts it back.
import { access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const realLib = join(homedir(), '.config/tmux/scripts/caffeine-lib.sh');
const hasLib = await access(realLib).then(() => true, () => false);
export const skip = process.platform !== 'darwin' ? 'macOS only' : !hasLib ? 'caffeine-lib.sh is not installed' : false;

export const root = await mkdtemp(join(tmpdir(), 'caffeine-'));
export const home = join(root, 'home');
export const bin = join(root, 'bin');
export const pidfile = join(home, '.cache/tmux-caffeinate.pid');
const realPath = process.env.PATH ?? '';
export const stubbedPath = `${bin}:${realPath}`;

await mkdir(join(home, '.config/tmux/scripts'), { recursive: true });
await mkdir(join(home, '.cache'), { recursive: true });
await mkdir(bin);
if (hasLib) await symlink(realLib, join(home, '.config/tmux/scripts/caffeine-lib.sh'));

async function stub(name: string, body: string) {
  await writeFile(join(bin, name), `#!/bin/sh\n${body}\n`);
  await chmod(join(bin, name), 0o755);
}
await stub('caffeinate', `echo $$ >> "$HOME/caffeinate.pids"
[ -f "$HOME/caffeinate.dies" ] && exit 1
exec sleep 100`);
await stub('pmset', `flag="$HOME/sleepdisabled"
case "$1" in
-g) if [ "$2" = batt ]; then
      if [ -f "$HOME/on-battery" ]; then echo "Now drawing from 'Battery Power'"; else echo "Now drawing from 'AC Power'"; fi
      exit 0
    fi
    printf 'System-wide power settings:\\n sleep 1\\n'
    [ -f "$flag" ] && printf ' SleepDisabled\\t\\t1\\n'
    exit 0 ;;
-a) if [ "$3" = 1 ]; then : > "$flag"; elif [ ! -f "$HOME/flag-sticks" ]; then rm -f "$flag"; fi ;;
esac`);
await stub('sudo', `[ -f "$HOME/sudo-refuses" ] && { echo "sudo: a password is required" >&2; exit 1; }
[ "$1" = -n ] && shift
if [ "$1" = /usr/bin/pmset ]; then shift; exec pmset "$@"; fi
exec "$@"`);

const saved = { HOME: process.env.HOME, PATH: process.env.PATH, CAFFEINE_PIDFILE: process.env.CAFFEINE_PIDFILE, CAFFEINE_LOG: process.env.CAFFEINE_LOG };
Object.assign(process.env, { HOME: home, PATH: stubbedPath });
delete process.env.CAFFEINE_PIDFILE;
delete process.env.CAFFEINE_LOG;

/** Flag files the stand-ins read. */
export type Flag = 'caffeinate.dies' | 'on-battery' | 'sudo-refuses' | 'sleepdisabled' | 'flag-sticks';
export const touch = (flag: Flag) => writeFile(join(home, flag), '');
export const untouch = (flag: Flag) => rm(join(home, flag), { force: true });
export const clearFlags = () => Promise.all((['caffeinate.dies', 'on-battery', 'sudo-refuses', 'sleepdisabled', 'flag-sticks'] as const).map(untouch));
export const exists = (path: string) => access(path).then(() => true, () => false);
export const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Every pid the caffeinate stand-in has run as. */
export async function stubPids(): Promise<number[]> {
  const text = await readFile(join(home, 'caffeinate.pids'), 'utf8').catch(() => '');
  return text.split('\n').filter(Boolean).map(Number);
}

export async function restore() {
  for (const pid of await stubPids()) { try { process.kill(pid); } catch { /* gone */ } }
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(root, { recursive: true, force: true });
}
