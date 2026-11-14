import { homedir, userInfo } from 'node:os';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { readLoginEnvironment, shape } from './src/environment.ts';

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    hostId: {
      type: 'string',
      label: 'Host ID',
      description: 'The BB host this plugin runs on (`bb host list`). Other hosts get nothing: these are this machine\'s paths.',
      default: '',
    },
  });
  // Read once per load; reload the plugin after changing the login environment.
  const home = homedir();
  const entries = readLoginEnvironment(home, userInfo().username).then(login => shape(login, home));
  entries.catch(error => bb.log.warn(`Could not read the login environment: ${error instanceof Error ? error.message : String(error)}`));

  bb.providers.experimental_contributeEnv('codex', async ({ hostId }) => {
    const { hostId: local } = await settings.get();
    if (!local || hostId !== local) return [];
    return entries;
  });
}
