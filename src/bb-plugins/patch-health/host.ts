import { experimental_defineHostEntry } from '@get-bb/plugin-sdk';
import { hostContract } from './contracts';
import { inspectDesktop } from './inspect';
export default experimental_defineHostEntry({ contract: hostContract, handlers: {
  inspect: (_input, context) => inspectDesktop(context.signal),
} });
