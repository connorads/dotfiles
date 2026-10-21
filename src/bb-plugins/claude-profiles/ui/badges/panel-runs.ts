import type { useSdk } from '@get-bb/plugin-sdk/app';
import { z } from 'zod';

type Sdk = ReturnType<typeof useSdk>;
type Page = Awaited<ReturnType<Sdk['threads']['timeline']>>;

function collect(rows: Page['rows'], ids: Set<string>) {
  for (const row of rows) {
    if (row.kind === 'conversation' && row.role === 'assistant') {
      for (const match of row.text.matchAll(/::workflow-preview\{run="(wfr_[\w-]+)"\}/g)) ids.add(match[1]);
    }
    if (row.kind === 'turn' && row.children) collect(row.children, ids);
  }
}

// Panel headers display only the last eight run-ID characters. Read full IDs from recorded directives.
export async function resolvePanelRun(sdk: Sdk, threadId: string, suffix: string, signal: AbortSignal): Promise<string | null> {
  const { runs } = await sdk.plugins.callRpc({ pluginId: 'workflows', method: 'workflowActiveRuns',
    input: { threadId }, signal, outputSchema: z.object({ runs: z.array(z.object({ id: z.string() })) }),
  });
  const active = runs.filter(run => run.id.endsWith(suffix));
  if (active.length > 0) return active.length === 1 ? active[0].id : null;
  const ids = new Set<string>();
  let cursor: Page['timelinePage']['olderCursor'] = null;
  do {
    const page = await sdk.threads.timeline({ threadId, signal, deferContent: 'false',
      includeNestedRows: 'true', segmentLimit: '5',
      ...(cursor ? { beforeAnchorId: cursor.anchorId, beforeAnchorSeq: String(cursor.anchorSeq) } : {}),
    });
    signal.throwIfAborted();
    collect(page.rows, ids);
    const matches = [...ids].filter(id => id.endsWith(suffix));
    if (matches.length > 0) return matches.length === 1 ? matches[0] : null;
    cursor = page.timelinePage.olderCursor;
  } while (cursor);
  return null;
}
