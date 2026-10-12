import { experimental_defineHostEntry } from '@get-bb/plugin-sdk';
import { hostContract } from './contracts.ts';
import { createRunner, defaultPathPrefix } from './src/run.ts';
import { createSkl } from './src/skl.ts';

// `skl install` delegates to `skills add`, which can take a while on a big group.
const readTimeoutMs = 15_000;
const installTimeoutMs = 120_000;

const skl = (timeoutMs: number, signal: AbortSignal) =>
  createSkl(createRunner({ command: 'skl', timeoutMs, pathPrefix: defaultPathPrefix(), signal }));

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    list: async (_input, { signal }) => ({ rows: await skl(readTimeoutMs, signal).list() }),
    preview: async ({ ref }, { signal }) => ({ text: await skl(readTimeoutMs, signal).preview(ref) }),
    pointers: async ({ refs }, { signal }) => ({ text: await skl(readTimeoutMs, signal).pointers(refs) }),
    install: ({ refs, cwd }, { signal }) => skl(installTimeoutMs, signal).install(refs, cwd),
  },
});
