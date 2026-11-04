"""Exact-cardinality activity transformations for BB 0.48.1 server packages."""

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


def transform(patch, name, data):
    if patch == "session-options":
        raise ValueError("No session-options recipe for 0.48.1")
    if patch != "activity":
        raise ValueError("Unknown transformation")
    patchers = {
        "start-server.js": patch_activity_core,
        "builtin-plugins/workflows/dist/server.js": patch_activity_plugin,
    }
    return patchers[name](data.decode()).encode() if name in patchers else data
