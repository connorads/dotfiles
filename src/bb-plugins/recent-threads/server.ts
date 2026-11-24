import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import {
  lifecyclesSchema,
  organizationModeSchema,
  rpcContract,
  type Lifecycles,
  type OrganizationMode,
  type RecentView,
} from './contracts.ts';
import { nextArchivedToggle, nextToggle, parseRestoreLifecycles, parseRestoreMode } from './src/mode.ts';

const RESTORE_MODE_KEY = 'restoreMode';
const RESTORE_LIFECYCLES_KEY = 'restoreLifecycles';

const preferencesSchema = z.object({
  preferences: z.object({
    organizationMode: organizationModeSchema,
    threadLifecycles: lifecyclesSchema,
  }),
});
type Preferences = z.infer<typeof preferencesSchema>['preferences'];

const setPreferenceSchema = z.object({
  key: z.string(),
  value: z.unknown(),
});

type RpcInput = Parameters<BbPluginApi['sdk']['plugins']['callRpc']>[0]['input'];

export default function plugin(bb: BbPluginApi) {
  const threadList = <T>(method: string, input: RpcInput, outputSchema: z.ZodType<T>) =>
    bb.sdk.plugins.callRpc({ pluginId: 'thread-list', method, input, outputSchema });

  const readPreferences = async (): Promise<Preferences> =>
    (await threadList('listPreferences', null, preferencesSchema)).preferences;

  const writePreference = (key: string, value: OrganizationMode | Lifecycles) =>
    threadList('setPreference', { key, value }, setPreferenceSchema);

  const readRestoreMode = async () => parseRestoreMode(await bb.storage.kv.get(RESTORE_MODE_KEY));
  const readRestoreLifecycles = async () =>
    parseRestoreLifecycles(await bb.storage.kv.get(RESTORE_LIFECYCLES_KEY));

  const publish = (result: RecentView) => {
    bb.realtime.publish('state', result);
    return result;
  };

  // Serialise toggles so rapid double-presses read the updated preferences in order.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run);
    queue = next.catch(() => {});
    return next;
  };

  bb.rpc.register(rpcContract, {
    view: async (): Promise<RecentView> => {
      const [preferences, restoreMode] = await Promise.all([readPreferences(), readRestoreMode()]);
      return { mode: preferences.organizationMode, restoreMode, lifecycles: preferences.threadLifecycles };
    },
    toggle: () => serial(async (): Promise<RecentView> => {
      const [preferences, storedRestore] = await Promise.all([readPreferences(), readRestoreMode()]);
      const { nextMode, restoreMode } = nextToggle(preferences.organizationMode, storedRestore);
      if (restoreMode !== storedRestore) {
        await bb.storage.kv.set(RESTORE_MODE_KEY, restoreMode);
      }
      await writePreference('organizationMode', nextMode);
      return publish({ mode: nextMode, restoreMode, lifecycles: preferences.threadLifecycles });
    }),
    toggleArchived: () => serial(async (): Promise<RecentView> => {
      const [preferences, restoreMode, storedRestore] = await Promise.all([
        readPreferences(),
        readRestoreMode(),
        readRestoreLifecycles(),
      ]);
      const { nextLifecycles, restoreLifecycles } = nextArchivedToggle(preferences.threadLifecycles, storedRestore);
      await bb.storage.kv.set(RESTORE_LIFECYCLES_KEY, restoreLifecycles);
      await writePreference('threadLifecycles', nextLifecycles);
      return publish({ mode: preferences.organizationMode, restoreMode, lifecycles: nextLifecycles });
    }),
  });
}
