#!/usr/bin/env python3
"""Patch the pinned BB 0.46.1 Workflows bundles without a source build."""

import argparse
import hashlib
import os
import shutil
from pathlib import Path

APP = Path("/Applications/bb.app")
DIST = Path("Contents/Resources/app.asar.unpacked/node_modules/bb-app/server/dist")
OUTPUT = Path.home() / ".local/share/bb-bundle-patches/workflows-daybreak-0.46.1"
EXPECTED = {
    "start-server.js": "35ea7bee417290df8792f65d1f3e0be0742994bb957b909587fa1eb8fd2413e0",
    "builtin-plugins/workflows/dist/server.js": "e3f7b35cb2d74d1ce831b24a9cfabdf6e6e7f0a1832afc18fb982a3377fe27c8",
    "builtin-plugins/workflows/dist/app.js": "9f5a6b7142c8c5ac068878d0828b033fe6c71c1bb42fda5a936ffc0c30bdcaf0",
    "builtin-plugins/workflows/skills/workflows/references/authoring.md": "9dad0aaf6866f2c3a19a39163a64e886ff667c9b4c5a2c0199b3e519a4b71fa3",
}
PATCHED = {
    "builtin-plugins/workflows/dist/server.js": "69281ed271313ee82dd4d7fd73957503513fd8b795c66ac3598acf2c3c45476f",
    "builtin-plugins/workflows/dist/app.js": "88334a1b49579190f67340456013d17662390299cade70b0ea451cb8e12367eb",
    "builtin-plugins/workflows/skills/workflows/references/authoring.md": "b0432d239a22b6c2d0ebf5c2221ad6690fe966221a64954cbca6164c15497e3e",
}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def once(source: str, old: str, new: str) -> str:
    count = source.count(old)
    if count != 1:
        raise ValueError(f"Expected one occurrence, found {count}: {old[:100]}")
    return source.replace(old, new, 1)


def patch_server(source: str) -> str:
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
        "outputSchema:wE.nullable(),title:O0.string().min(1).nullable()",
        "outputSchema:wE.nullable(),sessionOptions:O0.record(O0.string().min(1),O0.union([O0.string(),O0.boolean()])).nullable().default(null),sessionOptionLabels:O0.array(O0.string().min(1)).optional(),title:O0.string().min(1).nullable()",
    )
    source = once(
        source,
        "if(x===void 0)return{selection:null,outputSchema:null,title:null,phase:null}",
        "if(x===void 0)return{selection:null,sessionOptions:null,outputSchema:null,title:null,phase:null}",
    )
    source = once(
        source,
        'let f=i?s:o,v=R8(x,"title")',
        'let f=i?s:o,bbSessionOptions=x.sessionOptions===void 0?null:O0.record(O0.string().min(1),O0.union([O0.string(),O0.boolean()])).parse(x.sessionOptions),v=R8(x,"title")',
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
    if (
        "x.experimental_work.registerSource({listForThread(threadId)" not in source
        or "x.experimental_work.changed(u)" not in source
    ):
        raise ValueError("Existing workflow activity patch is missing")
    return source


def patch_app(source: str) -> str:
    return once(
        source,
        "metadata:[i.provider,$n(i.model),i.reasoningLevel]",
        "metadata:[i.provider,$n(i.model),i.reasoningLevel,...i.sessionOptionLabels]",
    )


def patch_authoring(source: str) -> str:
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["check", "prepare", "apply", "restore"])
    parser.add_argument("--app", type=Path, default=APP)
    parser.add_argument("--output", type=Path, help="Directory for prepared bundles")
    args = parser.parse_args()
    targets = {name: args.app / DIST / name for name in EXPECTED}
    contents = {name: path.read_bytes() for name, path in targets.items()}
    core = "start-server.js"
    server = "builtin-plugins/workflows/dist/server.js"
    app = "builtin-plugins/workflows/dist/app.js"
    authoring = "builtin-plugins/workflows/skills/workflows/references/authoring.md"
    names = (server, app, authoring)
    patchers = {server: patch_server, app: patch_app, authoring: patch_authoring}
    if digest(contents[core]) != EXPECTED[core]:
        raise SystemExit("Refusing: BB core activity patch differs from pinned version")
    states = {}
    candidate = {}
    for name in names:
        current_hash = digest(contents[name])
        if current_hash == EXPECTED[name]:
            states[name] = "base"
            candidate[name] = patchers[name](contents[name].decode()).encode()
            if digest(candidate[name]) != PATCHED[name]:
                raise SystemExit(f"Refusing: generated {name} differs from pinned patch")
        elif current_hash == PATCHED[name]:
            states[name] = "patched"
            candidate[name] = contents[name]
        else:
            raise SystemExit(f"Refusing: {name} differs from both pinned versions")
    output = args.output or OUTPUT
    backup = output / "backup"
    if args.action == "check":
        for name in names:
            print(name, states[name], digest(contents[name]))
        return
    if args.action == "restore":
        for name in names:
            if states[name] == "base":
                continue
            saved = (backup / name).read_bytes()
            if digest(saved) != EXPECTED[name]:
                raise SystemExit(f"Refusing: backup differs from pinned {name}")
        for name in names:
            if states[name] == "patched":
                temp = targets[name].with_name(targets[name].name + ".daybreak.tmp")
                temp.write_bytes((backup / name).read_bytes())
                os.replace(temp, targets[name])
        print("Restored prior Workflows files; reload Workflows and the desktop window")
        return
    for name in names:
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(candidate[name])
        if digest(target.read_bytes()) != digest(candidate[name]):
            raise SystemExit(f"Prepared bundle write failed: {name}")
        print(name, digest(candidate[name]))
    if args.action == "prepare":
        return
    for name in names:
        target = backup / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if digest(target.read_bytes()) != EXPECTED[name]:
                raise SystemExit(f"Refusing to overwrite unexpected backup: {target}")
        elif states[name] == "base":
            shutil.copy2(targets[name], target)
        else:
            raise SystemExit(f"Missing verified backup for patched {name}")
    written = []
    try:
        for name in names:
            if states[name] == "patched":
                continue
            if targets[name].read_bytes() != contents[name]:
                raise RuntimeError(f"Bundle changed during installation: {name}")
            temp = targets[name].with_name(targets[name].name + ".daybreak.tmp")
            temp.write_bytes(candidate[name])
            os.replace(temp, targets[name])
            written.append(name)
            if digest(targets[name].read_bytes()) != PATCHED[name]:
                raise RuntimeError(f"Bundle verification failed: {name}")
    except Exception:
        for name in written:
            if digest(targets[name].read_bytes()) == PATCHED[name]:
                targets[name].write_bytes((backup / name).read_bytes())
        raise
    print("Applied Daybreak patch; reload Workflows and the desktop window")


if __name__ == "__main__":
    main()
