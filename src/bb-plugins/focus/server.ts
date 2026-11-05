import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { maskSchema, rpcContract, type FocusView } from './contracts.ts';
import {
  activate, addSet, deactivate, hiddenGroups, initialState, removeSet, renameSet, setMask, setProject, swapTarget,
  type FocusState,
} from './src/focus.ts';

const STATE_KEY = 'state';
const ids = z.array(z.string());
const stateSchema = z.object({
  sets: z.array(z.object({ id: z.string(), name: z.string(), projects: ids, mask: maskSchema })),
  active: z.object({ setId: z.string(), restore: ids }).nullable(),
  lastSetId: z.string().nullable(),
});
const preferencesSchema = z.object({ preferences: z.object({ hiddenGroups: ids }) });
const setPreferenceSchema = z.object({ key: z.string(), value: z.unknown() });
type RpcInput = Parameters<BbPluginApi['sdk']['plugins']['callRpc']>[0]['input'];

export default function plugin(bb: BbPluginApi) {
  // The built-in thread-list plugin owns the sidebar preferences.
  const threadList = <T>(method: string, input: RpcInput, outputSchema: z.ZodType<T>) =>
    bb.sdk.plugins.callRpc({ pluginId: 'thread-list', method, input, outputSchema });
  const readHidden = async () => (await threadList('listPreferences', null, preferencesSchema)).preferences.hiddenGroups;
  const writeHidden = (groups: string[]) => threadList('setPreference', { key: 'hiddenGroups', value: groups }, setPreferenceSchema);

  async function load(): Promise<FocusState> {
    const stored = await bb.storage.kv.get(STATE_KEY);
    if (stored === undefined) return initialState;
    const parsed = stateSchema.safeParse(stored);
    if (parsed.success) return parsed.data;
    bb.log.warn(`stored focus state is invalid (${parsed.error.message}); starting empty`);
    return initialState;
  }

  const projects = async () => (await bb.sdk.projects.list()).map(({ id, name }) => ({ id, name }));

  const view = async (state: FocusState): Promise<FocusView> => ({
    activeSetId: state.active?.setId ?? null,
    sets: state.sets,
    projects: await projects(),
  });

  /** Stores the state first, so a failed preference write is fixed by the next change. */
  async function commit(next: FocusState, write: string[] | null): Promise<FocusView> {
    await bb.storage.kv.set(STATE_KEY, next);
    if (write) await writeHidden(write);
    const result = await view(next);
    bb.realtime.publish('state', result);
    return result;
  }
  // Re-reads the project list so a project created during a view is hidden on the next change.
  const apply = async (next: FocusState) => commit(next, hiddenGroups(next, (await projects()).map(({ id }) => id)));
  const end = async (state: FocusState) => {
    const stopped = deactivate(state);
    return commit(stopped.state, stopped.restore);
  };
  const turnOn = async (state: FocusState, setId: string) =>
    apply(activate(state, setId, state.active ? [] : await readHidden()));

  // One change at a time: each reads the state the previous one stored.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run);
    queue = next.catch(() => {});
    return next;
  };

  bb.rpc.register(rpcContract, {
    view: async () => view(await load()),
    activate: ({ setId }) => serial(async () => {
      const state = await load();
      return setId ? turnOn(state, setId) : end(state);
    }),
    swap: () => serial(async () => {
      const state = await load();
      const target = swapTarget(state);
      return target ? turnOn(state, target) : end(state);
    }),
    createSet: ({ name }) => serial(async () => apply(addSet(await load(), randomUUID(), name))),
    renameSet: ({ setId, name }) => serial(async () => apply(renameSet(await load(), setId, name))),
    deleteSet: ({ setId }) => serial(async () => {
      const state = await load();
      const stopped = state.active?.setId === setId ? deactivate(state) : { state, restore: null };
      return commit(removeSet(stopped.state, setId), stopped.restore);
    }),
    setProject: ({ setId, projectId, included }) => serial(async () => apply(setProject(await load(), setId, projectId, included))),
    setMask: ({ setId, mask }) => serial(async () => apply(setMask(await load(), setId, mask))),
  });
}
