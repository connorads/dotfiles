import { realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { experimental_defineHostEntry } from '@get-bb/plugin-sdk';
import { hostContract } from './contracts.ts';
import { fingerprint, load, loadFile, resolveRepo } from './src/git.ts';

async function reviewRoot(root: string, exact = false): Promise<string> {
  if (!exact) return root;
  if (!isAbsolute(root)) throw new Error('Review checkout must be an absolute path.');
  const path = await realpath(root);
  const repo = await resolveRepo(path, homedir());
  if (!repo || await realpath(repo.cwd) !== path) throw new Error('Review target must be a Git checkout root.');
  return path;
}

// The host's own home: the dotfiles fallback must use the checkout machine's
// HOME, which the server cannot know for a remote host.
export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    load: async ({ root, exact, scope }) => load(await reviewRoot(root, exact), homedir(), scope),
    file: async ({ root, exact, ...input }) => loadFile(await reviewRoot(root, exact), homedir(), input),
    fingerprint: async ({ root, exact }) => fingerprint(await reviewRoot(root, exact), homedir()),
  },
});
