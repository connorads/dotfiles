import type { PluginFileOpenerSource, PluginBrowserBbSdk } from '@get-bb/plugin-sdk/app';
import { absolutePath, LookupFailure, type Lookup, type Match } from './resolver';

type Workspace = {path:string | null;hostId:string;projectId:string};
type ContextSdk = {environments:{
  get(args:Parameters<PluginBrowserBbSdk['environments']['get']>[0]):Promise<Workspace>;
  list(args:Parameters<PluginBrowserBbSdk['environments']['list']>[0]):Promise<Workspace[]>;
}};

export async function documentContext(sdk: ContextSdk, source: PluginFileOpenerSource, path: string, signal: AbortSignal) {
  if (!source.environmentId || source.kind === 'thread-storage') return null;
  const environment = await sdk.environments.get({environmentId:source.environmentId,signal});
  let workspace = environment.path && absolutePath(environment.path);
  if (!workspace || (source.experimental_hostId && source.experimental_hostId !== environment.hostId)) return null;
  const document = absolutePath(path.startsWith('/') ? path : workspace+'/'+path);
  if (!document) return null;
  let projectId = environment.projectId;
  for (let folder=document.slice(0,document.lastIndexOf('/')); folder && folder!==workspace; folder=folder.slice(0,folder.lastIndexOf('/'))) {
    const environments = await sdk.environments.list({hostId:environment.hostId,path:folder,limit:100,signal});
    signal.throwIfAborted();
    const owners = environments.filter(value=>value.path===folder);
    if (owners.length===100 || new Set(owners.map(value=>value.projectId)).size>1) return null;
    if (owners[0]) { workspace=folder; projectId=owners[0].projectId; break; }
  }
  return {document,workspace,hostId:environment.hostId,projectId};
}

type Context = NonNullable<Awaited<ReturnType<typeof documentContext>>>;

export function fileLookup(sdk: PluginBrowserBbSdk, context: Context, exists: Lookup['exists']): Lookup {
  return {
    exists,
    async captures(suffix,signal) {
      const matches: Match[] = [];
      for (let offset=0;;offset+=100) {
        signal.throwIfAborted();
        const threads = await sdk.threads.list({projectId:context.projectId,hostId:context.hostId,archived:false,includeHidden:false,limit:100,offset,signal});
        for (const thread of threads) {
          signal.throwIfAborted();
          const files = await sdk.threads.storageFiles({threadId:thread.id,query:suffix.split('/').at(-1),limit:'10000',signal});
          if (files.truncated) throw new LookupFailure('incomplete');
          for (const file of files.files) {
            if (file.path!==suffix && !file.path.endsWith('/'+suffix)) continue;
            const root = absolutePath(files.storageRootPath);
            const path = absolutePath(files.storageRootPath+'/'+file.path);
            if (!root || !path || !path.startsWith(root+'/')) throw new LookupFailure('unavailable');
            matches.push({path,label:(thread.title || 'Untitled thread')+' / '+file.path});
          }
        }
        if (threads.length < 100) return matches;
        if (offset >= 900) throw new LookupFailure('incomplete');
      }
    },
  };
}
