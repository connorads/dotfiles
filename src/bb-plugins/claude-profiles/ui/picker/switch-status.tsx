export function SwitchStatus({ label, thread }: { label: string; thread: boolean }) {
  return <div className="mf-switch-status" role="status"><span className="mf-spinner" aria-hidden="true" />
    <span><strong>{thread ? 'Switching to' : 'Selecting'} {label}…</strong>
      {thread && <small>Keep this window open while your conversation transfers.</small>}</span></div>;
}
