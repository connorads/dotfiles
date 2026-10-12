// Fixture git for tests: never the caller's repository, config or hooks.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitEnv } from './git-env.ts';

const hermetic = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
// The code under test reads process.env, so make it hermetic too.
Object.assign(process.env, hermetic);

export function fixtureGit(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@example.com', '-c', 'init.defaultBranch=main', '-c', 'core.hooksPath=/dev/null', ...args],
    { cwd, encoding: 'utf8', env: gitEnv(hermetic), stdio: ['ignore', 'pipe', 'pipe'] });
}

export const tempDir = () => realpathSync(mkdtempSync(join(tmpdir(), 'diff-viewer-')));
