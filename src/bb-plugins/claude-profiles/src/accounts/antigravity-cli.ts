import { spawn, execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { antigravityLaunch, prepareAntigravityProfile } from './antigravity-profile.ts';

try {
  const [id, ...args] = process.argv.slice(2);
  if (process.platform !== 'darwin') throw new Error('Isolated Antigravity profiles are verified on macOS only.');
  if (id === 'create' && args.length === 1) {
    await prepareAntigravityProfile(homedir(), args[0]!);
    console.log(`Profile ready. Sign in with agy-profile ${args[0]} acp --login`);
  } else {
    if (!id || !args.length) throw new Error('Usage: agy-profile create NAME | agy-profile NAME AGY-ARGS...');
    // Resolve mise before replacing HOME. A mise shim inside the private home can select a different tool.
    const executable = execFileSync('mise', ['-C', homedir(), 'which', 'agy'], { encoding: 'utf8', timeout: 10_000 }).trim();
    const version = execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim();
    if (version !== '1.5.9') throw new Error(`Isolated authentication needs verification with agy ${version}. Tested version: 1.5.9.`);
    const launch = await antigravityLaunch(homedir(), id, executable);
    const child = spawn(launch.command, [...launch.args, ...args], { env: launch.env, stdio: 'inherit' });
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, () => { child.kill(signal); });
    child.on('error', () => { console.error('Could not launch the isolated Antigravity account.'); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Antigravity profile failed.');
  process.exitCode = 1;
}
