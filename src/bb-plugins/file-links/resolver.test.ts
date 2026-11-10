import { expect, it } from 'vitest';
import { parseLink, resolveLink, type Lookup, type Match } from './resolver';

const context = { document: '/work/docs/report.md', workspace: '/work' };
const match = (path: string): Match => ({ path, label: path });
function lookup(files: string[] = [], captures: string[] = []): Lookup {
  return {
    exists: async path => files.includes(path),
    captures: async suffix => captures.filter(path => path.endsWith('/' + suffix)).map(match),
  };
}
const run = (href: string, files: string[] = [], captures: string[] = []) => {
  const link = parseLink(href);
  if (!link) throw new Error('Invalid test link');
  return resolveLink(link, context, lookup(files,captures), new AbortController().signal);
};

it('keeps an existing absolute destination ahead of every alternative', async () => {
  expect(await run('file:///work/docs/chart.png', ['/work/docs/chart.png','/work/chart.png'], ['/captures/chart.png']))
    .toEqual({kind:'found',match:match('/work/docs/chart.png'),location:null});
});

it('recovers missing leading slashes relative to the checkout', async () => {
  expect(await run('file:///docs/chart.png', ['/work/docs/chart.png']))
    .toEqual({kind:'found',match:match('/work/docs/chart.png'),location:null});
});

it('uses the checkout when a document-relative destination is missing', async () => {
  expect(await run('file:///work/docs/assets/chart.png', ['/work/assets/chart.png']))
    .toMatchObject({kind:'found',match:{path:'/work/assets/chart.png'}});
});

it('resolves a unique capture by path suffix, preserving its folder', async () => {
  expect(await run('file:///work/docs/example/chart.png', [], ['/storage/example/chart.png','/storage/other/chart.png']))
    .toMatchObject({kind:'found',match:{path:'/storage/example/chart.png'}});
});

it('returns all ambiguous matches without choosing', async () => {
  expect(await run('file:///work/docs/chart.png', [], ['/storage/a/chart.png','/storage/b/chart.png']))
    .toMatchObject({kind:'choices',matches:[match('/storage/a/chart.png'),match('/storage/b/chart.png')]});
});

it('does not reinterpret a missing absolute home path as a bare filename', async () => {
  expect(await run('file:///other/chart.png', [], ['/storage/a/chart.png'])).toEqual({kind:'missing'});
});

it('does not infer uniqueness from an incomplete search or read failure', async () => {
  const incomplete: Lookup = {exists:async()=>false,captures:async()=>{throw new Error('Search incomplete');}};
  const link = parseLink('file:///work/docs/chart.png');
  if (!link) throw new Error('Invalid link');
  expect(await resolveLink(link,context,incomplete,new AbortController().signal)).toMatchObject({kind:'error'});
});

it('cancels a lookup even when a provider finishes after cancellation', async () => {
  const controller = new AbortController();
  const link = parseLink('file:///work/docs/chart.png');
  if (!link) throw new Error('Invalid link');
  const delayed: Lookup = { exists:async()=>{controller.abort();return true;},captures:async()=>[] };
  expect(await resolveLink(link,context,delayed,controller.signal)).toEqual({kind:'cancelled'});
});

it('preserves encoded filenames and requested line ranges', async () => {
  expect(await run('file:///work/docs/a%20b.md#L4-L8',['/work/docs/a b.md']))
    .toMatchObject({kind:'found',location:{kind:'range',startLine:4,endLine:8}});
});

it.each(['https://example.com/a.png','//example.com/a.png','file://remote/a.png','file:///a.png?x=1','file:///%ZZ','file:///%00.png'])
  ('leaves unsupported or malformed links alone: %s', href => expect(parseLink(href)).toBeNull());
