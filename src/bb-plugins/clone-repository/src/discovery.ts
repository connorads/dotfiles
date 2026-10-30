import { z } from 'zod';
import type { Repository } from '../contracts.ts';
import type { Run } from './process.ts';

const pageSchema = z.array(z.object({ fullName: z.string(), description: z.string(), visibility: z.string() })).max(100);
export type Listing = { ok: true; repositories: Repository[]; hasMore: boolean } | { ok: false; message: string };

export async function listRepositories(page: number, run: Run, signal?: AbortSignal): Promise<Listing> {
  if (!Number.isInteger(page) || page < 1 || page > 1000) return { ok: false, message: 'Invalid repository page.' };
  const result = await run('gh', [
    'api', '--method', 'GET', '/user/repos',
    '-f', 'per_page=100', '-f', 'affiliation=owner,collaborator,organization_member',
    '-f', 'sort=updated', '-f', `page=${page}`,
    '--jq', '[.[] | {fullName: .full_name, description: (.description // ""), visibility: (.visibility // "private")}]',
  ], { signal });
  if (result.code !== 0) return { ok: false, message: result.stderr.trim() || 'GitHub discovery failed. Check gh authentication on this Mac.' };
  try {
    const parsed = pageSchema.safeParse(JSON.parse(result.stdout));
    if (!parsed.success) return { ok: false, message: 'GitHub returned an unreadable repository page.' };
    return { ok: true, repositories: parsed.data, hasMore: parsed.data.length === 100 };
  } catch { return { ok: false, message: 'GitHub returned an unreadable repository page.' }; }
}
