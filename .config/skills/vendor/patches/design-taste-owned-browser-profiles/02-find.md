// Each profile carries an owner file naming the machine and the two processes that use it (the run and
// its Chrome). A later run removes a profile left by a killed run only when that file names this machine
// and neither process is alive. A profile without one (made before 2.1.4, or by another tool) is never touched.
const OWNER = 'taste-skill-owner.json';

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

export function sweepProfiles(base) {
  let names;
  try { names = readdirSync(base); } catch { return; }
  for (const name of names) {
    if (!name.startsWith('ad-chrome-')) continue;
    const p = join(base, name);
    try {
      const o = JSON.parse(readFileSync(join(p, OWNER), 'utf8'));
      if (o.host !== hostname() || !Number.isInteger(o.pid) || alive(o.pid) || alive(o.chrome)) continue;
      rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {}
  }
}
