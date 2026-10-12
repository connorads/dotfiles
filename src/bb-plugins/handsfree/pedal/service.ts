import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { connect } from '@kitlangton/hex';
import { makePedalSession } from '../pedal-session.ts';
import { requestBb, type BbPorts } from '../../../../.config/hex/voice/bb.ts';
import { runSpeech } from '../../../../.config/hex/voice/speech.ts';
import { serialisePedalRequests } from '../pedal-requests.ts';
import { systemPorts } from '../../../../.config/hex/voice/system.ts';

const request = serialisePedalRequests(requestBb);
const ports: BbPorts = { ...systemPorts, request };
const feedback = (message: string, problem = false) => {
  console.log(JSON.stringify({ at: new Date().toISOString(), message, problem }));
  void request({ action: 'notice', message, problem }).then(reply => {
    if (!reply.ok) console.error(reply.message);
  }).catch(error => console.error(String(error)));
};
let recordedContext: string | undefined;
const session = makePedalSession({
  start: async () => {
    const context = await request({ action: 'list', kind: 'thread' });
    if (!context.ok || !context.context) throw Error(context.message || 'Focus BB before recording a command.');
    recordedContext = context.context;
    return (await connect()).dictation.start({ source: 'bb-command-pedal' });
  },
  feedback,
  heard: async text => {
    const context = await request({ action: 'list', kind: 'thread' });
    if (!context.ok || context.context !== recordedContext) { feedback('BB context changed. Record the command again.', true); return; }
    const reply = await runSpeech(ports, text);
    if (reply.ok && reply.press) {
      const modifiers = reply.press.modifiers.map(modifier => `${modifier === 'option' ? 'option' : modifier} down`).join(', ');
      const codes: Record<string, number> = { escape: 53, enter: 36, arrowup: 126, arrowdown: 125, arrowleft: 123, arrowright: 124, home: 115, end: 119, pageup: 116, pagedown: 121, tab: 48 };
      const code = codes[reply.press.key];
      const stroke = code === undefined ? 'keystroke (item 1 of argv)' : `key code ${code}`;
      const child = Bun.spawn(['/usr/bin/osascript', '-e', 'on run argv', '-e', 'tell application "System Events"', '-e', 'if bundle identifier of first application process whose frontmost is true is not "dev.bb.desktop" then error "BB lost focus"', '-e', `${stroke} using {${modifiers}}`, '-e', 'end tell', '-e', 'end run', reply.press.key], { stdout: 'ignore', stderr: 'pipe', timeout: 5000 });
      if (await child.exited !== 0) feedback('Keyboard action failed. Check System Events Accessibility permission.', true);
    }
  },
});
const keys = spawn(join(homedir(), 'Applications/Hex Command Keys.app/Contents/MacOS/right-control'), [], { stdio: ['pipe', 'pipe', 'inherit'] });
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  keys.kill();
  await session.cancel();
  process.exit(0);
};
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
const lines = createInterface({ input: keys.stdout });
lines.on('line', event => {
  if (event === 'start') session.start();
  else if (event === 'finish') void session.finish();
  else if (event === 'cancel') void session.cancel();
  else if (event === 'ready') console.log('F18 command pedal ready. Focus BB, hold the left pedal, speak, release.');
});
keys.on('error', error => { console.error(error.message); void shutdown(); });
keys.on('close', code => {
  if (!shuttingDown) {
    console.error(`Keyboard listener stopped (${code}).`);
    void session.cancel().finally(() => process.exit(code || 1));
  }
});
