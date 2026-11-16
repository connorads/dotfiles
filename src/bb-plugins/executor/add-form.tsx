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
 * onLost: an add that failed after the form closed, worded for the chip and the next popover.
 */
export function AddForm({ initialUrl, count, onBusy, onAdded, onClose, onLost }: {
  initialUrl: string; count: number; onBusy: (busy: boolean) => void; onAdded: (id: string, name: string) => Promise<void>;
  onClose: () => void; onLost: (text: string) => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const urlInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const fallbackName = `Connection ${count + 1}`;
  // The add outlives a form closed mid-add, such as by Close or the dialog's own close on a repeated Escape.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => { open.current = false; };
  }, []);

  // A pasted URL is already filled in, so the next useful field is the name.
  useEffect(() => { (initialUrl ? nameInput : urlInput).current?.focus({ preventScroll: true }); }, [initialUrl]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !url.trim()) return;
    setBusy(true);
    onBusy(true);
    setProblem(null);
    const named = name.trim() || fallbackName;
    const fail = (reason: string) => open.current ? setProblem(reason) : onLost(`Could not add ${named}. ${reason}`);
    try {
      const result = await rpc().call('add', { name: named, url: url.trim() });
      if (!result.ok) { fail(result.message); return; }
      // After the form closed, the add switches nothing: the person left, and may have picked another connection since.
      if (open.current) await onAdded(result.id, named);
    } catch (cause) {
      fail(message(cause));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  // Inputs are read-only while the add runs: it sends the values from the submit, so later edits would be lost.
  return <form className="ex-add" aria-label="Add connection" onSubmit={event => void submit(event)}>
    <input ref={urlInput} className="ex-input" aria-label="Connection URL" placeholder="Paste MCP URL from Executor → Connect"
      readOnly={busy} value={url} onChange={event => { setUrl(event.target.value); setProblem(null); }} required />
    <div className="ex-add-row">
      <input ref={nameInput} className="ex-input" aria-label="Connection name" placeholder={fallbackName} maxLength={60}
        readOnly={busy} value={name} onChange={event => setName(event.target.value)} />
      {/* aria-disabled, not disabled: a disabled button drops keyboard focus to the page body. */}
      <button type="submit" className="ex-button ex-button-primary" aria-disabled={busy || !url.trim() || undefined}>{busy ? 'Adding…' : 'Add and sign in'}</button>
      {/* Escape and a click outside wait for the add, so this is the way out on touch, where there is no Escape key. */}
      {busy && <button type="button" className="ex-button" onClick={onClose}>Close</button>}
    </div>
    {problem && <p className="ex-error ex-add-error" role="alert">{problem}</p>}
  </form>;
}
