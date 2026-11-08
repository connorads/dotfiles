import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { labSchema, type LabState } from './lab-model';

const home = homedir();
const directory = join(home, '.local', 'state', 'bb-patch-lab');
const pointer = join(directory, 'current.json');
const script = join(home, 'src', 'bb-plugins', 'workflows-patch', 'scripts', 'patch_lab.py');
function execute(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, { timeout: 20_000, maxBuffer: 256 * 1024,
      env: { HOME: home, PATH: '/usr/bin:/bin', LC_ALL: 'C' } }, (error, stdout, stderr) => {
      if (error) { reject(new Error(stdout.trim() || stderr.trim() || 'Rehearsal command failed')); return; }
      resolve(stdout.trim());
    });
  });
}
async function command(args: string[]) { return labSchema.parse(JSON.parse(await execute('/usr/bin/python3', ['-B', script, ...args]))); }
async function current(): Promise<string | null> {
  try {
    const saved = JSON.parse(await readFile(pointer, 'utf8'));
    if (typeof saved.root !== 'string') throw new Error('Invalid rehearsal pointer');
    return saved.root;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}
function failed(error: unknown): LabState {
  let reason = error instanceof Error ? error.message : 'Rehearsal unavailable';
  try { const parsed = JSON.parse(reason); if (typeof parsed.error === 'string') reason = parsed.error; } catch { /* Non-JSON command diagnostic. */ }
  return { kind: 'unavailable', reason: reason.slice(0, 500) };
}
export async function labStatus(): Promise<LabState> {
  try { const root = await current(); return root ? { kind: 'available', lab: await command(['status', root]) } : { kind: 'none' }; }
  catch (error) { return failed(error); }
}
export async function prepareLab(): Promise<LabState> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let gate;
  try {
    gate = await open(join(directory, 'create.lock'), 'wx', 0o600);
    const existing = await labStatus();
    if (existing.kind === 'available' && ['preparing', 'rehearsing', 'ready', 'interrupted'].includes(existing.lab.phase)) return existing;
    const mise = `/etc/profiles/per-user/${basename(home)}/bin/mise`;
    const [nodeRoot, bbRoot] = await Promise.all([
      execute(mise, ['-C', home, 'where', 'node']), execute(mise, ['-C', home, 'where', 'npm:bb-app']),
    ]);
    const lab = await command(['create', '--package', join(bbRoot, 'node_modules', 'bb-app'), '--node', join(nodeRoot, 'bin', 'node')]);
    const staged = `${pointer}.next`;
    const file = await open(staged, 'w', 0o600);
    try { await file.writeFile(JSON.stringify({ root: lab.root })); await file.sync(); } finally { await file.close(); }
    await rename(staged, pointer);
    return { kind: 'available', lab: await command(['start', lab.root, 'prepare', String(lab.revision)]) };
  } catch (error) { return failed(error); }
  finally { if (gate) { await gate.close(); await unlink(join(directory, 'create.lock')); } }
}
export async function actOnLab(action: 'run' | 'reconcile', id: string, revision: number): Promise<LabState> {
  try {
    const root = await current();
    if (!root) throw new Error('No prepared rehearsal');
    const lab = await command(['status', root]);
    if (lab.id !== id || lab.revision !== revision) throw new Error('Rehearsal changed. Refresh before continuing.');
    return { kind: 'available', lab: await command(action === 'run' ? ['start', root, 'run', String(revision)] : ['reconcile', root]) };
  } catch (error) { return failed(error); }
}
