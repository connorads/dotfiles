import { experimental_defineHostEntry } from '@get-bb/plugin-sdk';
import { hostContract } from './contracts';
import { inspectDesktop } from './inspect';
import { labStatus, prepareLab, actOnLab } from './lab-host';
export default experimental_defineHostEntry({ contract: hostContract, handlers: {
  labStatus: () => labStatus(),
  prepareLab: () => prepareLab(),
  runLab: input => actOnLab('run', input.id, input.revision),
  reconcileLab: input => actOnLab('reconcile', input.id, input.revision),
  inspect: (_input, context) => inspectDesktop(context.signal),
} });
