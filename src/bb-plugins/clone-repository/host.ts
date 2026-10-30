import { homedir } from 'node:os';
import { join } from 'node:path';
import { experimental_defineHostEntry } from '@get-bb/plugin-sdk';
import { hostContract } from './contracts.ts';
import { createCheckout } from './src/checkout.ts';
import { listRepositories } from './src/discovery.ts';
import { run } from './src/process.ts';

const checkout = createCheckout({ run });
export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    info: () => ({ defaultRoot: join(homedir(), 'git'), platform: process.platform }),
    list: ({ page }, { signal }) => listRepositories(page, run, signal),
    prepare: ({ repository, destination }, { signal }) => checkout.prepare(repository, destination, signal),
  },
});
