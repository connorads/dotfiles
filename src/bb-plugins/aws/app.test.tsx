// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import type { PluginCommandRegistration } from '@get-bb/plugin-sdk/app';
import type { StateView, ThreadView } from './contracts.ts';

const app = await loadPluginApp(() => import('./app.tsx'));
// SAFETY: the collector includes commands at runtime but omits them from CapturedPluginApp's declared Pick.
const command = (app as unknown as { commandPaletteActions: PluginCommandRegistration[] }).commandPaletteActions
  .find(row => row.id === 'choose')!;

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
// The open thread is module state that outlives a render, so a test that fails while open must not leave it open.
afterEach(() => {
  if (document.querySelector('dialog[open]')) act(() => { void command.run({ threadId: 'close' } as never); });
  cleanup();
});

const state: StateView = {
  profiles: [
    { name: 'acme-dev', region: 'eu-west-1', status: 'ok' },
    { name: 'acme-prod/ReadOnly', region: null, status: 'sign-in' },
  ],
  error: null,
};

function handlers() {
  let thread: ThreadView = { choice: { profile: null, region: null }, region: null, lastFetch: null };
  return {
    rpc: {
      state: () => state,
      thread: () => thread,
      setChoice: (input: unknown) => {
        const { choice } = input as { choice: ThreadView['choice'] };
        thread = { ...thread, choice, region: choice.region ?? state.profiles.find(p => p.name === choice.profile)?.region ?? null };
        return null;
      },
      signIn: () => ({ ok: true }),
    },
    current: () => thread.choice,
  };
}

it('registers Alt+W in the palette', () => {
  expect(command.defaultShortcut).toMatchObject({ key: 'w', alt: true });
});

it('filters, then picks a profile with Enter', async () => {
  const h = handlers();
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: h.rpc });
  act(() => { void command.run({ threadId: 't1' } as never); });
  const dialog = await overlay.findByRole('dialog', { name: 'AWS profile' });
  await overlay.findByRole('option', { name: /acme-dev/ });
  fireEvent.change(overlay.getByLabelText('Filter profiles'), { target: { value: 'dev' } });
  expect(overlay.queryByRole('option', { name: /Off/ })).toBeNull();
  fireEvent.keyDown(overlay.getByLabelText('Filter profiles'), { key: 'Enter' });
  await waitFor(() => expect(h.current()).toEqual({ profile: 'acme-dev', region: null }));
  await waitFor(() => expect(dialog.isConnected).toBe(false));
});

it('sends a region override and offers sign-in for an expired profile', async () => {
  const h = handlers();
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: h.rpc });
  act(() => { void command.run({ threadId: 't2' } as never); });
  await overlay.findByRole('option', { name: /acme-prod/ });
  fireEvent.change(overlay.getByLabelText('Region override'), { target: { value: 'us-east-1' } });
  fireEvent.click(overlay.getByRole('option', { name: /acme-prod/ }));
  await waitFor(() => expect(h.current()).toEqual({ profile: 'acme-prod/ReadOnly', region: 'us-east-1' }));
  fireEvent.click(await overlay.findByRole('button', { name: 'Sign in with Granted' }));
  await waitFor(() => expect(overlay.rpcCalls.find(c => c.method === 'signIn')?.input).toEqual({ profile: 'acme-prod/ReadOnly' }));
  act(() => { void command.run({ threadId: 't2' } as never); });
});

it('rejects a malformed region before calling the server', async () => {
  const h = handlers();
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: h.rpc });
  act(() => { void command.run({ threadId: 't3' } as never); });
  await overlay.findByRole('option', { name: /acme-dev/ });
  fireEvent.change(overlay.getByLabelText('Region override'), { target: { value: 'ireland' } });
  fireEvent.click(overlay.getByRole('option', { name: /acme-dev/ }));
  expect(await overlay.findByRole('alert')).toHaveProperty('textContent', 'ireland is not an AWS region name.');
  expect(overlay.rpcCalls.some(c => c.method === 'setChoice')).toBe(false);
  act(() => { void command.run({ threadId: 't3' } as never); });
});

it('shows a failed load with a retry instead of loading forever', async () => {
  const h = handlers();
  let fail = true;
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: { ...h.rpc, state: () => { if (fail) throw new Error('offline'); return state; } } });
  act(() => { void command.run({ threadId: 't4' } as never); });
  expect((await overlay.findByRole('alert')).textContent).toContain('Could not load AWS profiles: offline');
  fail = false;
  fireEvent.click(overlay.getByRole('button', { name: 'Retry' }));
  await overlay.findByRole('option', { name: /acme-dev/ });
  expect(overlay.queryByRole('alert')).toBeNull();
  act(() => { void command.run({ threadId: 't4' } as never); });
});

it('shows a failed sign-in request as an alert', async () => {
  const h = handlers();
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: { ...h.rpc, signIn: () => { throw new Error('host unreachable'); } } });
  act(() => { void command.run({ threadId: 't5' } as never); });
  fireEvent.click(await overlay.findByRole('option', { name: /acme-prod/ }));
  fireEvent.click(await overlay.findByRole('button', { name: 'Sign in with Granted' }));
  expect((await overlay.findByRole('alert')).textContent).toContain('host unreachable');
  act(() => { void command.run({ threadId: 't5' } as never); });
});

it('saves one choice at a time', async () => {
  const h = handlers();
  let finish = () => {};
  const overlay = renderSlot(app.appOverlays[0]!, {}, {
    rpc: { ...h.rpc, setChoice: (input: unknown) => new Promise(resolve => { finish = () => resolve(h.rpc.setChoice(input)); }) },
  });
  act(() => { void command.run({ threadId: 't6' } as never); });
  fireEvent.click(await overlay.findByRole('option', { name: /acme-dev/ }));
  await waitFor(() => expect(overlay.getByRole('option', { name: /Off/ })).toHaveProperty('disabled', true));
  fireEvent.click(overlay.getByRole('option', { name: /Off/ }));
  fireEvent.keyDown(overlay.getByLabelText('Filter profiles'), { key: 'Enter' });
  expect(overlay.rpcCalls.filter(c => c.method === 'setChoice')).toHaveLength(1);
  act(() => finish());
  await waitFor(() => expect(h.current()).toEqual({ profile: 'acme-dev', region: null }));
});

it('opens on the current choice, so Enter keeps it', async () => {
  const h = handlers();
  h.rpc.setChoice({ choice: { profile: 'acme-dev', region: null } });
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: h.rpc });
  act(() => { void command.run({ threadId: 't7' } as never); });
  await overlay.findByRole('option', { name: /acme-dev/ });
  fireEvent.keyDown(overlay.getByLabelText('Filter profiles'), { key: 'Enter' });
  await waitFor(() => expect(overlay.rpcCalls.find(c => c.method === 'setChoice')?.input)
    .toEqual({ threadId: 't7', choice: { profile: 'acme-dev', region: null } }));
});

it('picks the highlighted row with Enter after a mouse pick, as focus stays in the filter', async () => {
  const h = handlers();
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: h.rpc });
  act(() => { void command.run({ threadId: 't8' } as never); });
  const filter = overlay.getByLabelText('Filter profiles');
  const prod = await overlay.findByRole('option', { name: /acme-prod/ });
  fireEvent.mouseMove(prod, { clientX: 10, clientY: 10 });
  fireEvent.mouseMove(prod, { clientX: 12, clientY: 14 });
  expect(fireEvent.mouseDown(prod)).toBe(false);
  fireEvent.click(prod);
  await overlay.findByRole('button', { name: 'Sign in with Granted' });
  fireEvent.keyDown(filter, { key: 'ArrowUp' });
  const active = overlay.getByRole('option', { selected: true });
  expect(filter.getAttribute('aria-activedescendant')).toBe(active.id);
  expect(active.textContent).toContain('acme-dev');
  fireEvent.keyDown(filter, { key: 'Enter' });
  await waitFor(() => expect(h.current()).toEqual({ profile: 'acme-dev', region: null }));
});

it('does not close a reopened picker when an earlier save ends', async () => {
  const h = handlers();
  let finish = () => {};
  const overlay = renderSlot(app.appOverlays[0]!, {}, {
    rpc: { ...h.rpc, setChoice: (input: unknown) => new Promise(resolve => { finish = () => resolve(h.rpc.setChoice(input)); }) },
  });
  act(() => { void command.run({ threadId: 't9' } as never); });
  fireEvent.click(await overlay.findByRole('option', { name: /acme-dev/ }));
  act(() => { void command.run({ threadId: 't9' } as never); });
  expect(overlay.queryByRole('dialog')).toBeNull();
  act(() => { void command.run({ threadId: 't9' } as never); });
  const reopened = await overlay.findByRole('dialog', { name: 'AWS profile' });
  await act(async () => finish());
  await waitFor(() => expect(h.current()).toEqual({ profile: 'acme-dev', region: null }));
  expect(reopened.isConnected).toBe(true);
  act(() => { void command.run({ threadId: 't9' } as never); });
});

it('chooses Off despite a malformed region, and clears the region error on edit', async () => {
  const h = handlers();
  h.rpc.setChoice({ choice: { profile: 'acme-dev', region: null } });
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: h.rpc });
  act(() => { void command.run({ threadId: 't10' } as never); });
  const dev = await overlay.findByRole('option', { name: /acme-dev/ });
  const region = overlay.getByLabelText('Region override');
  fireEvent.change(region, { target: { value: 'ireland' } });
  fireEvent.click(dev);
  expect((await overlay.findByRole('alert')).textContent).toBe('ireland is not an AWS region name.');
  expect(region.getAttribute('aria-invalid')).toBe('true');
  fireEvent.change(region, { target: { value: 'irelan' } });
  expect(overlay.queryByRole('alert')).toBeNull();
  fireEvent.click(overlay.getByRole('option', { name: /Off/ }));
  await waitFor(() => expect(h.current()).toEqual({ profile: null, region: null }));
});

it('keeps Off and a retry when the AWS config cannot be read', async () => {
  const h = handlers();
  let error: string | null = 'Could not read ~/.aws/config: EACCES';
  const overlay = renderSlot(app.appOverlays[0]!, {}, {
    rpc: { ...h.rpc, state: () => error ? { profiles: [], error } : state },
  });
  act(() => { void command.run({ threadId: 't11' } as never); });
  expect((await overlay.findByRole('alert')).textContent).toContain('EACCES');
  expect(overlay.getByRole('option', { name: /Off/ })).toBeTruthy();
  error = null;
  fireEvent.click(overlay.getByRole('button', { name: 'Retry' }));
  await overlay.findByRole('option', { name: /acme-dev/ });
  expect(overlay.queryByRole('alert')).toBeNull();
  act(() => { void command.run({ threadId: 't11' } as never); });
});

it('says so when a retry fails again', async () => {
  const h = handlers();
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: { ...h.rpc, state: () => { throw new Error('offline'); } } });
  act(() => { void command.run({ threadId: 't12' } as never); });
  expect((await overlay.findByRole('alert')).textContent).toBe('Could not load AWS profiles: offline');
  fireEvent.click(overlay.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(overlay.getByRole('alert').textContent).toBe('Still could not load AWS profiles: offline'));
  act(() => { void command.run({ threadId: 't12' } as never); });
});

it('returns the highlight to the current choice when the filter is cleared', async () => {
  const h = handlers();
  h.rpc.setChoice({ choice: { profile: 'acme-prod/ReadOnly', region: null } });
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: h.rpc });
  act(() => { void command.run({ threadId: 't13' } as never); });
  await overlay.findByRole('option', { name: /acme-prod/ });
  const filter = overlay.getByLabelText('Filter profiles');
  fireEvent.change(filter, { target: { value: 'a' } });
  fireEvent.change(filter, { target: { value: '' } });
  expect(overlay.getByRole('option', { selected: true }).textContent).toContain('acme-prod/ReadOnly');
  act(() => { void command.run({ threadId: 't13' } as never); });
});

it('does not load for a closed picker when its sign-in ends, so another thread keeps its own choice', async () => {
  const threads: Record<string, ThreadView> = {
    t14: { choice: { profile: 'acme-prod/ReadOnly', region: null }, region: null, lastFetch: null },
    t15: { choice: { profile: 'acme-dev', region: null }, region: 'eu-west-1', lastFetch: null },
  };
  let finish = () => {};
  const overlay = renderSlot(app.appOverlays[0]!, {}, {
    rpc: {
      ...handlers().rpc,
      thread: (input: unknown) => threads[(input as { threadId: string }).threadId]!,
      signIn: () => new Promise(resolve => { finish = () => resolve({ ok: true }); }),
    },
  });
  act(() => { void command.run({ threadId: 't14' } as never); });
  fireEvent.click(await overlay.findByRole('button', { name: 'Sign in with Granted' }));
  act(() => { void command.run({ threadId: 't14' } as never); });
  act(() => { void command.run({ threadId: 't15' } as never); });
  await overlay.findByRole('option', { selected: true, name: /acme-dev/ });
  await act(async () => finish());
  const threadCalls = () => overlay.rpcCalls.filter(c => c.method === 'thread').map(c => (c.input as { threadId: string }).threadId);
  expect(threadCalls()).toEqual(['t14', 't15']);
  fireEvent.keyDown(overlay.getByLabelText('Filter profiles'), { key: 'Enter' });
  await waitFor(() => expect(overlay.rpcCalls.find(c => c.method === 'setChoice')?.input)
    .toEqual({ threadId: 't15', choice: { profile: 'acme-dev', region: null } }));
});

it('drops a load still running at close, so Enter on reopen keeps the current choice', async () => {
  const h = handlers();
  h.rpc.setChoice({ choice: { profile: 'acme-dev', region: null } });
  let release = () => {};
  let first = true;
  const overlay = renderSlot(app.appOverlays[0]!, {}, {
    rpc: {
      ...h.rpc,
      thread: () => {
        if (!first) return h.rpc.thread();
        first = false;
        return new Promise(resolve => { release = () => resolve(h.rpc.thread()); });
      },
    },
  });
  act(() => { void command.run({ threadId: 't16' } as never); });
  await overlay.findByRole('dialog', { name: 'AWS profile' });
  act(() => { void command.run({ threadId: 't16' } as never); });
  await act(async () => release());
  act(() => { void command.run({ threadId: 't16' } as never); });
  await overlay.findByRole('option', { selected: true, name: /acme-dev/ });
  fireEvent.keyDown(overlay.getByLabelText('Filter profiles'), { key: 'Enter' });
  await waitFor(() => expect(h.current()).toEqual({ profile: 'acme-dev', region: null }));
});

it('keeps focus in the filter after a click on Sign in, so Enter picks the highlighted row', async () => {
  const h = handlers();
  h.rpc.setChoice({ choice: { profile: 'acme-prod/ReadOnly', region: null } });
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: h.rpc });
  act(() => { void command.run({ threadId: 't17' } as never); });
  const signIn = await overlay.findByRole('button', { name: 'Sign in with Granted' });
  expect(fireEvent.mouseDown(signIn)).toBe(false);
  fireEvent.click(signIn);
  await waitFor(() => expect(overlay.rpcCalls.filter(c => c.method === 'signIn')).toHaveLength(1));
  const filter = overlay.getByLabelText('Filter profiles');
  fireEvent.keyDown(filter, { key: 'ArrowUp' });
  fireEvent.keyDown(filter, { key: 'Enter', isComposing: true });
  expect(overlay.rpcCalls.some(c => c.method === 'setChoice' && (c.input as { choice: { profile: string } }).choice.profile === 'acme-dev')).toBe(false);
  fireEvent.keyDown(filter, { key: 'Enter' });
  await waitFor(() => expect(h.current()).toEqual({ profile: 'acme-dev', region: null }));
  expect(overlay.rpcCalls.filter(c => c.method === 'signIn')).toHaveLength(1);
});

it('shows when credentials were last used only for the current profile', async () => {
  const h = handlers();
  const overlay = renderSlot(app.appOverlays[0]!, {}, {
    rpc: {
      ...h.rpc,
      thread: () => ({ choice: { profile: 'acme-dev', region: null }, region: 'eu-west-1', lastFetch: { profile: 'acme-prod/ReadOnly', at: Date.now() - 5 * 60_000 } }),
    },
  });
  act(() => { void command.run({ threadId: 't18' } as never); });
  const dialog = await overlay.findByRole('dialog', { name: 'AWS profile' });
  await waitFor(() => expect(dialog.querySelector('.aws-header')?.textContent).toContain('acme-dev · eu-west-1'));
  expect(dialog.querySelector('.aws-header')?.textContent).not.toContain('used');
  act(() => { void command.run({ threadId: 't18' } as never); });
});

it('moves the highlight only when the pointer moves, not when the list moves under a still pointer', async () => {
  const h = handlers();
  h.rpc.setChoice({ choice: { profile: 'acme-dev', region: null } });
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: h.rpc });
  act(() => { void command.run({ threadId: 't19' } as never); });
  const prod = await overlay.findByRole('option', { name: /acme-prod/ });
  fireEvent.mouseEnter(prod);
  fireEvent.mouseMove(prod, { clientX: 40, clientY: 80 });
  fireEvent.mouseMove(prod, { clientX: 40, clientY: 80 });
  expect(overlay.getByRole('option', { selected: true }).textContent).toContain('acme-dev');
  fireEvent.mouseMove(prod, { clientX: 41, clientY: 80 });
  expect(overlay.getByRole('option', { selected: true }).textContent).toContain('acme-prod');
  act(() => { void command.run({ threadId: 't19' } as never); });
});

it('keeps a region typed while the profiles load', async () => {
  const h = handlers();
  h.rpc.setChoice({ choice: { profile: 'acme-dev', region: 'eu-central-1' } });
  let release = () => {};
  const overlay = renderSlot(app.appOverlays[0]!, {}, {
    rpc: { ...h.rpc, thread: () => new Promise(resolve => { release = () => resolve(h.rpc.thread()); }) },
  });
  act(() => { void command.run({ threadId: 't20' } as never); });
  await overlay.findByRole('dialog', { name: 'AWS profile' });
  const region = overlay.getByLabelText('Region override') as HTMLInputElement;
  fireEvent.change(region, { target: { value: 'us-west-2' } });
  await act(async () => release());
  await overlay.findByRole('option', { name: /acme-dev/ });
  expect(region.value).toBe('us-west-2');
  fireEvent.keyDown(overlay.getByLabelText('Filter profiles'), { key: 'Enter' });
  await waitFor(() => expect(h.current()).toEqual({ profile: 'acme-dev', region: 'us-west-2' }));
});

it('unlocks the rows after a failed save, so a second pick can succeed', async () => {
  const h = handlers();
  let fail = true;
  const overlay = renderSlot(app.appOverlays[0]!, {}, {
    rpc: { ...h.rpc, setChoice: (input: unknown) => { if (fail) throw new Error('offline'); return h.rpc.setChoice(input); } },
  });
  act(() => { void command.run({ threadId: 't21' } as never); });
  const dialog = await overlay.findByRole('dialog', { name: 'AWS profile' });
  fireEvent.click(await overlay.findByRole('option', { name: /acme-dev/ }));
  expect((await overlay.findByRole('alert')).textContent).toBe('Could not save the choice: offline');
  const dev = overlay.getByRole('option', { name: /acme-dev/ });
  expect(dev).toHaveProperty('disabled', false);
  expect(overlay.getByRole('listbox').getAttribute('aria-busy')).toBeNull();
  fail = false;
  fireEvent.click(dev);
  await waitFor(() => expect(h.current()).toEqual({ profile: 'acme-dev', region: null }));
  await waitFor(() => expect(dialog.isConnected).toBe(false));
});

it('sends one sign-in and one retry however often they are pressed', async () => {
  const h = handlers();
  h.rpc.setChoice({ choice: { profile: 'acme-prod/ReadOnly', region: null } });
  let finishSignIn = () => {};
  let failState = false;
  let releaseState = () => {};
  const overlay = renderSlot(app.appOverlays[0]!, {}, {
    rpc: {
      ...h.rpc,
      state: () => failState ? new Promise((_, reject) => { releaseState = () => reject(new Error('offline')); }) : state,
      signIn: () => new Promise(resolve => { finishSignIn = () => resolve({ ok: true }); }),
    },
  });
  act(() => { void command.run({ threadId: 't22' } as never); });
  const signIn = await overlay.findByRole('button', { name: 'Sign in with Granted' });
  fireEvent.click(signIn);
  fireEvent.click(signIn);
  fireEvent.keyDown(signIn, { key: 'Enter' });
  fireEvent.click(signIn);
  expect(overlay.rpcCalls.filter(c => c.method === 'signIn')).toHaveLength(1);
  failState = true;
  await act(async () => finishSignIn());
  await act(async () => releaseState());
  const retry = await overlay.findByRole('button', { name: 'Retry' });
  const before = overlay.rpcCalls.filter(c => c.method === 'state').length;
  fireEvent.click(retry);
  fireEvent.click(retry);
  expect(overlay.rpcCalls.filter(c => c.method === 'state')).toHaveLength(before + 1);
  await act(async () => releaseState());
  act(() => { void command.run({ threadId: 't22' } as never); });
});

it('drops a load that fails after close, so the next picker shows no stale alert', async () => {
  const h = handlers();
  let reject = () => {};
  let first = true;
  const overlay = renderSlot(app.appOverlays[0]!, {}, {
    rpc: {
      ...h.rpc,
      state: () => {
        if (!first) return state;
        first = false;
        return new Promise((_, fail) => { reject = () => fail(new Error('offline')); });
      },
    },
  });
  act(() => { void command.run({ threadId: 't23' } as never); });
  await overlay.findByRole('dialog', { name: 'AWS profile' });
  act(() => { void command.run({ threadId: 't23' } as never); });
  act(() => { void command.run({ threadId: 't24' } as never); });
  await overlay.findByRole('option', { name: /acme-dev/ });
  await act(async () => reject());
  expect(overlay.queryByRole('alert')).toBeNull();
  act(() => { void command.run({ threadId: 't24' } as never); });
});

it('shows one alert when a refresh fails after a config error', async () => {
  const h = handlers();
  let fail = false;
  const overlay = renderSlot(app.appOverlays[0]!, {}, {
    rpc: { ...h.rpc, state: () => { if (fail) throw new Error('offline'); return { profiles: [], error: 'Could not read ~/.aws/config: EACCES' }; } },
  });
  act(() => { void command.run({ threadId: 't25' } as never); });
  expect((await overlay.findByRole('alert')).textContent).toContain('EACCES');
  fail = true;
  fireEvent.click(overlay.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(overlay.getByRole('alert').textContent).toBe('Could not refresh AWS profiles: offline'));
  expect(overlay.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
  act(() => { void command.run({ threadId: 't25' } as never); });
});

it('announces the sign-in box that appears after choosing a profile that needs one', async () => {
  const h = handlers();
  const overlay = renderSlot(app.appOverlays[0]!, {}, { rpc: h.rpc });
  act(() => { void command.run({ threadId: 't26' } as never); });
  const status = (await overlay.findAllByRole('status')).find(node => !node.textContent);
  expect(status).toBeTruthy();
  fireEvent.click(await overlay.findByRole('option', { name: /acme-prod/ }));
  await waitFor(() => expect(status!.textContent).toContain('This profile needs a sign-in.'));
  act(() => { void command.run({ threadId: 't26' } as never); });
});
