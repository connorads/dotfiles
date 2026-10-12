import { z } from 'zod';
import type { PluginBrowserBbSdk } from '@get-bb/plugin-sdk/app';

const profileSchema = z.object({ id: z.string(), label: z.string() });
const accountsSchema = z.object({ supported: z.boolean(), profiles: z.array(profileSchema), currentId: z.string() });
const choiceSchema = z.object({ currentId: z.string() });
export type ProfileState = { supported: boolean, profiles: z.infer<typeof profileSchema>[], selection: { profile: z.infer<typeof profileSchema> } | null };

// Claude Profiles' Default contributes no env, so it reads as the native login.
const selectionOf = (profiles: z.infer<typeof profileSchema>[], currentId: string) => {
  const profile = currentId === 'default' ? undefined : profiles.find(value => value.id === currentId);
  return profile ? { profile } : null;
};

export function createProfileClient(sdk: PluginBrowserBbSdk) {
  return {
    async list(threadId: string): Promise<ProfileState> {
      const value = await sdk.plugins.callRpc({ pluginId: 'claude-profiles', method: 'accounts', input: { threadId }, outputSchema: accountsSchema });
      return { supported: value.supported, profiles: value.profiles, selection: selectionOf(value.profiles, value.currentId) };
    },
    async switch(threadId: string, profileId: string) {
      const value = await sdk.plugins.callRpc({ pluginId: 'claude-profiles', method: 'choose', input: { threadId, profileId }, outputSchema: choiceSchema });
      return { profile: { id: value.currentId, label: value.currentId } };
    },
  };
}
