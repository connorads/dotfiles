import { open } from 'node:fs/promises';
import { z } from 'zod';
import { type Diagnostics, unavailableDiagnostics } from './diagnostics-contract.ts';
const at = z.number().int().nonnegative();
const failed = z.object({ failed: z.string() });
const eventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session_started'), timestamp_ms: at }),
  z.object({ kind: z.literal('state'), timestamp_ms: at, state: z.enum(['sleeping', 'listening', 'dictating', 'transcribing', 'stopping']) }),
  z.object({ kind: z.literal('transcript'), timestamp_ms: at, phase: z.enum(['started', 'updated', 'completed']), latency_ms: z.number(), text: z.string() }),
  z.object({ kind: z.literal('command'), timestamp_ms: at, heard: z.string(), command: z.string().nullable(),
    outcome: z.union([z.enum(['ignored', 'woke', 'slept', 'submitted', 'executed']), failed]), context: z.string().default('') }),
  z.object({ kind: z.literal('dictation'), timestamp_ms: at, text: z.string().default(''),
    phase: z.union([z.enum(['started', 'discarded', 'cancelled', 'transcribing', 'pasted', 'edited', 'voice_action', 'logged', 'repasted', 'meeting_pasted']), failed]) }),
]);
const commandLabels = { ignored: 'Unmatched speech', woke: 'Commands enabled', slept: 'Commands sleeping', submitted: 'Submitted', executed: 'Handler returned' };
const dictationLabels = { started: 'Recording', discarded: 'Discarded', cancelled: 'Cancelled', transcribing: 'Transcribing', pasted: 'Pasted', edited: 'Edited', voice_action: 'Voice action dispatched', logged: 'Logged', repasted: 'Pasted again', meeting_pasted: 'Meeting pasted' };

function parseTail(text: string): Diagnostics {
  const snapshot: Diagnostics = { available: true, state: null, transcript: null, attempts: [] };
  // A final partial record waits for the writer's newline on the next read.
  for (const line of text.split('\n').slice(0, -1)) {
    let value: unknown;
    try { value = JSON.parse(line); } catch { continue; }
    const parsed = eventSchema.safeParse(value);
    if (!parsed.success) continue;
    const event = parsed.data;
    if (event.kind === 'session_started') { snapshot.state = null; snapshot.transcript = null; }
    else if (event.kind === 'state') snapshot.state = { at: event.timestamp_ms, state: event.state };
    else if (event.kind === 'transcript') snapshot.transcript = { at: event.timestamp_ms, phase: event.phase, latency: event.latency_ms, text: event.text };
    else {
      const outcome = event.kind === 'command' ? event.outcome : event.phase;
      const problem = typeof outcome !== 'string';
      const result = typeof outcome !== 'string' ? outcome.failed
        : event.kind === 'command' && typeof event.outcome === 'string' ? commandLabels[event.outcome]
        : event.kind === 'dictation' && typeof event.phase === 'string' ? dictationLabels[event.phase] : '';
      snapshot.attempts.push({ at: event.timestamp_ms, kind: event.kind, heard: event.kind === 'command' ? event.heard : event.text,
        command: event.kind === 'command' ? event.command : null, result, problem,
        unmatched: event.kind === 'command' && event.outcome === 'ignored', context: event.kind === 'command' ? event.context : '' });
    }
  }
  snapshot.attempts = snapshot.attempts.slice(-50);
  return snapshot;
}

// Read a bounded tail on the BB server. Hex remains the sole owner of audio.
export function makeDiagnostics(path: string) {
  let cached: { key: string; snapshot: Diagnostics } | null = null;
  return async (): Promise<Diagnostics> => {
    let file;
    try {
      file = await open(path, 'r');
      const stat = await file.stat();
      const key = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      if (cached?.key === key) return cached.snapshot;
      const offset = Math.max(0, stat.size - 256 * 1024);
      const buffer = Buffer.alloc(Math.min(stat.size, 256 * 1024));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
      let text = buffer.subarray(0, bytesRead).toString('utf8');
      if (offset) text = text.slice(text.indexOf('\n') + 1);
      const snapshot = parseTail(text);
      cached = { key, snapshot };
      return snapshot;
    } catch {
      cached = null;
      return unavailableDiagnostics;
    } finally { await file?.close(); }
  };
}
