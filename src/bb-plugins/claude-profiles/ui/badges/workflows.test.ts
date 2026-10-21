// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { mountWorkflowAccounts, setWorkflowLoader, setWorkflowPanelContext } from './workflows.ts';
import { setBadges } from './store.ts';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); setWorkflowPanelContext(null); setWorkflowLoader(null); setBadges([]); document.body.replaceChildren(); });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const preview = (runId: string) => `<div data-timeline-row-id="parent:assistant:1"><div data-bb-plugin="workflows"><section aria-label="Workflow" title='::workflow-preview{run="${runId}"}'><button><span title="Candidate A">Candidate A</span><span class="ml-auto"><span title="claude-code · opus">claude-code · opus</span></span></button></section></div></div>`;

test('joins each preview to its own worker account, follows switches and cleans up', async () => {
  document.body.innerHTML = preview('wfr_one') + preview('wfr_two');
  setWorkflowLoader(async (_threadId, runId) => [{ label: 'Candidate A', provider: 'claude-code', childThreadId: runId }]);
  setBadges([{ threadId: 'wfr_one', profileId: 'work', label: 'Work' }, { threadId: 'wfr_two', profileId: 'personal', label: 'Personal' }]);
  dispose = mountWorkflowAccounts(document);
  await settle();
  expect(Array.from(document.querySelectorAll('.cp-workflow-account'), el => el.textContent)).toEqual(['Work', 'Personal']);
  setBadges([{ threadId: 'wfr_one', profileId: 'personal', label: 'Personal' }]);
  expect(Array.from(document.querySelectorAll('.cp-workflow-account'), el => el.textContent)).toEqual(['Personal']);
  document.body.innerHTML = preview('wfr_one');
  await settle();
  expect(document.querySelector('.cp-workflow-account')?.textContent).toBe('Personal');
  dispose(); dispose = undefined;
  expect(document.querySelector('.cp-workflow-account')).toBeNull();
});

test('omits ambiguous labels, other providers and unavailable run data', async () => {
  document.body.innerHTML = preview('wfr_one') + preview('wfr_two') + preview('wfr_three');
  setBadges([{ threadId: 'worker', profileId: 'work', label: 'Work' }]);
  setWorkflowLoader(async (_threadId, runId) => {
    const call = { label: 'Candidate A', provider: 'claude-code', childThreadId: 'worker' };
    if (runId === 'wfr_one') return [call, call];
    if (runId === 'wfr_two') return [{ ...call, provider: 'codex' }];
    throw new Error('Unavailable');
  });
  dispose = mountWorkflowAccounts(document);
  await settle();
  expect(document.querySelector('.cp-workflow-account')).toBeNull();
});

const panel = (suffix: string) => `<div data-bb-plugin="workflows"><div data-detail-scroll-area="workflow-panel"><div><h2>Review</h2></div><div><span>2/2 agents</span><span class="ml-auto font-mono">${suffix}</span></div><button><span title="Candidate A">Candidate A</span><span class="ml-auto"><span>claude-code · opus</span></span></button></div></div>`;

test('labels the standalone panel, follows run changes and shares preview account styling', async () => {
  const resolved: string[] = [];
  setWorkflowPanelContext({ threadId: 'parent', resolve: async (suffix) => { resolved.push(suffix); return `wfr_${suffix}`; } });
  setWorkflowLoader(async (_threadId, runId) => [{ label: 'Candidate A', provider: 'claude-code', childThreadId: runId }]);
  setBadges([{ threadId: 'wfr_12345678', profileId: 'work', label: 'Work' }, { threadId: 'wfr_87654321', profileId: 'personal', label: 'Personal' }]);
  document.body.innerHTML = panel('12345678');
  dispose = mountWorkflowAccounts(document);
  await settle();
  expect(document.querySelector('.cp-workflow-account')?.textContent).toBe('Work');
  document.body.insertAdjacentHTML('beforeend', preview('wfr_12345678'));
  await settle();
  const badges = Array.from(document.querySelectorAll<HTMLElement>('.cp-workflow-account'));
  expect(badges).toHaveLength(2);
  expect(badges[0].style.color).toBe(badges[1].style.color);
  document.querySelector('[data-detail-scroll-area] > div > .font-mono')!.textContent = '87654321';
  await settle();
  expect(document.querySelector('.cp-workflow-account')?.textContent).toBe('Personal');
  expect(resolved).toEqual(['12345678', '87654321']);
  setWorkflowPanelContext(null);
  expect(document.querySelector('[data-detail-scroll-area] .cp-workflow-account')).toBeNull();
});

test('does not decorate a panel after disposal during run resolution', async () => {
  let finish: (id: string) => void = () => {};
  let signal: AbortSignal | undefined;
  setWorkflowPanelContext({ threadId: 'parent', resolve: (_suffix, pendingSignal) => {
    signal = pendingSignal;
    return new Promise<string>(resolve => { finish = resolve; });
  } });
  document.body.innerHTML = panel('12345678');
  dispose = mountWorkflowAccounts(document);
  dispose(); dispose = undefined;
  expect(signal?.aborted).toBe(true);
  finish('wfr_12345678');
  await settle();
  expect(document.querySelector('.cp-workflow-account')).toBeNull();
});
