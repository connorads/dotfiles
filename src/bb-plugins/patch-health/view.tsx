import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { experimental_Icon as Icon } from '@get-bb/plugin-sdk/app';
import type { Patch, Snapshot } from './model';

const descriptions = {
  activity: { name: 'Workflow activity', detail: 'Active workflows in your sidebar' },
  'session-options': { name: 'Session options', detail: 'Model settings passed to workflow workers' },
};
function status(patch: Patch) {
  return patch.files === 'absent' ? 'Missing' : patch.files === 'present' ? 'Files present' : 'Cannot verify';
}
function explanation(patch: Patch) {
  if (patch.files === 'absent') return 'The inspected desktop installation does not contain this patch. A separate server package can have different patches.';
  if (patch.files === 'present') return 'The complete desktop file set matches an approved patch profile. Live behaviour has not been checked.';
  return 'The complete desktop file set is not recognised as an approved profile. Individual matching files cannot verify this patch.';
}
function summary(snapshot: Snapshot | null, loading: boolean, error: string | null) {
  if (error) return error;
  if (loading) return 'Inspecting desktop files…';
  if (!snapshot || snapshot.kind === 'unavailable') return 'Could not inspect desktop files';
  const missing = snapshot.patches.filter(patch => patch.files === 'absent').length;
  if (missing) return `${missing} ${missing === 1 ? 'patch' : 'patches'} missing from desktop`;
  return snapshot.patches.some(patch => patch.files === 'unverified') ? 'Desktop files need review' : 'Files present. Live checks pending.';
}

export function PatchView({ snapshot, hostId, loading, error, onRefresh, onClose }: {
  snapshot: Snapshot | null; hostId: string | null; loading: boolean; error: string | null; onRefresh: () => void; onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const prefix = useId();
  const available = !loading && !error && snapshot?.kind === 'available' ? snapshot : null;
  const patches = available?.patches.slice().sort((a, b) => Number(a.files === 'present') - Number(b.files === 'present')) ?? [];
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const rows = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[data-patch-row]') ?? []);
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0 || !rows.length) return;
    event.preventDefault();
    rows[(index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus();
  }
  return <div className="ph-content" ref={root} onKeyDown={keyboard}>
    <header className="ph-head">
      <div className="ph-title"><Icon name="patch-health/package" /><h2>Patches</h2><span className="ph-spacer" />
        <span className="ph-target">Desktop{available ? ` · ${available.version}` : ''}</span>
        <button type="button" className="ph-icon-button" aria-label="Refresh patch status" title="Refresh" disabled={loading} onClick={onRefresh}><Icon name="patch-health/refresh" /></button>
        <button type="button" className="ph-icon-button" aria-label="Close patches" title="Close" onClick={onClose}><Icon name="patch-health/close" /></button>
      </div>
      <p className="ph-summary" role="status"><span className="ph-dot" />{summary(snapshot, loading, error)}</p>
    </header>
    <div className="ph-body" aria-busy={loading}>
      {patches.length > 0 && <ul className="ph-list">{patches.map(patch => {
        const text = descriptions[patch.id];
        const open = expanded === patch.id;
        const id = `${prefix}-${patch.id}`;
        return <li key={patch.id}>
          <button type="button" className="ph-row" data-patch-row aria-expanded={open} aria-controls={id} onClick={() => setExpanded(open ? null : patch.id)}>
            <Icon name={patch.files === 'present' ? 'patch-health/clock' : 'patch-health/help'} className={patch.files === 'absent' ? 'ph-warn' : 'ph-muted'} />
            <span className="ph-copy"><span className="ph-name">{text.name}</span><span className="ph-description">{text.detail}</span></span>
            <span className={`ph-status ${patch.files === 'absent' ? 'ph-warn' : 'ph-muted'}`}>{status(patch)}</span>
            <Icon name="patch-health/chevron" className="ph-chevron" />
          </button>
          {open && <div className="ph-explanation" id={id} role="region" aria-label={`${text.name} evidence`}>
            <p>{explanation(patch)}</p>
            <p>{patch.files === 'unverified' ? 'Inspect the installation and patch registry before preparing changes.' : patch.files === 'absent' ? 'Review the desktop patch recipe before preparing an update.' : 'Run a separate acceptance check to verify the feature on the connected server.'}</p>
            <details><summary>Technical details</summary><dl><dt>File evidence</dt><dd>{status(patch)}</dd><dt>Live behaviour</dt><dd>Not checked</dd><dt>Loaded code identity</dt><dd>Unavailable</dd><dt>Source</dt><dd>Complete file tuple from the patch manager</dd></dl></details>
          </div>}
        </li>;
      })}</ul>}
      {!loading && !error && snapshot?.kind === 'unavailable' && <p className="ph-error" role="alert">{snapshot.reason}</p>}
      {error && <p className="ph-error" role="alert">Refresh when the connection is available. Previous results are not shown as current.</p>}
      {available && <details className="ph-installation"><summary><Icon name="patch-health/chevron" />Installation details</summary><div>
        <dl><dt>Inspected installation</dt><dd>{available.app}</dd><dt>Inspection host</dt><dd>{hostId ?? 'Unavailable'}</dd><dt>File classification</dt><dd>{available.classification}</dd><dt>Observed</dt><dd><time dateTime={available.observedAt}>{new Date(available.observedAt).toLocaleString()}</time></dd><dt>Loaded code identity</dt><dd>Unavailable</dd>{available.pendingState && <><dt>Patch transaction</dt><dd>{available.pendingState}</dd></>}</dl>
        <p>This inspects desktop files on the server host. It does not identify the code loaded by the connected server or inspect prepared server packages.</p>
      </div></details>}
    </div>
    <footer className="ph-footer"><span>Read-only inspection</span><span className="ph-spacer" /><kbd>↑</kbd><kbd>↓</kbd><span>move</span><kbd>↵</kbd><span>details</span></footer>
  </div>;
}
