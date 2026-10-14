// The flows behind the commands and buttons. Each ends in a notice, as each
// tmux path ended in a display-message.
import type { PluginComposerApi } from '@get-bb/plugin-sdk';
import { afterStart, baseName, type Outcome } from './src/outcome.ts';
import { titleOf, when } from './src/library.ts';
import { askTitle, closeDialog, currentStatus, message, notify, dismiss, promptOpen, refresh, rpc } from './vox-store.ts';

/**
 * Start at once and ask for a title while the capture spins up; the answer
 * acts only once the start has returned (see afterStart).
 */
export async function startWithPrompt() {
  const started: Promise<Outcome> = rpc().call('start', {}).catch(cause => ({ ok: false as const, path: null, reason: message(cause) }));
  const asked = Date.now();
  const answer = await askTitle('start', null);
  const decision = afterStart(await started, answer === null ? { kind: 'escape', afterMs: Date.now() - asked } : { kind: 'enter', title: answer });
  try {
    switch (decision.kind) {
      case 'failed': notify('error', decision.reason); break;
      case 'keep': notify('info', `Recording ${decision.name}`); break;
      case 'discard': await rpc().call('cancel', {}); notify('info', `Discarded ${decision.name}`); break;
      case 'rename': {
        const renamed = await rpc().call('rename', { name: decision.name, title: decision.title });
        notify(renamed.ok ? 'info' : 'error', renamed.ok ? `Recording ${baseName(renamed.path)}` : renamed.reason);
      }
    }
  } catch (cause) { notify('error', message(cause)); }
  void refresh();
}

export async function stop() {
  try {
    const { dir } = await rpc().call('stop', {});
    notify('info', `Stopping ${baseName(dir)}, transcribing in the background…`);
  } catch (cause) { notify('error', message(cause)); }
  void refresh();
}

export async function toggleRecording() {
  // The prompt belongs to a start in flight; a second press must not stop or restart under it.
  if (promptOpen()) return;
  if (currentStatus()?.state === 'recording') await stop();
  else await startWithPrompt();
}

/** Name… on a live recording: Esc means no rename, never discard. */
export async function nameLive() {
  const dir = currentStatus()?.recording?.dir;
  if (!dir) return;
  const title = await askTitle('rename', baseName(dir));
  if (!title?.trim()) return;
  const renamed = await rpc().call('rename', { name: baseName(dir), title }).catch(cause => ({ ok: false as const, path: null, reason: message(cause) }));
  notify(renamed.ok ? 'info' : 'error', renamed.ok ? `Recording ${baseName(renamed.path)}` : renamed.reason);
}

export async function discardLive() {
  try { await rpc().call('cancel', {}); notify('info', 'Discarded the recording.'); } catch (cause) { notify('error', message(cause)); }
  void refresh();
}

/** Put a transcript pill in the composer: at the caret when on screen, else at the end. */
function insertMention(composer: PluginComposerApi, id: string, label: string) {
  const mention = { provider: 'vox', id, label };
  try { composer.insert(mention); } catch { composer.insert(mention, { at: 'end' }); }
  composer.focus();
}

/**
 * The headline: transcribe the live call so far (or its last `window`) and
 * attach it to the composer as a frozen snapshot the agent receives on send.
 */
export async function grabInto(composer: PluginComposerApi, window: string | null) {
  if (currentStatus()?.state !== 'recording') { notify('error', 'Not recording: grab needs a live call.'); return; }
  const pending = notify('info', `Transcribing ${window ? `the last ${window} of the call` : 'the call so far'}…`, 10 * 60_000);
  try {
    const grab = await rpc().call('grab', { window });
    if (!grab.ok) { notify('error', grab.reason); return; }
    insertMention(composer, `grab:${grab.id}`, grab.label);
    notify('success', `Attached ${grab.label.toLowerCase()}`);
  } catch (cause) { notify('error', message(cause)); }
  finally { dismiss(pending); }
}

export function insertRecording(composer: PluginComposerApi, name: string) {
  const title = titleOf(name);
  insertMention(composer, `rec:${name}`, title === 'untitled' ? `Recording ${when(name)}` : title);
  closeDialog();
}
