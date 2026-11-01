import { experimental_defineHostEntry } from '@get-bb/plugin-sdk';
import { nativeHostContract } from './native-contract';
import { prepareTraceRoot, readCodex, purgeCodex } from './codex-native';
import { collectClaude } from './claude-native';

export default experimental_defineHostEntry({ contract: nativeHostContract, handlers: {
  traceRoot: input => prepareTraceRoot(input.threadId),
  codex: input => readCodex(input.threadId, input.sessionId),
  purge: input => purgeCodex(input.threadId),
  claude: (input, context) => collectClaude(input, context.signal),
} });
