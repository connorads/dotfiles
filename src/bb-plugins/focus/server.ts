import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { rpcContract, type FocusView } from './contracts.ts';
import { hiddenGroups, initialState, isActive, setAlwaysShow, setMember, start, stop, type FocusState } from './src/focus.ts';

const STATE_KEY = 'state';
const ids = z.array(z.string());
const stateSchema = z.object({
  alwaysShow: ids.default([]),
  members: ids.default([]),
  restore: ids.nullable().default(null),
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

  async function view(state: FocusState): Promise<FocusView> {
    return {
      active: isActive(state),
      projects: (await projects()).map(({ id, name }) => ({
        id, name, member: state.members.includes(id), always: state.alwaysShow.includes(id),
      })),
    };
  }

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
    const stopped = stop(state);
    return commit(stopped.state, stopped.restore);
  };

  // One change at a time: each reads the state the previous one stored.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run);
    queue = next.catch(() => {});
    return next;
  };

  bb.rpc.register(rpcContract, {
    view: async () => view(await load()),
    toggle: ({ projectId }) => serial(async () => {
      const state = await load();
      return isActive(state) ? end(state) : apply(start(state, await readHidden(), projectId));
    }),
    setMember: ({ projectId, included }) => serial(async () => {
      const state = await load();
      return apply(setMember(state, isActive(state) ? [] : await readHidden(), projectId, included));
    }),
    setAlwaysShow: ({ projectId, on }) => serial(async () => apply(setAlwaysShow(await load(), projectId, on))),
  });
}
