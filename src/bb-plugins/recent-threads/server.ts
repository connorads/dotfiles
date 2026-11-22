import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { organizationModeSchema, rpcContract, type OrganizationMode, type RecentView } from './contracts.ts';
import { nextToggle, parseRestoreMode } from './src/mode.ts';

const RESTORE_MODE_KEY = 'restoreMode';

const preferencesSchema = z.object({
  preferences: z.object({
    organizationMode: organizationModeSchema,
  }),
});

const setPreferenceSchema = z.object({
  key: z.string(),
  value: z.unknown(),
});

type RpcInput = Parameters<BbPluginApi['sdk']['plugins']['callRpc']>[0]['input'];

export default function plugin(bb: BbPluginApi) {
  const threadList = <T>(method: string, input: RpcInput, outputSchema: z.ZodType<T>) =>
    bb.sdk.plugins.callRpc({ pluginId: 'thread-list', method, input, outputSchema });

  const readMode = async (): Promise<OrganizationMode> =>
    (await threadList('listPreferences', null, preferencesSchema)).preferences.organizationMode;

  const writeMode = (mode: OrganizationMode) =>
    threadList('setPreference', { key: 'organizationMode', value: mode }, setPreferenceSchema);

  const readRestoreMode = async () => parseRestoreMode(await bb.storage.kv.get(RESTORE_MODE_KEY));

  // Serialise toggles so rapid double-presses read the updated mode in order.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run);
    queue = next.catch(() => {});
    return next;
  };

  bb.rpc.register(rpcContract, {
    view: async (): Promise<RecentView> => ({
      mode: await readMode(),
      restoreMode: await readRestoreMode(),
    }),
    toggle: () => serial(async (): Promise<RecentView> => {
      const [currentMode, storedRestore] = await Promise.all([readMode(), readRestoreMode()]);
      const { nextMode, restoreMode } = nextToggle(currentMode, storedRestore);
      if (restoreMode !== storedRestore) {
        await bb.storage.kv.set(RESTORE_MODE_KEY, restoreMode);
      }
      await writeMode(nextMode);
      const result: RecentView = { mode: nextMode, restoreMode };
      bb.realtime.publish('state', result);
      return result;
    }),
  });
}
