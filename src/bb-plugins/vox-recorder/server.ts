import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { hostContract, hostSignals, rpcContract } from './contracts.ts';
import { isWindow, mentionContext, parseMentionId } from './src/grab.ts';
import { isRecordingName, search, titleOf, when, type Recording } from './src/library.ts';
import { installIngestion } from './src/ingestion-service.ts';

const grabTimeoutMs = 10 * 60_000 + 10_000;
const describe = (r: Recording) => `${r.name}  (${when(r.name)}, ${r.kind}) ${r.title}`;
const toolInput = z.object({
  source: z.enum(['live', 'latest', 'list', 'recording']),
  window: z.string().refine(isWindow, 'A count with an optional s, m or h unit, e.g. 5m.').optional(),
  query: z.string().optional(),
  name: z.string().optional(),
});

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract, experimental_signals: hostSignals });
  // vox records on the machine running BB, which is the primary host.
  let primary: Promise<string> | null = null;
  const hostId = () => primary ??= bb.sdk.system.config().then(config => {
    if (!config.primaryHostId) throw new Error('BB has no primary host to record on.');
    if (config.primaryHostPlatform !== 'darwin') throw new Error('vox records with Core Audio, so it needs a macOS host.');
    return config.primaryHostId;
  }).catch(error => { primary = null; throw error; });
  const call = async <M extends Extract<keyof typeof hostContract, string>>(method: M, input: Parameters<typeof host.call<M>>[1], timeoutMs = 25_000) =>
    host.call(method, input, { hostId: await hostId(), timeoutMs });

  let subscribed = false;
  const subscribe = async () => { const status = await call('subscribe', {}); subscribed = true; return status; };
  host.experimental_onSignal('status', ({ payload }) => bb.realtime.publish('status', payload));
  host.experimental_onSignal('finished', ({ payload }) => bb.realtime.publish('finished', payload));
  installIngestion(bb, {
    hostId, subscribe,
    completed: () => call('completed', {}),
    transcript: name => call('transcript', { name }),
    onChange: listener => { host.experimental_onSignal('transcriptsChanged', () => listener()); },
  });
  // A crashed worker takes its watches with it.
  host.experimental_onWorkerExit(() => {
    if (subscribed) subscribe().then(status => bb.realtime.publish('status', status), error => bb.log.warn(`vox: re-subscribing failed: ${error}`));
  });

  bb.rpc.register(rpcContract, {
    status: () => subscribe(),
    list: () => call('list', {}),
    preview: input => call('preview', input),
    transcript: input => call('transcript', input),
    markSeen: () => call('markSeen', {}),
    start: () => call('start', {}),
    stop: () => call('stop', {}),
    cancel: () => call('cancel', {}),
    rename: input => call('rename', input),
    transcribe: input => call('transcribe', input),
    remove: input => call('remove', input),
    reclaim: input => call('reclaim', input, 130_000),
    reveal: input => call('reveal', input),
    grab: input => call('grab', input, grabTimeoutMs),
    location: async ({ name }) => ({ hostId: await hostId(), path: (await call('transcriptPath', { name })).path }),
  });

  async function resolveTarget(itemId: string) {
    const target = parseMentionId(itemId, isRecordingName);
    if (!target) throw new Error(`Unknown vox item ${itemId}.`);
    if (target.kind === 'grab') {
      const { path, text } = await call('readGrab', { id: target.id });
      return mentionContext('Live call transcript grabbed from vox while the call was still running (an auto-transcribed draft; Me = the user, Them = the other side)', path, text);
    }
    const { path, text } = await call('transcript', { name: target.name });
    return mentionContext(`Transcript of the vox recording "${titleOf(target.name)}" from ${when(target.name)}`, path, text);
  }

  // `@` a recording to hand its transcript to the agent. The pill shows the title;
  // the transcript travels as agent-only context, resolved at send time.
  bb.ui.registerMentionProvider({
    id: 'vox', label: 'Vox recordings',
    search: async ({ query }) => search(await call('list', {}, 1_800), query, 12).map(r => ({
      id: `rec:${r.name}`, title: r.title === 'untitled' ? `Recording ${when(r.name)}` : r.title,
      subtitle: `${when(r.name)} · ${r.kind}`, icon: 'Mic',
    })),
    resolve: async itemId => ({ context: await resolveTarget(itemId) }),
  });

  bb.agents.registerTool({
    name: 'vox_transcript',
    description: 'Read transcripts from vox, the user\'s local meeting and monologue recorder. '
      + 'source "live" transcribes the call being recorded right now (optionally only its last `window`, e.g. "5m"); '
      + '"latest" returns the newest finished transcript; "list" lists recordings matching `query`; '
      + '"recording" returns the transcript of the recording `name` from that list.',
    // The JSON-schema overload: SDK 0.6.15 types its zod overload against zod 4.6,
    // and a plugin's own zod 4.3 schema does not satisfy it. Validated below instead.
    parameters: z.toJSONSchema(toolInput) as Record<string, unknown>,
    presentation: { label: { pending: 'Reading vox transcript', completed: 'Read vox transcript' }, icon: { glyph: 'Mic' } },
    execute: async params => {
      const { source, window, query, name } = toolInput.parse(params);
      if (source === 'live') {
        const grab = await call('grab', { window: window ?? null }, grabTimeoutMs);
        return grab.ok ? resolveTarget(`grab:${grab.id}`) : { content: [{ type: 'text', text: grab.reason }], isError: true };
      }
      const recordings = await call('list', {});
      if (source === 'list') {
        const found = search(recordings, query ?? '', 40);
        return found.length ? found.map(describe).join('\n') : 'No finished transcripts match.';
      }
      const target = source === 'latest' ? search(recordings, '', 1)[0]?.name : name;
      if (!target) return { content: [{ type: 'text', text: source === 'latest' ? 'No finished transcripts yet.' : 'Pass `name` from source "list".' }], isError: true };
      if (!isRecordingName(target)) return { content: [{ type: 'text', text: `${target} is not a vox recording name.` }], isError: true };
      return resolveTarget(`rec:${target}`);
    },
  });
  bb.agents.configure(context => ({ tools: context.pluginMetadata.revisionKey
    ? ['vox_transcript', 'vox_ingestion_complete'] : ['vox_transcript'], skills: [] }));
}
