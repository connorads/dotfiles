import { z } from 'zod';
import type { PluginBrowserBbSdk } from '@get-bb/plugin-sdk/app';

const profileSchema = z.object({ id: z.string(), label: z.string() });
const selectionSchema = z.object({ profile: profileSchema });
const stateSchema = z.object({ supported: z.boolean(), profiles: z.array(profileSchema), selection: selectionSchema.nullable() });
export type ProfileState = z.infer<typeof stateSchema>;

export function createProfileClient(sdk: PluginBrowserBbSdk) {
  return {
    async list(threadId: string): Promise<ProfileState> {
      return sdk.plugins.callRpc({ pluginId: 'claude-profiles', method: 'thread', input: { threadId }, outputSchema: stateSchema });
    },
    async switch(threadId: string, profileId: string) {
      return sdk.plugins.callRpc({ pluginId: 'claude-profiles', method: 'switch', input: { threadId, profileId }, outputSchema: selectionSchema });
    },
  };
}
