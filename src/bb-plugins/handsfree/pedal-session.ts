export interface Recording {
  finish(): Promise<{ transcript: string; durationMs: number }>;
  cancel(): Promise<void>;
}

export function makePedalSession(ports: {
  start(): Promise<Recording>;
  heard(text: string): Promise<void>;
  feedback(message: string, problem?: boolean): void;
}, maximumMs = 60000) {
  let active: { admission: Promise<Recording>; terminal?: Promise<void>; cancelled?: boolean; timer: ReturnType<typeof setTimeout> } | undefined;
  let executing = false;
  const end = (cancel: boolean): Promise<void> => {
    if (!active) return Promise.resolve();
    if (active.terminal) return active.terminal;
    const current = active;
    clearTimeout(current.timer);
    current.terminal = (async () => {
      const handle = await current.admission;
      if (cancel) { await handle.cancel(); ports.feedback('Command recording cancelled.'); return; }
      ports.feedback('Transcribing command…');
      let result;
      try { result = await handle.finish(); }
      catch (error) { await handle.cancel(); throw error; }
      if (active === current) active = undefined;
      executing = true;
      try {
        const text = result.transcript.trim();
        if (current.cancelled) return;
        if (text) await ports.heard(text);
        else ports.feedback('No speech heard. Check the microphone selected in Hex.', true);
      } finally { executing = false; }
    })().catch(error => {
      ports.feedback(error instanceof Error ? error.message : String(error), true);
    }).finally(() => { if (active === current) active = undefined; });
    return current.terminal;
  };
  return {
    start() {
      if (active || executing) return;
      ports.feedback('Recording command. Release the left pedal to finish.');
      const admission = Promise.resolve().then(() => ports.start());
      const current = { admission, timer: setTimeout(() => { void end(true); }, maximumMs) };
      active = current;
      void admission.catch(error => {
        if (active !== current) return;
        clearTimeout(current.timer);
        active = undefined;
        ports.feedback(error instanceof Error ? error.message : String(error), true);
      });
    },
    finish: () => end(false),
    cancel: () => { if (active) active.cancelled = true; return end(true); },
    busy: () => Boolean(active) || executing,
  };
}
