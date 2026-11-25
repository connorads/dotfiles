import { homedir } from 'node:os';
import { experimental_defineHostEntry } from '@get-bb/plugin-sdk';
import { hostContract } from './contracts';

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: { async homeDir() { return homedir(); } },
});
