import { useEffect, useRef, useState, type FormEvent } from 'react';
import { message, rpc } from './store.ts';

/** True for pasted text that looks like an Executor MCP URL; the server does the real check. */
export function looksLikeMcpUrl(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return /^https?:$/.test(url.protocol) && url.pathname.endsWith('/mcp');
  } catch {
    return false;
  }
}

/**
 * Adds a connection from the popover. The URL comes first because it is the only
 * thing the person has to fetch; the name defaults to the next "Connection N".
 */
export function AddForm({ initialUrl, count, onBusy, onAdded }: {
  initialUrl: string; count: number; onBusy: (busy: boolean) => void; onAdded: (id: string, name: string) => Promise<void>;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const urlInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const fallbackName = `Connection ${count + 1}`;

  // A pasted URL is already filled in, so the next useful field is the name.
  useEffect(() => { (initialUrl ? nameInput : urlInput).current?.focus({ preventScroll: true }); }, [initialUrl]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !url.trim()) return;
    setBusy(true);
    onBusy(true);
    setProblem(null);
    const named = name.trim() || fallbackName;
    try {
      const result = await rpc().call('add', { name: named, url: url.trim() });
      if (!result.ok) { setProblem(result.message); return; }
      await onAdded(result.id, named);
    } catch (cause) {
      setProblem(message(cause));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  return <form className="ex-add" aria-label="Add connection" onSubmit={event => void submit(event)}>
    <input ref={urlInput} className="ex-input" aria-label="Connection URL" placeholder="Paste MCP URL from Executor → Connect"
      value={url} onChange={event => { setUrl(event.target.value); setProblem(null); }} required />
    <div className="ex-add-row">
      <input ref={nameInput} className="ex-input" aria-label="Connection name" placeholder={fallbackName} maxLength={60}
        value={name} onChange={event => setName(event.target.value)} />
      {/* aria-disabled, not disabled: a disabled button drops keyboard focus to the page body. */}
      <button type="submit" className="ex-button ex-button-primary" aria-disabled={busy || !url.trim() || undefined}>{busy ? 'Adding…' : 'Add and sign in'}</button>
    </div>
    {problem && <p className="ex-error ex-add-error" role="alert">{problem}</p>}
  </form>;
}
