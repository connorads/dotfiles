import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(fileURLToPath(import.meta.url));
const home = homedir();
const label = 'local.bb.command-pedal';
const domain = `gui/${userInfo().uid}`;
const plist = join(home, 'Library/LaunchAgents', `${label}.plist`);
function run(executable: string, args: string[]) {
  const result = spawnSync(executable, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw result.error ?? Error(`${executable} failed (${result.status})`);
}
const mode = process.argv[2];
if (mode === 'stop') { run('/bin/launchctl', ['bootout', `${domain}/${label}`]); process.exit(0); }
if (mode === 'status') {
  const result = spawnSync('/bin/launchctl', ['print', `${domain}/${label}`], { encoding: 'utf8' });
  if (result.status !== 0) { console.log('Command pedal is not installed or is stopped.'); process.exit(1); }
  const details = result.stdout.split('\n').filter(line => /^\t(state|pid|last exit code) =/.test(line));
  console.log(details.map(line => line.trim()).join('\n'));
  process.exit(0);
}
if (mode === 'restart') { run('/bin/launchctl', ['kickstart', '-k', `${domain}/${label}`]); process.exit(0); }
if (mode !== 'install') throw Error('Use install, stop, status or restart.');
const path = process.env.PATH;
if (!path) throw Error('PATH is required to install the command recorder.');
const xml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const app = join(home, 'Applications/Hex Command Keys.app/Contents');
await mkdir(join(app, 'MacOS'), { recursive: true });
const binary = join(root, 'keys-built');
const cache = join(home, '.cache/hex-command-pedal/swift');
await mkdir(cache, { recursive: true });
run('/usr/bin/swiftc', ['-module-cache-path', cache, join(root, 'keys.swift'), '-o', binary]);
await copyFile(binary, join(app, 'MacOS/right-control'));
await writeFile(join(app, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.hex-command-test.keys</string><key>CFBundleName</key><string>Hex Command Keys</string><key>CFBundleExecutable</key><string>right-control</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/><key>CommandPedalBun</key><string>${xml(process.execPath)}</string><key>CommandPedalService</key><string>${xml(join(root, 'service.ts'))}</string></dict></plist>`);
run('/usr/bin/codesign', ['--force', '--sign', '-', '--options', 'runtime', dirname(app)]);
const logs = join(home, '.local/state/hex');
await mkdir(logs, { recursive: true });
await mkdir(dirname(plist), { recursive: true });
await writeFile(plist, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(join(app, 'MacOS/right-control'))}</string></array><key>WorkingDirectory</key><string>${xml(dirname(root))}</string><key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string><key>HOME</key><string>${xml(home)}</string><key>USER</key><string>${xml(userInfo().username)}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer><key>StandardOutPath</key><string>${xml(join(logs, 'pedal.log'))}</string><key>StandardErrorPath</key><string>${xml(join(logs, 'pedal-error.log'))}</string></dict></plist>`);
spawnSync('/bin/launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' });
run('/bin/launchctl', ['bootstrap', domain, plist]);
console.log('Installed command pedal. Focus BB and hold F18. Use pedal:status, pedal:restart or pedal:stop.');
