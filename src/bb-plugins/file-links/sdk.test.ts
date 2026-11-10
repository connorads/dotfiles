import { expect, it } from 'vitest';
import { documentContext } from './sdk';

const current = {path:'/home/example',hostId:'host-example',projectId:'project-home'};
const report = {path:'/home/example/work/report',hostId:'host-example',projectId:'project-report'};
const source = {threadId:'thread-example',projectId:'project-home',kind:'host',environmentId:'env-home',experimental_hostId:'host-example'} as const;
const signal = new AbortController().signal;

it('uses the document workspace when opened from a parent project', async () => {
  const sdk = {environments:{get:async()=>current,list:async({path}:{path?:string})=>path===report.path?[report]:[]}};
  expect(await documentContext(sdk,source,report.path+'/docs/report.md',signal))
    .toEqual({document:report.path+'/docs/report.md',workspace:report.path,hostId:report.hostId,projectId:report.projectId});
});

it('retains the thread workspace when no nearer workspace owns the document', async () => {
  const sdk = {environments:{get:async()=>current,list:async()=>[]}};
  expect(await documentContext(sdk,source,current.path+'/docs/report.md',signal))
    .toEqual({document:current.path+'/docs/report.md',workspace:current.path,hostId:current.hostId,projectId:current.projectId});
});

it('does not guess between two projects registered at the same document workspace', async () => {
  const sdk = {environments:{get:async()=>current,list:async()=>[report,{...report,projectId:'other-project'}]}};
  expect(await documentContext(sdk,source,report.path+'/report.md',signal)).toBeNull();
});
