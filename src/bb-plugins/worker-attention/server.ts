import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { decide } from './src/decide.ts';

export default function plugin(bb: BbPluginApi) {
  // interaction.pending fires once per committed row; the set guards against replays after a reload.
  const alerted = new Set<string>();

  bb.events.on('interaction.pending', async ({ thread, interaction }) => {
    const alert = decide(thread, interaction);
    if (!alert || alerted.has(alert.interactionId)) return;
    alerted.add(alert.interactionId);

    const results = await Promise.allSettled([
      // Explicit sends ignore thread visibility, unlike BB's automatic notifications.
      bb.sdk.plugins.callRpc({
        pluginId: 'push-notifications',
        method: 'notifications.send',
        input: { title: alert.pushTitle, body: alert.pushBody, threadId: alert.workerThreadId },
        outputSchema: z.unknown(),
      }),
      bb.sdk.threads.send({
        threadId: alert.ownerThreadId,
        mode: 'auto',
        input: [{ type: 'text', text: alert.ownerMessage, mentions: [] }],
      }),
    ]);
    for (const r of results) {
      if (r.status === 'rejected') bb.log.warn(`worker-attention: ${String(r.reason)}`);
    }
  });
}
