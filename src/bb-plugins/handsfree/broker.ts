import { randomUUID } from 'node:crypto';
import type { Command, Reply } from './contracts.ts';

export function makeBroker(publish: (request: { requestId: string; command: Command }) => void, timeoutMs = 20000, claimTimeoutMs = 1500) {
  const pending = new Map<string, {
    claimed: boolean;
    timer: ReturnType<typeof setTimeout>;
    claimTimer: ReturnType<typeof setTimeout>;
    finish: (reply: Reply) => void;
  }>();
  let disposed = false;
  const complete = (id: string, reply: Reply) => {
    const request = pending.get(id);
    if (!request) return false;
    clearTimeout(request.timer);
    clearTimeout(request.claimTimer);
    pending.delete(id);
    request.finish({ ...reply, requestId: id });
    return true;
  };
  return {
    dispatch(command: Command): Promise<Reply> {
      if (disposed) return Promise.resolve({ ok: false, message: 'Voice plugin is reloading. Try again.' });
      return new Promise(resolve => {
        const requestId = randomUUID();
        const timer = setTimeout(() => complete(requestId, {
          ok: false, message: 'No reply from the focused BB window. Open BB and try again.',
        }), timeoutMs);
        const claimTimer = setTimeout(() => complete(requestId, {
          ok: false, message: 'No focused BB window. Open BB and try again.',
        }), claimTimeoutMs);
        pending.set(requestId, { claimed: false, timer, claimTimer, finish: resolve });
        try { publish({ requestId, command }); }
        catch { complete(requestId, { ok: false, message: 'Could not reach BB. Try again.' }); }
      });
    },
    claim(id: string) {
      const request = pending.get(id);
      if (!request || request.claimed) return false;
      request.claimed = true;
      clearTimeout(request.claimTimer);
      return true;
    },
    complete(id: string, reply: Reply) {
      if (!pending.get(id)?.claimed) return false;
      return complete(id, reply);
    },
    dispose() {
      disposed = true;
      for (const id of pending.keys()) complete(id, { ok: false, message: 'Voice plugin is reloading. Try again.' });
    },
  };
}
