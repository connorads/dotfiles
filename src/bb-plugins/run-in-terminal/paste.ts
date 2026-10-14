import type { BbPluginApi } from '@get-bb/plugin-sdk';

type Terminals = Pick<BbPluginApi['sdk']['terminals'], 'list' | 'create' | 'input' | 'output'>;

const title = 'Commands';
// Bracketed paste puts the text in zsh's edit buffer without pressing Enter.
const bracket = (text: string) => `\x1b[200~${text}\x1b[201~`;

export function makePaste(terminals: Terminals, { promptTimeoutMs = 5000, pollMs = 100 } = {}) {
  /** A new shell drops input sent before it draws its first prompt. */
  async function waitForPrompt(terminalId: string) {
    const deadline = Date.now() + promptTimeoutMs;
    while (Date.now() < deadline) {
      const { chunks } = await terminals.output({ terminalId, limitChunks: 1 });
      if (chunks.length > 0) return;
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }
  }
  async function terminalFor(threadId: string) {
    const scope = { kind: 'thread', threadId } as const;
    const { sessions } = await terminals.list({ scope });
    const existing = sessions.find(s => s.title === title && (s.status === 'running' || s.status === 'starting'));
    if (existing) return existing.id;
    const session = await terminals.create({ scope, title, cols: 120, rows: 30 });
    await waitForPrompt(session.id);
    return session.id;
  }
  return async function paste(threadId: string, text: string): Promise<string> {
    const terminalId = await terminalFor(threadId);
    await terminals.input({ terminalId, dataBase64: Buffer.from(bracket(text)).toString('base64') });
    return terminalId;
  };
}
