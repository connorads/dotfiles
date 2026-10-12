import { homedir } from 'node:os';
import { experimental_defineHostEntry } from '@get-bb/plugin-sdk';
import { hostContract } from './contracts.ts';
import { load, loadFile } from './src/git.ts';

// The host's own home: the dotfiles fallback must use the checkout machine's
// HOME, which the server cannot know for a remote host.
export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    load: ({ root, scope }) => load(root, homedir(), scope),
    file: ({ root, ...input }) => loadFile(root, homedir(), input),
  },
});
