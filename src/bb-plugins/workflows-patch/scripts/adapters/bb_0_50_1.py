"""Exact-cardinality session-options and activity transformations for BB 0.50.1."""

from adapters.bb_0_47_1 import REGISTRY, WORK_API, once, patch_authoring


def patch_activity_core(source):
    source = once(
        source,
        "function buildThreadActivityStateByThreadId(deps, threads2) {",
        REGISTRY
        + "function buildThreadActivityStateByThreadId(deps, threads2) {\n  bbBeginWorkAggregation();",
    )
    source = once(
        source,
        "    if (!backgroundActivity && !promptBannerActivity) {",
        "    const bbPluginWorkflowCount = bbCountPluginWork(thread.id);\n    if (!backgroundActivity && !promptBannerActivity && bbPluginWorkflowCount === 0) {",
    )
    source = once(
        source,
        "activeWorkflowCount: backgroundActivity?.activeWorkflowCount ?? EMPTY_THREAD_ACTIVITY.activeWorkflowCount",
        "activeWorkflowCount: (backgroundActivity?.activeWorkflowCount ?? EMPTY_THREAD_ACTIVITY.activeWorkflowCount) + bbPluginWorkflowCount",
    )
    source = once(
        source,
        "  const api = {\n    internal_DO_NOT_USE_recordPluginUse() {",
        WORK_API
        + "  const api = {\n    experimental_work,\n    internal_DO_NOT_USE_recordPluginUse() {",
    )
    source = once(
        source,
        """        pendingNeedsConfiguration = null;
      }
    },
    closeWebSockets()""",
        """        pendingNeedsConfiguration = null;
      }
      if (bbWorkSource !== null) {
        bbWorkSources.set(api, bbWorkSource);
        bbWorkPublished = true;
        for (const threadId of bbWorkThreads) bbWorkNotify(threadId);
      }
    },
    closeWebSockets()""",
    )
    source = once(
        source,
        "      invalidated = true;\n      rpcCaller.revoke();",
        """      invalidated = true;
      bbWorkSources.delete(api);
      bbWorkPublished = false;
      bbWorkSnapshots.clear();
      for (const threadId of bbWorkThreads) bbWorkNotify(threadId);
      rpcCaller.revoke();""",
    )
    source = once(
        source,
        """      publishSignal: (channel, payload) => {
        deps.hub.notifyPluginSignal(row.id, channel, payload);
      },""",
        """      publishSignal: (channel, payload) => {
        deps.hub.notifyPluginSignal(row.id, channel, payload);
      },
      notifyWorkChanged: (threadId) => {
        deps.hub.notifyThread(threadId, ["events-appended"], { backgroundActivityChanged: true });
      },""",
    )
    return source


def patch_activity_plugin(source):
    source = once(
        source,
        "function C(c){x.rpc.experimental_invalidate([`runs:${c}`]),s()}",
        "function C(c){try{x.experimental_work.changed(c)}catch(error){try{x.log.warn(`Activity notification failed: ${String(error)}`)}catch{}}x.rpc.experimental_invalidate([`runs:${c}`]),s()}",
    )
    # The plugin factory binds the workflow database to `r` in this release.
    source = once(
        source,
        "let t=xf(x,r,A);e.onChange",
        """let t=xf(x,r,A);let bbActiveWork=new Map();x.experimental_work.registerSource({beginAggregation(){const next=new Map();for(const run of r.prepare("SELECT id, origin_thread_id AS originThreadId FROM workflow_runs WHERE status IN ('queued', 'running')").all()){if(typeof run.originThreadId!=="string"||!run.originThreadId||typeof run.id!=="string"||!run.id)throw new Error("Invalid active workflow row");const items=next.get(run.originThreadId)??[];items.push({id:run.id,kind:"workflow"});next.set(run.originThreadId,items)}bbActiveWork=next},listForThread(threadId){return bbActiveWork.get(threadId)??[]}});for(const row of r.prepare("SELECT DISTINCT origin_thread_id AS originThreadId FROM workflow_runs WHERE status IN ('queued', 'running')").all())x.experimental_work.changed(row.originThreadId);e.onChange""",
    )
    return source


def patch_session_server(source: str) -> str:
    source = once(
        source,
        "permissionMode:x.selection.permissionMode},outputSchema:x.outputSchema",
        "permissionMode:x.selection.permissionMode,...(x.selection.sessionOptions===void 0?{}:{sessionOptions:x.selection.sessionOptions})},outputSchema:x.outputSchema",
    )
    source = once(
        source,
        '"reasoningLevel","outputSchema","schema","title","label","phase"',
        '"reasoningLevel","sessionOptions","outputSchema","schema","title","label","phase"',
    )
    source = once(
        source,
        "outputSchema:hc.nullable(),title:B0.string().min(1).nullable()",
        "outputSchema:hc.nullable(),sessionOptions:B0.record(B0.string().min(1),B0.union([B0.string(),B0.boolean()])).nullable().default(null),sessionOptionLabels:B0.array(B0.string().min(1)).optional(),title:B0.string().min(1).nullable()",
    )
    source = once(
        source,
        "if(x===void 0)return{selection:null,outputSchema:null,title:null,phase:null}",
        "if(x===void 0)return{selection:null,sessionOptions:null,outputSchema:null,title:null,phase:null}",
    )
    source = once(
        source,
        'let u=F?s:o,v=J8(x,"title")',
        'let u=F?s:o,bbSessionOptions=x.sessionOptions===void 0?null:B0.record(B0.string().min(1),B0.union([B0.string(),B0.boolean()])).parse(x.sessionOptions),v=J8(x,"title")',
    )
    source = once(
        source,
        'reasoningLevel:A}:null,outputSchema:u,title:v??l,phase:J8(x,"phase")',
        'reasoningLevel:A}:null,sessionOptions:bbSessionOptions,outputSchema:u,title:v??l,phase:J8(x,"phase")',
    )
    source = once(
        source,
        "reasoningLevel:gA.shape.reasoningLevel,permissionMode:gA.shape.permissionMode}),yx=2",
        "reasoningLevel:gA.shape.reasoningLevel,permissionMode:gA.shape.permissionMode,sessionOptions:K0.record(K0.string(),K0.union([K0.string(),K0.boolean()])).optional(),sessionOptionLabels:K0.array(K0.string()).optional()}),yx=2",
    )
    resolver = """function bbResolveSessionOptions(model,requested){
  if(requested==null)return{selections:void 0,labels:[]};
  const labels=[];
  for(const[id,value]of Object.entries(requested)){
    const option=model.sessionOptions?.find(candidate=>candidate.id===id);
    if(option===void 0)throw new Error(`Session option ${JSON.stringify(id)} is not available for this model`);
    if(option.type==="boolean"){
      if(typeof value!=="boolean")throw new Error(`Session option ${JSON.stringify(id)} requires true or false`);
      if(option.fixed===true&&value!==option.value)throw new Error(`${option.label} is fixed ${option.value?"on":"off"} for this model`);
      labels.push(value?option.label:`${option.label} off`);
    }else{
      if(typeof value!=="string")throw new Error(`Session option ${JSON.stringify(id)} requires a selection`);
      const selected=option.values.find(candidate=>candidate.id===value);
      if(selected===void 0)throw new Error(`Session option ${JSON.stringify(id)} has no value ${JSON.stringify(value)}`);
      labels.push(`${option.label}: ${selected.label}`);
    }
  }
  return{selections:requested,labels};
}
"""
    source = once(source, "async function g8(c,f,B){", resolver + "async function g8(c,f,B){")
    source = once(
        source,
        "return kp.parse({providerId:b.provider,model:i0.model,reasoningLevel:K,permissionMode:P})",
        "let bbOptions=bbResolveSessionOptions(i0,f.sessionOptions);return kp.parse({providerId:b.provider,model:i0.model,reasoningLevel:K,permissionMode:P,...(bbOptions.selections===void 0?{}:{sessionOptions:bbOptions.selections}),sessionOptionLabels:bbOptions.labels})",
    )
    source = once(
        source,
        "i0=K.selection;let H=Mx(e,c.id,f)",
        "i0=K.selection;let bbStoredOptions={...E,sessionOptionLabels:i0.sessionOptionLabels??[]};let H=Mx(e,c.id,f)",
    )
    source = source.replace(
        "options:E,selection:i0,replay:", "options:bbStoredOptions,selection:i0,replay:"
    )
    if source.count("options:bbStoredOptions,selection:i0,replay:") != 2:
        raise ValueError("Expected exactly two stored call paths")
    source = once(
        source,
        'reasoningLevel:i0.reasoningLevel,permissionMode:i0.permissionMode,visibility:"hidden"',
        'reasoningLevel:i0.reasoningLevel,...(i0.sessionOptions===void 0?{}:{sessionOptions:i0.sessionOptions}),permissionMode:i0.permissionMode,visibility:"hidden"',
    )
    source = once(
        source,
        "reasoningLevel:Q.string(),cached:Q.boolean()",
        "reasoningLevel:Q.string(),sessionOptionLabels:Q.array(Q.string()),cached:Q.boolean()",
    )
    source = once(
        source,
        'reasoningLevel:x.execution.reasoningLevel,cached:x.source==="cached"',
        'reasoningLevel:x.execution.reasoningLevel,sessionOptionLabels:x.options.sessionOptionLabels??[],cached:x.source==="cached"',
    )
    return source


def patch_session_app(source: str) -> str:
    return once(
        source,
        "metadata:[a.provider,cr(a.model),a.reasoningLevel]",
        "metadata:[a.provider,cr(a.model),a.reasoningLevel,...a.sessionOptionLabels]",
    )


def transform(patch, name, data):
    if patch == "session-options":
        patchers = {
            "builtin-plugins/workflows/dist/server.js": patch_session_server,
            "builtin-plugins/workflows/dist/app.js": patch_session_app,
            "builtin-plugins/workflows/skills/workflows/references/authoring.md": patch_authoring,
        }
    elif patch == "activity":
        patchers = {
            "start-server.js": patch_activity_core,
            "builtin-plugins/workflows/dist/server.js": patch_activity_plugin,
        }
    else:
        raise ValueError("Unknown transformation")
    return patchers[name](data.decode()).encode() if name in patchers else data
