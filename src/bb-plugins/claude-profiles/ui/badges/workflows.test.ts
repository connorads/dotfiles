// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { mountWorkflowAccounts, setWorkflowLoader } from './workflows.ts';
import { setBadges } from './store.ts';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); setWorkflowLoader(null); setBadges([]); document.body.replaceChildren(); });
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
