#!/usr/bin/env python3
"""Patch the pinned BB 0.47.1 Workflows bundles without a source build."""

import argparse
import hashlib
import os
import tempfile
from pathlib import Path

APP = Path("/Applications/bb.app")
DIST = Path("Contents/Resources/app.asar.unpacked/node_modules/bb-app/server/dist")
OUTPUT = Path.home() / ".local/share/bb-bundle-patches/workflows-daybreak-0.47.1"
EXPECTED = {
    "start-server.js": "7107e7dc8f5ddc377a3fc74d669d7899b3b41bc53d516edb185acc007d2ff77b",
    "builtin-plugins/workflows/dist/server.js": "892f1b1433359b69b4fc99f6fb9e3cdf38a95f80c0e947815af8220add92da42",
    "builtin-plugins/workflows/dist/app.js": "0b4e87e02da60c24a4c59e043cecbe5271016211ea6143eff20a7646d93bc155",
    "builtin-plugins/workflows/skills/workflows/references/authoring.md": "9dad0aaf6866f2c3a19a39163a64e886ff667c9b4c5a2c0199b3e519a4b71fa3",
}
PATCHED = {
    "builtin-plugins/workflows/dist/server.js": "f9fa912244f79d7cfce44f90088c1a0918757a978fd5ecfcee827de7b434add0",
    "builtin-plugins/workflows/dist/app.js": "439e02b9301ccb738e653d871f0cf432195cd73db1cc2da48a57dfd1a0c582b4",
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
        "outputSchema:_E.nullable(),title:B0.string().min(1).nullable()",
        "outputSchema:_E.nullable(),sessionOptions:B0.record(B0.string().min(1),B0.union([B0.string(),B0.boolean()])).nullable().default(null),sessionOptionLabels:B0.array(B0.string().min(1)).optional(),title:B0.string().min(1).nullable()",
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
        "return kp.parse({providerId:k.provider,model:Q.model,reasoningLevel:k.reasoningLevel,permissionMode:N})",
        "let bbOptions=bbResolveSessionOptions(Q,p.sessionOptions);return kp.parse({providerId:k.provider,model:Q.model,reasoningLevel:k.reasoningLevel,permissionMode:N,...(bbOptions.selections===void 0?{}:{sessionOptions:bbOptions.selections}),sessionOptionLabels:bbOptions.labels})",
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
        raise SystemExit("Refusing: BB core differs from pinned 0.47.1 version")
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
    output = (args.output or OUTPUT).resolve()
    backup = output / "backup"
    if args.action == "check":
        for name in names:
            print(name, states[name], digest(contents[name]))
        return
    # Preparation and backup paths must never alias the installation.
    for name in names:
        for path in (output / name, backup / name):
            if path.resolve().is_relative_to(args.app.resolve()):
                raise SystemExit("Refusing: output overlaps the app installation")
            if path.exists() and digest(path.read_bytes()) not in {
                PATCHED[name] if path == output / name else EXPECTED[name]
            }:
                raise SystemExit(f"Refusing to overwrite unexpected output: {path}")
    saved = {}
    if args.action in {"apply", "restore"}:
        for name in names:
            path = backup / name
            if path.exists():
                saved[name] = path.read_bytes()
                if digest(saved[name]) != EXPECTED[name]:
                    raise SystemExit(f"Refusing: backup differs from pinned {name}")
            elif states[name] == "patched":
                raise SystemExit(f"Missing verified backup for patched {name}")
            else:
                saved[name] = contents[name]
    if args.action == "restore":
        install(targets, contents, saved, names)
        print("Restored stock Workflows files; reload only after active workflows finish")
        return
    for name in names:
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(target, candidate[name])
        print(name, digest(candidate[name]))
    if args.action == "prepare":
        return
    for name in names:
        target = backup / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            with target.open("xb") as handle:
                handle.write(saved[name])
        if digest(target.read_bytes()) != EXPECTED[name]:
            raise SystemExit(f"Refusing: backup differs from pinned {name}")
    install(targets, contents, candidate, names)
    print("Applied Workflows patch; reload only after active workflows finish")


def atomic_write(target: Path, data: bytes) -> None:
    with tempfile.NamedTemporaryFile(
        dir=target.parent, prefix=".workflows-", delete=False
    ) as handle:
        temp = Path(handle.name)
        handle.write(data)
    try:
        if target.exists():
            temp.chmod(target.stat().st_mode)
        os.replace(temp, target)
        if target.read_bytes() != data:
            raise RuntimeError(f"Write verification failed: {target}")
    finally:
        temp.unlink(missing_ok=True)


def install(targets, before, after, names) -> None:
    written = []
    try:
        for name in names:
            if targets[name].read_bytes() != before[name]:
                raise RuntimeError(f"Bundle changed during installation: {name}")
        for name in names:
            if before[name] == after[name]:
                continue
            if targets[name].read_bytes() != before[name]:
                raise RuntimeError(f"Bundle changed during installation: {name}")
            written.append(name)
            atomic_write(targets[name], after[name])
    except Exception:
        for name in reversed(written):
            if targets[name].read_bytes() == after[name]:
                atomic_write(targets[name], before[name])
        raise


if __name__ == "__main__":
    main()
