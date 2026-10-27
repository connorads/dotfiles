import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {compileFunction} from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {cpus} from 'node:os';
import {dirname, join} from 'node:path';

const [corePath, pluginPath] = process.argv.slice(2);
const core = readFileSync(corePath, 'utf8');
const plugin = readFileSync(pluginPath, 'utf8');
function between(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Missing fragment ${start}`);
  return text.slice(a, b);
}
const registry = between(core, 'const bbWorkSources = new Map();', 'function buildThreadActivityStateByThreadId(');
const aggregation = between(core, 'function buildThreadActivityStateByThreadId(', 'function buildThreadQueuedWorkByThreadId(');
const apiBody = between(core, '  let bbWorkSource = null;', '  const api = {\n    experimental_work,');
const activate = between(core, '    activate() {\n      if (activated) return;', '    closeWebSockets()');
const invalidate = between(core, '    invalidate() {\n      invalidated = true;', '\n  };\n}\n\n// src/services/plugins/plugin-runtime.ts');
const factory = compileFunction(`${registry}
function make(options2={}) {
  let activated=false, invalidated=false, revoked=false;
  const notifications=[], diagnostics=[], api={};
  const assertLive=()=>{if(invalidated)throw new Error('stale-generation')};
  const emitLog=(...args)=>diagnostics.push(args);
  options2.notifyWorkChanged ??= id=>notifications.push(id);
  const replaceDeclaredSharedPorts=()=>{}, pendingSharedPorts=new Map();
  const providerRegistrations={flush:()=>{}}, aiServiceRegistrations={flush:()=>{if(options2.failFlush)throw new Error('flush')}};
  const cliRecord={}, pluginCliCollisionWarning=()=>null, pluginId='synthetic';
  const pendingAgentToolProblems=[], reportAgentToolProblem=()=>{};
  let pendingNeedsConfiguration=options2.failLate?'synthetic':null;
  const reportNeedsConfiguration=()=>{if(options2.failLate)throw new Error('late-activation')};
  const rpcCaller={revoke(){revoked=true}},openTunnelIngresses=new Set();
  ${apiBody}
  api.experimental_work=experimental_work;
  return {api, notifications, diagnostics, get revoked(){return revoked}, ${activate} ${invalidate}};
}
${aggregation}
return {make, sources:bbWorkSources, aggregate:buildThreadActivityStateByThreadId};`,
['listActiveBackgroundTaskCountsByThreadIds', 'buildThreadPromptBannerActivityByThreadId', 'EMPTY_THREAD_ACTIVITY']);
const empty = {activeBackgroundAgentCount:0,activeBackgroundCommandCount:0,activeGoalCount:0,activePlanModeCount:0,activeWorkflowCount:0};
const native = [{threadId:'origin-a',activeBackgroundAgentCount:2,activeBackgroundCommandCount:3,activeWorkflowCount:4}];
const banners = new Map([['origin-a',{activeGoalCount:5,activePlanModeCount:6}]]);
const {make,sources,aggregate} = factory(()=>native,()=>banners,empty);
const threads=[{id:'origin-a'},{id:'origin-b'}];
const baseline=aggregate({},threads);
assert.equal(baseline.get('origin-a').activeWorkflowCount,4);
assert.equal(baseline.has('origin-b'),false);
// The stock aggregation is the same copied function without the three inserted expressions.
const stockAggregation=aggregation.replace('  bbBeginWorkAggregation();\n','').replace('    const bbPluginWorkflowCount = bbCountPluginWork(thread.id);\n','').replace(' && bbPluginWorkflowCount === 0','').replace('(backgroundActivity?.activeWorkflowCount ?? EMPTY_THREAD_ACTIVITY.activeWorkflowCount) + bbPluginWorkflowCount','backgroundActivity?.activeWorkflowCount ?? EMPTY_THREAD_ACTIVITY.activeWorkflowCount');
const pristineCore=readFileSync(join(dirname(corePath),'pristine/start-server.js'),'utf8');
assert.equal(stockAggregation,between(pristineCore,'function buildThreadActivityStateByThreadId(', 'function buildThreadQueuedWorkByThreadId('));
const stock=compileFunction(`${stockAggregation};return buildThreadActivityStateByThreadId;`,['listActiveBackgroundTaskCountsByThreadIds','buildThreadPromptBannerActivityByThreadId','EMPTY_THREAD_ACTIVITY'])(()=>native,()=>banners,empty);
assert.deepEqual(stock({},threads),baseline);

const select = between(plugin, 'var B8=`', '`').slice('var B8=`'.length);
const columns = select.split('SELECT')[1].split('FROM')[0].split(',').map(s=>s.trim().split(/\s+/)[0]);
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE workflow_runs(${columns.map(n=>`${n} ${n==='created_at'?'INTEGER':'TEXT'}`).join(',')})`);
const insert=db.prepare('INSERT INTO workflow_runs(id,origin_thread_id,status,created_at) VALUES(?,?,?,?)');
const query = between(plugin,'function TF(', '}F(TF,')+'}';
const rowMapper=query.match(/\.map\((\w+)\)/)[1];
const TF=compileFunction(`return (${query});`,['B8',rowMapper])(select,row=>({...row,notificationSent:row.notificationSent===1}));
const sourceFragment=between(plugin,'let t=pv(x,A,r);','e.onChange');
let sourceQueries=0, sourceWrites=0;
const A={prepare(sql){sourceQueries++;const statement=db.prepare(sql);return {all:(...args)=>statement.all(...args),run(){sourceWrites++;throw new Error('source wrote database')}}}};
const register = compileFunction(`${sourceFragment}`,['x','A','r','pv','B8']);
const progress = between(plugin,'function D(u){','}F(D,"publishRunsChanged")')+'}';
const D=compileFunction(`return (${progress});`,['x','_a']);
function pluginApi(owner) {return {...owner.api,log:{warn(){}},realtime:{publish(){published++}}}}
let published=0;
insert.run('same-id','origin-a','queued',1);
insert.run('run-b','origin-b','running',2);
insert.run('terminal','origin-a','succeeded',3);
const owner=make();
register(pluginApi(owner),A,{},()=>({}),select);
assert.equal(sources.size,0);
owner.activate();
assert.deepEqual(new Set(owner.notifications),new Set(['origin-a','origin-b']));
assert.equal(sourceWrites,0);
const count=(id)=>aggregate({},[{id}]).get(id)?.activeWorkflowCount??0;
assert.equal(count('origin-a'),5);
assert.equal(count('origin-a'),4+TF(A,'origin-a').length);
assert.equal(count('origin-b'),1);
insert.run('another-active','origin-a','running',4);assert.equal(count('origin-a'),6);
db.prepare('DELETE FROM workflow_runs WHERE id=?').run('another-active');
assert.equal(stock({},threads).get('origin-a').activeWorkflowCount,4);
const result=aggregate({},threads).get('origin-a');
for(const key of ['activeBackgroundAgentCount','activeBackgroundCommandCount','activeGoalCount','activePlanModeCount']) assert.equal(result[key],baseline.get('origin-a')[key]);
// Cancellation acknowledgement alone leaves persisted running state active.
assert.equal(count('origin-b'),1);
for (const status of ['succeeded','failed','cancelled']) {
  db.prepare("UPDATE workflow_runs SET status='running' WHERE id='run-b'").run();
  assert.equal(count('origin-b'),1);
  db.prepare('UPDATE workflow_runs SET status=? WHERE id=?').run(status,'run-b');
  D(pluginApi(owner),'progress')('origin-b');
  assert.equal(count('origin-b'),0);
}
assert.equal(published,3);
const other=make();other.api.experimental_work.registerSource({listForThread(){return [{id:'same-id',kind:'workflow'},{id:'same-id',kind:'workflow'}]}});other.activate();
assert.equal(count('origin-a'),6); // Equal IDs across sources remain separate; duplicates within a source collapse.
other.invalidate();
const flaky=make();let bad=false;
flaky.api.experimental_work.registerSource({listForThread(){if(bad)throw new Error('transient');return [{id:'x',kind:'workflow'}]}});flaky.activate();
assert.equal(count('origin-b'),1);bad=true;assert.equal(count('origin-b'),1);assert.ok(flaky.diagnostics.length);
assert.throws(()=>count('never-queried'),/activity-source-unavailable/);
flaky.invalidate();
const invalidSnapshot=make();let items=[{id:'previous',kind:'workflow'}];
invalidSnapshot.api.experimental_work.registerSource({listForThread(){return items}});invalidSnapshot.activate();
assert.equal(count('origin-b'),1);items=[{id:'new',kind:'workflow'},{id:'bad',kind:'agent'}];
assert.equal(count('origin-b'),1);invalidSnapshot.invalidate();
const refreshFailure=make();let refreshBad=false;
refreshFailure.api.experimental_work.registerSource({beginAggregation(){if(refreshBad)throw new Error('query unavailable')},listForThread(){return [{id:'previous',kind:'workflow'}]}});refreshFailure.activate();
assert.equal(count('origin-b'),1);refreshBad=true;assert.equal(count('origin-b'),1);assert.throws(()=>count('fresh-origin'),/activity-source-unavailable/);refreshFailure.invalidate();
const bulkFailure=make();let bulkBad=false;
bulkFailure.api.experimental_work.registerSource({beginAggregation(){if(bulkBad)throw new Error('shared query failure')},listForThread(){return [{id:'cached',kind:'workflow'}]}});bulkFailure.activate();
const bulkThreads=Array.from({length:5000},(_,i)=>({id:`cached-${i}`}));
aggregate({},bulkThreads);bulkBad=true;
const bulkResult=aggregate({},bulkThreads);
assert.equal(bulkResult.get('cached-4999').activeWorkflowCount,1);
assert.equal(bulkFailure.diagnostics.length,1);
bulkFailure.invalidate();
const malformed=make();malformed.api.experimental_work.registerSource({listForThread(){return [{id:'valid',kind:'workflow'},{id:'',kind:'workflow'}]}});malformed.activate();
assert.throws(()=>count('origin-b'),/activity-source-unavailable/);malformed.invalidate();
for(const options of [{failFlush:true},{failLate:true}]) {
  const failed=make(options);failed.api.experimental_work.registerSource({listForThread(){throw new Error('must never run')}});
  assert.throws(()=>failed.activate());assert.equal(sources.size,1);failed.invalidate();
}
const setupFailure=make();setupFailure.api.experimental_work.registerSource({listForThread(){throw new Error('failed setup')}});setupFailure.invalidate();assert.equal(sources.size,1);
let removedBeforeNotify=false;
const failingNotify=make({notifyWorkChanged(){removedBeforeNotify=!sources.has(failingNotify.api);throw new Error('notification')}});
failingNotify.api.experimental_work.registerSource({listForThread(){return []}});
failingNotify.api.experimental_work.changed('unqueried-origin');failingNotify.activate();failingNotify.invalidate();
assert.equal(removedBeforeNotify,true);assert.equal(failingNotify.revoked,true);
const old=owner.api.experimental_work;
owner.api.experimental_work.changed('changed-unqueried');const notificationsBefore=owner.notifications.filter(id=>id==='changed-unqueried').length;owner.invalidate();assert.equal(owner.notifications.filter(id=>id==='changed-unqueried').length,notificationsBefore+1);
assert.ok(owner.notifications.includes('changed-unqueried'));assert.equal(sources.size,0);
assert.throws(()=>old.changed('stale'),/stale-generation/);
assert.throws(()=>old.registerSource({listForThread(){return []}}),/stale-generation/);
const replacement=make();register(pluginApi(replacement),A,{},()=>({}),select);replacement.activate();assert.equal(count('origin-a'),5);replacement.invalidate();
// A re-entrant invalidation cannot overwrite the discarded generation snapshot.
const reentrant=make();reentrant.api.experimental_work.registerSource({listForThread(){reentrant.invalidate();return []}});reentrant.activate();assert.throws(()=>count('origin-a'),/stale-generation/);assert.equal(sources.size,0);
D({experimental_work:{changed(){throw new Error('notification')}},log:{warn(){throw new Error('logger')}},realtime:{publish(){published++}}},'progress')('origin-a');assert.equal(published,4);
assert.equal(sourceWrites,0);
const notifyBody=core.match(/notifyWorkChanged: \(threadId\) => \{([\s\S]*?)\n      \},/)[1];
let notification;
compileFunction(notifyBody,['deps','threadId'])({hub:{notifyThread(...args){notification=args}}},'synthetic-origin');
assert.deepEqual(notification,['synthetic-origin',['events-appended'],{backgroundActivityChanged:true}]);
console.log('PASS copied core/plugin lifecycle, composition, counting, failure snapshots, generation fencing, cleanup, persisted activation and progress');

if(process.env.BB_PATCH_MEASUREMENTS) {
  db.exec('DELETE FROM workflow_runs; BEGIN');
  for(let i=0;i<100000;i++)insert.run(`run-${i}`,`thread-${i<80000?0:i%5000}`,i%20===0?'running':i%31===0?'queued':'succeeded',i);
  db.exec('COMMIT');
  db.prepare("UPDATE workflow_runs SET source=? WHERE status IN ('queued', 'running')").run('x'.repeat(128*1024));
  const measured=make();register(pluginApi(measured),A,{},()=>({}),select);measured.activate();
  const measurements=[];
  for(const size of [100,1000,5000]) {
    const list=Array.from({length:size},(_,i)=>({id:`thread-${i}`}));
    const samples=[],queries=[];
    for(let r=0;r<7;r++){sourceQueries=0;const start=performance.now();aggregate({},list);samples.push(performance.now()-start);queries.push(sourceQueries)}
    const sorted=[...samples].sort((a,b)=>a-b);measurements.push({threads:size,samplesMs:samples,p95Ms:sorted[Math.ceil(sorted.length*.95)-1],queries});
  }
  const evidence={node:process.version,cpu:cpus()[0].model,rows:100000,activeSourceBytes:128*1024,baseline:'zero plugin queries',measurements};
  writeFileSync(process.env.BB_PATCH_MEASUREMENTS,JSON.stringify(evidence,null,2)+'\n');
  assert.ok(measurements.at(-1).p95Ms<100,JSON.stringify(evidence));
  measured.invalidate();console.log('PASS synthetic query budget');
}
