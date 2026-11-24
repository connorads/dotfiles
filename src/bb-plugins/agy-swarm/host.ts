import { homedir } from 'node:os';
import { experimental_defineHostEntry } from '@get-bb/plugin-sdk';
import { hostContract } from './contracts.ts';
import { loadSwarmSnapshot, loadWorkerLog, swarmFingerprint } from './src/swarm.ts';

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    snapshot: ({ providerId, sessionId }) => loadSwarmSnapshot(homedir(), providerId, sessionId),
    workerLog: ({ providerId, sessionId, member }) => loadWorkerLog(homedir(), providerId, sessionId, member),
    fingerprint: ({ providerId, sessionId }) => swarmFingerprint(homedir(), providerId, sessionId),
  },
});
