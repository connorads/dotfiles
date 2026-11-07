import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { experimental_copyToClipboard, experimental_Icon as Icon } from '@get-bb/plugin-sdk/app';
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

function NextStep({ snapshot }: { snapshot: Snapshot }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const instruction = snapshot.kind === 'unavailable'
    ? { title: 'Restore inspection', text: 'Check that the patch manager and desktop installation are available on the inspection host. Then use Refresh.' }
    : snapshot.pendingState
      ? { title: 'Review the patch transaction', text: `The manager reports ${snapshot.pendingState}. Inspect its journal before preparing another change. Restarting cannot resolve an incomplete file transaction.` }
      : snapshot.patches.some(patch => patch.files === 'unverified')
        ? { title: 'Inspect the unrecognised files', text: 'Compare the complete installation with the patch registry. Do not reinstall over unknown files or restart to test a mixed installation.' }
        : snapshot.patches.some(patch => patch.files === 'absent')
          ? { title: 'Check the server setup', text: 'Restarting BB will not install missing patch files. Check the connected server and its deployment before choosing a compatible patch route.' }
          : { title: 'Verify the running feature', text: 'Activation is unknown. Check which server is connected and run the feature acceptance check before deciding whether BB needs restarting.' };
  const request = [
    'Investigate my BB patch setup and give me the next concrete action.',
    `Desktop observation: ${JSON.stringify(snapshot)}`,
    'Run bb-deploy status and identify the connected server executable. Inspect candidate provenance and verification evidence.',
    'Check recipe support for the exact target and release. Desktop missing files alone do not prove the connected server needs repair.',
    'Explain whether installation, server activation, desktop reopening or no change is required. Run relevant acceptance checks where possible.',
    'Do not apply patches, activate a server or restart BB during diagnosis. Prepare a concrete handover plan if needed.',
  ].join('\n');
  async function copy() {
    try { setCopyState(await experimental_copyToClipboard({ text: request }) ? 'copied' : 'failed'); }
    catch { setCopyState('failed'); }
  }
  return <section className="ph-next" aria-label="Next step">
    <span className="ph-next-label">Next step</span><h3>{instruction.title}</h3><p>{instruction.text}</p>
    {snapshot.kind === 'available' && <details><summary>Installation and restart guidance</summary>
      <p>Check deployment with <code>bb-deploy status</code>. A prepared candidate is not an active server.</p>
      <p>The desktop patch manager writes disposable copies only. It cannot reinstall patches into the live desktop app.</p>
      <p>After a verified installation, Workflow activity needs server activation. Session options also needs desktop view activation.</p>
      <p>Schedule activation when BB is idle, then test the feature. A machine reboot is not part of this patch procedure.</p>
    </details>}
    <div className="ph-next-actions"><button type="button" onClick={() => { void copy(); }}>Copy diagnostic request</button>
      <span role="status">{copyState === 'copied' ? 'Copied. Paste into a BB chat.' : copyState === 'failed' ? 'Copy failed. Check server setup with bb-deploy status.' : 'No machine reboot needed.'}</span>
    </div>
  </section>;
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
            <details><summary>Technical details</summary><dl><dt>File evidence</dt><dd>{status(patch)}</dd><dt>Live behaviour</dt><dd>Not checked</dd><dt>Loaded code identity</dt><dd>Unavailable</dd><dt>Source</dt><dd>Complete file tuple from the patch manager</dd></dl></details>
          </div>}
        </li>;
      })}</ul>}
      {!loading && !error && snapshot?.kind === 'unavailable' && <p className="ph-error" role="alert">{snapshot.reason}</p>}
      {error && <p className="ph-error" role="alert">Refresh when the connection is available. Previous results are not shown as current.</p>}
      {!loading && !error && snapshot && <NextStep key={snapshot.observedAt} snapshot={snapshot} />}
      {available && <details className="ph-installation"><summary><Icon name="patch-health/chevron" />Installation details</summary><div>
        <dl><dt>Inspected installation</dt><dd>{available.app}</dd><dt>Inspection host</dt><dd>{hostId ?? 'Unavailable'}</dd><dt>File classification</dt><dd>{available.classification}</dd><dt>Observed</dt><dd><time dateTime={available.observedAt}>{new Date(available.observedAt).toLocaleString()}</time></dd><dt>Loaded code identity</dt><dd>Unavailable</dd>{available.pendingState && <><dt>Patch transaction</dt><dd>{available.pendingState}</dd></>}</dl>
        <p>This inspects desktop files on the server host. It does not identify the code loaded by the connected server or inspect prepared server packages.</p>
      </div></details>}
    </div>
    <footer className="ph-footer"><span>Read-only inspection</span><span className="ph-spacer" /><kbd>↑</kbd><kbd>↓</kbd><span>move</span><kbd>↵</kbd><span>details</span></footer>
  </div>;
}
