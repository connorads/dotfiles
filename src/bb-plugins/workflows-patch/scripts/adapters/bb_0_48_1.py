"""Exact-cardinality session-options and activity transformations for BB 0.48.1."""

from adapters.bb_0_47_1 import once, patch_activity_core


def patch_activity_plugin(source):
    source = once(
        source,
        "function D(u){x.rpc.experimental_invalidate([`runs:${u}`])}",
        "function D(u){try{x.experimental_work.changed(u)}catch(error){try{x.log.warn(`Activity notification failed: ${String(error)}`)}catch{}}x.rpc.experimental_invalidate([`runs:${u}`])}",
    )
    source = once(
        source,
        "let t=cv(x,A,r);e.onChange",
        """let t=cv(x,A,r);let bbActiveWork=new Map();x.experimental_work.registerSource({beginAggregation(){const next=new Map();for(const run of A.prepare("SELECT id, origin_thread_id AS originThreadId FROM workflow_runs WHERE status IN ('queued', 'running')").all()){if(typeof run.originThreadId!=="string"||!run.originThreadId||typeof run.id!=="string"||!run.id)throw new Error("Invalid active workflow row");const items=next.get(run.originThreadId)??[];items.push({id:run.id,kind:"workflow"});next.set(run.originThreadId,items)}bbActiveWork=next},listForThread(threadId){return bbActiveWork.get(threadId)??[]}});for(const row of A.prepare("SELECT DISTINCT origin_thread_id AS originThreadId FROM workflow_runs WHERE status IN ('queued', 'running')").all())x.experimental_work.changed(row.originThreadId);e.onChange""",
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
        "outputSchema:wE.nullable(),title:B0.string().min(1).nullable()",
        "outputSchema:wE.nullable(),sessionOptions:B0.record(B0.string().min(1),B0.union([B0.string(),B0.boolean()])).nullable().default(null),sessionOptionLabels:B0.array(B0.string().min(1)).optional(),title:B0.string().min(1).nullable()",
    )
    source = once(
        source,
        "if(x===void 0)return{selection:null,outputSchema:null,title:null,phase:null}",
        "if(x===void 0)return{selection:null,sessionOptions:null,outputSchema:null,title:null,phase:null}",
    )
    source = once(
        source,
        'let f=i?s:o,v=R8(x,"title")',
        'let f=i?s:o,bbSessionOptions=x.sessionOptions===void 0?null:B0.record(B0.string().min(1),B0.union([B0.string(),B0.boolean()])).parse(x.sessionOptions),v=R8(x,"title")',
    )
    source = once(
        source,
        'reasoningLevel:r}:null,outputSchema:f,title:v??B,phase:R8(x,"phase")',
        'reasoningLevel:r}:null,sessionOptions:bbSessionOptions,outputSchema:f,title:v??B,phase:R8(x,"phase")',
    )
    source = once(
        source,
        "reasoningLevel:fr.shape.reasoningLevel,permissionMode:fr.shape.permissionMode}),Dx=2",
        "reasoningLevel:fr.shape.reasoningLevel,permissionMode:fr.shape.permissionMode,sessionOptions:J0.record(J0.string(),J0.union([J0.string(),J0.boolean()])).optional(),sessionOptionLabels:J0.array(J0.string()).optional()}),Dx=2",
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
    source = once(source, "async function ur(u,p,j){", resolver + "async function ur(u,p,j){")
    source = once(
        source,
        "return mp.parse({providerId:k.provider,model:Q.model,reasoningLevel:k.reasoningLevel,permissionMode:N})",
        "let bbOptions=bbResolveSessionOptions(Q,p.sessionOptions);return mp.parse({providerId:k.provider,model:Q.model,reasoningLevel:k.reasoningLevel,permissionMode:N,...(bbOptions.selections===void 0?{}:{sessionOptions:bbOptions.selections}),sessionOptionLabels:bbOptions.labels})",
    )
    source = once(
        source,
        "Q=N.selection;let V=f8(e,u.id,p)",
        "Q=N.selection;let bbStoredOptions={..._,sessionOptionLabels:Q.sessionOptionLabels??[]};let V=f8(e,u.id,p)",
    )
    source = source.replace(
        "options:_,selection:Q,replay:", "options:bbStoredOptions,selection:Q,replay:"
    )
    if source.count("options:bbStoredOptions,selection:Q,replay:") != 2:
        raise ValueError("Expected exactly two stored call paths")
    source = once(
        source,
        'reasoningLevel:Q.reasoningLevel,permissionMode:Q.permissionMode,visibility:"hidden"',
        'reasoningLevel:Q.reasoningLevel,...(Q.sessionOptions===void 0?{}:{sessionOptions:Q.sessionOptions}),permissionMode:Q.permissionMode,visibility:"hidden"',
    )
    source = once(
        source,
        "reasoningLevel:O.string(),cached:O.boolean()",
        "reasoningLevel:O.string(),sessionOptionLabels:O.array(O.string()),cached:O.boolean()",
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
        "metadata:[a.provider,fw(a.model),a.reasoningLevel]",
        "metadata:[a.provider,fw(a.model),a.reasoningLevel,...a.sessionOptionLabels]",
    )


def patch_session_authoring(source: str) -> str:
    return once(
        source,
        "execution fails the call instead of silently substituting another model.\n",
        """execution fails the call instead of silently substituting another model.

Session options use the selected model's provider-defined option IDs. Read the
live model catalog before setting one. For a model that offers Daybreak:

```js
await agent("Review the change", { sessionOptions: { daybreak: true } });
```

`sessionOptions` accepts boolean or select values. BB checks each ID, value and
fixed setting against the selected model before spawning the direct worker.
Invalid choices fail the call. The selected option labels appear beside the
worker model in workflow progress. Include an explicit provider, model and
reasoning level tuple when the origin model does not offer the option.
""",
    )


def transform(patch, name, data):
    if patch == "session-options":
        patchers = {
            "builtin-plugins/workflows/dist/server.js": patch_session_server,
            "builtin-plugins/workflows/dist/app.js": patch_session_app,
            "builtin-plugins/workflows/skills/workflows/references/authoring.md": patch_session_authoring,
        }
    elif patch == "activity":
        patchers = {
            "start-server.js": patch_activity_core,
            "builtin-plugins/workflows/dist/server.js": patch_activity_plugin,
        }
    else:
        raise ValueError("Unknown transformation")
    return patchers[name](data.decode()).encode() if name in patchers else data
