import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import type { BoardView, MemberDetail } from './src/format.ts';

const freshMs = 20_000;
const threadAccounts = z.array(z.object({ threadId: z.string(), label: z.string() }).loose());

/**
 * Looks up what each member's thread runs on: provider, model, reasoning and account.
 * BB owns these facts, so they are read at view time and never stored on the board.
 */
export function createDetails(bb: BbPluginApi) {
  const cache = new Map<string, { at: number; detail: MemberDetail }>();
  let providers: { at: number; value: Promise<Map<string, MemberDetail['provider']>> } | null = null;
  const modelNames = new Map<string, Promise<Map<string, string>>>();

  const providerRecords = () => {
    if (!providers || Date.now() - providers.at > 5 * 60_000) {
      const value = bb.sdk.providers.list().then(
        list =>
          new Map(
            list.map(provider => [
              provider.id,
              {
                id: provider.id,
                name: provider.displayName,
                logoUrl: provider.logoUrl ?? null,
                glyph: typeof provider.icon === 'object' && provider.icon ? provider.icon.glyph : null,
              },
            ]),
          ),
      );
      providers = { at: Date.now(), value };
    }
    return providers.value;
  };

  const namesFor = (providerId: string, environmentId: string | null): Promise<Map<string, string>> => {
    const known = modelNames.get(providerId);
    if (known) return known;
    const names = bb.sdk.providers
      .models(environmentId ? { providerId, environmentId } : { providerId })
      .then(result => new Map(result.models.map(model => [model.id, model.displayName])))
      .catch(() => new Map<string, string>());
    modelNames.set(providerId, names);
    return names;
  };

  /** The Agent Switcher plugin knows which account a thread runs under. It is optional. */
  const accounts = async (): Promise<Map<string, string>> => {
    try {
      const rows = await bb.sdk.plugins.callRpc({ pluginId: 'claude-profiles', method: 'threadAccounts', input: {}, outputSchema: threadAccounts });
      return new Map(rows.map(row => [row.threadId, row.label]));
    } catch {
      return new Map();
    }
  };

  async function detail(threadId: string, accountOf: Map<string, string>): Promise<MemberDetail> {
    const cached = cache.get(threadId);
    if (cached && Date.now() - cached.at < freshMs) return cached.detail;
    const [thread, requests] = await Promise.all([
      bb.sdk.threads.get({ threadId }),
      bb.sdk.threads.events.list({ threadId, types: ['client/turn/requested'], order: 'desc', limit: '1' }),
    ]);
    const request = requests[0];
    const execution = request?.type === 'client/turn/requested' ? request.data.execution : null;
    const modelId = execution?.model ?? null;
    const [records, names] = await Promise.all([providerRecords(), namesFor(thread.providerId, thread.environmentId)]);
    const value: MemberDetail = {
      provider: records.get(thread.providerId) ?? { id: thread.providerId, name: thread.providerId, logoUrl: null, glyph: null },
      model: modelId ? (names.get(modelId) ?? modelId) : null,
      reasoning: execution?.reasoningLevel ?? null,
      account: accountOf.get(threadId) ?? null,
    };
    cache.set(threadId, { at: Date.now(), detail: value });
    return value;
  }

  /** Fills in every member's detail. A member whose thread cannot be read keeps empty detail. */
  return async function enrich(board: BoardView | null): Promise<BoardView | null> {
    if (!board) return null;
    const accountOf = await accounts();
    const members = await Promise.all(
      board.members.map(async member => ({ ...member, ...(await detail(member.threadId, accountOf).catch(() => ({}))) })),
    );
    return { ...board, members };
  };
}
