import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { definePluginApp, useBbNavigate, useSdk, useRpc, type PluginFileOpenerProps } from '@get-bb/plugin-sdk/app';
import { parseLink, resolveLink, type Link, type Match } from './resolver';
import { documentContext, fileLookup } from './sdk';
import type { rpcContract } from './contracts';
import './app.css';

type State =
  | { kind:'idle' }
  | { kind:'finding' }
  | { kind:'message'; text:string }
  | { kind:'choices'; matches:Match[]; location:Link['location']; hostId:string };

function Preview({path,source,Original}: PluginFileOpenerProps) {
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [state,setState] = useState<State>({kind:'idle'});
  const request = useRef<AbortController | null>(null);
  const anchor = useRef<HTMLAnchorElement | null>(null);
  const dialog = useRef<HTMLDialogElement | null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  useEffect(()=>{ if (state.kind==='choices') dialog.current?.showModal(); },[state]);

  function dismiss() {
    request.current?.abort();
    dialog.current?.close();
    setState({kind:'idle'});
    anchor.current?.focus();
  }
  function open(match:Match,hostId:string,location:Link['location']) {
    const opened = navigate.experimental_openFilePreview({target:{kind:'host',hostId,path:match.path},location});
    setState(opened ? {kind:'idle'} : {kind:'message',text:'This view could not open the file.'});
  }
  async function follow(event:MouseEvent<HTMLDivElement>) {
    if (event.button!==0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (!source.environmentId || source.kind==='thread-storage') return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const clicked = target.closest('a');
    if (!(clicked instanceof HTMLAnchorElement) || clicked.hasAttribute('download')) return;
    const href = clicked.getAttribute('href');
    const link = href && parseLink(href);
    if (!link) return;
    event.preventDefault(); event.stopPropagation();
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    anchor.current = clicked;
    setState({kind:'finding'});
    try {
      const context = await documentContext(sdk,source,path,controller.signal);
      if (controller.signal.aborted) return;
      if (!context) { setState({kind:'message',text:'File lookup needs a project workspace.'}); return; }
      const result = await resolveLink(link,context,fileLookup(sdk,context,path=>rpc.call('exists',{hostId:context.hostId,path})),controller.signal);
      if (controller.signal.aborted) return;
      switch(result.kind) {
        case 'found': open(result.match,context.hostId,result.location); break;
        case 'choices': setState({...result,hostId:context.hostId}); break;
        case 'missing': setState({kind:'message',text:'File not found in this workspace or its project captures.'}); break;
        case 'error': setState({kind:'message',text:result.reason==='incomplete'
          ? 'Search is incomplete. No file was opened.'
          : 'Could not check the file. Try again when the workspace is available.'}); break;
        case 'cancelled': break;
      }
    } catch {
      if (!controller.signal.aborted) setState({kind:'message',text:'Could not check the file. Try again when the workspace is available.'});
    }
  }
  return <div className="fl-preview" onClickCapture={follow}>
    {(state.kind==='finding' || state.kind==='message') && <div className="fl-status">
      <span role="status">{state.kind==='finding' ? 'Finding file...' : state.text}</span>
      <button type="button" onClick={dismiss}>{state.kind==='finding' ? 'Cancel' : 'Dismiss'}</button>
    </div>}
    <div className="fl-original"><Original /></div>
    {state.kind==='choices' && <dialog ref={dialog} className="fl-choices" aria-label="Choose matching file" onCancel={event=>{event.preventDefault();dismiss();}}>
      <div className="fl-choice-header"><strong>Choose matching file</strong><button type="button" onClick={dismiss}>Cancel</button></div>
      {state.matches.map(match=><button type="button" className="fl-choice" key={match.path}
        onClick={()=>open(match,state.hostId,state.location)}>{match.label}</button>)}
    </dialog>}
  </div>;
}

function FilePreview(props:PluginFileOpenerProps) {
  const key = [props.path,props.source.kind,props.source.environmentId,props.source.threadId,props.source.experimental_hostId].join('\0');
  return <Preview key={key} {...props} />;
}

export default definePluginApp(app=>{
  app.slots.fileOpener({id:'markdown',title:'File Links',extensions:['md','markdown'],component:FilePreview});
});
