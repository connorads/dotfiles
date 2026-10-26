// BB creates its xterm.js terminals with fixed options and keeps them in a
// React ref. Nothing exposes the instance, so it is read from the React fiber
// of the element the terminal opened into.

interface Disposable { dispose(): void }

/** The slice of the xterm.js Terminal API this plugin uses. */
export interface XTerm {
  readonly element: HTMLElement | undefined;
  options: { macOptionIsMeta?: boolean; cursorBlink?: boolean; vtExtensions?: Record<string, unknown> };
  readonly parser: { registerOscHandler(ident: number, handler: (data: string) => boolean): Disposable };
}

interface Hook { memoizedState: unknown; next: Hook | null }
interface Fiber { memoizedState: unknown; return: Fiber | null }

const MAX_FIBER_DEPTH = 40;

const isHook = (value: unknown): value is Hook =>
  typeof value === 'object' && value !== null && 'memoizedState' in value && 'next' in value;

/** Finds the Terminal whose `element` is `xtermElement` in a ref held by an ancestor component. */
export function findTerminal(xtermElement: HTMLElement): XTerm | null {
  const host = xtermElement.parentElement;
  if (!host) return null;
  const key = Object.keys(host).find(k => k.startsWith('__reactFiber$'));
  let fiber = key ? (host as unknown as Record<string, Fiber>)[key] : null;
  for (let depth = 0; fiber && depth < MAX_FIBER_DEPTH; fiber = fiber.return, depth++) {
    for (let hook = fiber.memoizedState; isHook(hook); hook = hook.next) {
      const current = (hook.memoizedState as { current?: Partial<XTerm> } | null)?.current;
      if (current?.element === xtermElement) return current as XTerm;
    }
  }
  return null;
}

/**
 * Decodes an OSC 52 clipboard write (`<selection>;<base64>`).
 * Returns null for clipboard reads (`?`), which would leak the clipboard to the program.
 */
export function parseOsc52(data: string): string | null {
  const split = data.indexOf(';');
  if (split < 0) return null;
  const payload = data.slice(split + 1);
  if (payload === '?') return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(payload), c => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** Applies Kitty-like behaviour to one terminal. The disposer restores BB's options. */
export function tweak(term: XTerm, writeClipboard: (text: string) => void): () => void {
  const original = { ...term.options };
  term.options.macOptionIsMeta = true;
  term.options.cursorBlink = false;
  term.options.vtExtensions = { ...original.vtExtensions, kittyKeyboard: true };

  const osc52 = term.parser.registerOscHandler(52, data => {
    const text = parseOsc52(data);
    if (text !== null) writeClipboard(text);
    return true;
  });

  return () => {
    osc52.dispose();
    term.options.macOptionIsMeta = original.macOptionIsMeta;
    term.options.cursorBlink = original.cursorBlink;
    term.options.vtExtensions = original.vtExtensions;
  };
}
