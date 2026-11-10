import type { ExperimentalFileLocation } from '@get-bb/plugin-sdk/app';

export type Match = { path: string; label: string };
export type Link = { path: string; location: ExperimentalFileLocation | null };
export type Lookup = {
  exists(path: string, signal: AbortSignal): Promise<boolean>;
  captures(suffix: string, signal: AbortSignal): Promise<Match[]>;
};
export type Resolution =
  | { kind: 'found'; match: Match; location: Link['location'] }
  | { kind: 'choices'; matches: Match[]; location: Link['location'] }
  | { kind: 'missing' }
  | { kind: 'cancelled' }
  | { kind: 'error'; reason: 'incomplete' | 'unavailable' };

export class LookupFailure extends Error {
  constructor(readonly reason: 'incomplete' | 'unavailable') { super(reason); }
}

export function absolutePath(path: string): string | null {
  if (!path.startsWith('/') || path.includes('\\')) return null;
  for (const char of path) {
    if (char.charCodeAt(0)<32 || char.charCodeAt(0)===127) return null;
  }
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') segments.pop(); else segments.push(segment);
  }
  return '/' + segments.join('/');
}

export function parseLink(href: string): Link | null {
  try {
    const url = new URL(href);
    if (url.protocol !== 'file:' || url.host || url.search) return null;
    const path = absolutePath(decodeURIComponent(url.pathname));
    if (!path || path === '/' || url.pathname.endsWith('/')) return null;
    let location: Link['location'] = null;
    if (url.hash) {
      const range = /^#L([1-9]\d*)(?:-L?([1-9]\d*))?$/u.exec(url.hash);
      if (!range) return null;
      const startLine = Number(range[1]);
      const endLine = Number(range[2] ?? range[1]);
      if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || endLine < startLine) return null;
      location = { kind:'range', startLine, endLine };
    }
    return {path,location};
  } catch { return null; }
}

export async function resolveLink(
  link: Link,
  context: { document: string; workspace: string },
  lookup: Lookup,
  signal: AbortSignal,
): Promise<Resolution> {
  try {
    signal.throwIfAborted();
    const folder = context.document.slice(0,context.document.lastIndexOf('/')+1);
    const suffix = link.path.startsWith(folder) ? link.path.slice(folder.length) : link.path.replace(/^\/+/, '');
    const relative = absolutePath(context.workspace + '/' + suffix);
    const candidates = [...new Set([link.path, ...(relative ? [relative] : [])])];
    for (const path of candidates) {
      const exists = await lookup.exists(path,signal);
      signal.throwIfAborted();
      if (exists) return {kind:'found',match:{path,label:path},location:link.location};
    }
    const matches = await lookup.captures(suffix,signal);
    signal.throwIfAborted();
    const unique = [...new Map(matches.map(match=>[match.path,match])).values()];
    const first = unique[0];
    if (unique.length === 1 && first) return {kind:'found',match:first,location:link.location};
    return unique.length ? {kind:'choices',matches:unique,location:link.location} : {kind:'missing'};
  } catch(error) {
    if (signal.aborted) return {kind:'cancelled'};
    return {kind:'error',reason:error instanceof LookupFailure ? error.reason : 'unavailable'};
  }
}
