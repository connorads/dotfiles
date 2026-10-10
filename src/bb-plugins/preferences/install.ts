import { accessSync, constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const path = join(homedir(), '.config/bb/preferences.json');
accessSync(path, constants.R_OK);
const cli = process.env.BB_CLI || 'bb';
execFileSync(cli, ['plugin', 'build', import.meta.dirname], { stdio: 'inherit' });
execFileSync(cli, ['plugin', 'install', `path:${import.meta.dirname}`, '--yes'], { stdio: 'inherit' });
execFileSync(cli, ['preferences', 'apply'], { stdio: 'inherit' });
