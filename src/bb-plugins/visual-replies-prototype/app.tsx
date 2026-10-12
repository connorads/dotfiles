import { useEffect, useRef, useState } from "react";
import { definePluginApp, useRpc, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { rpcContract, visualId } from "./contracts";
import { acceptHeight } from "./core";
import { fontStyles, frameDocument, readTheme } from "./frame";

export function VisualReply({ attributes, message }: PluginMessageDirectiveProps) {
  const rpc = useRpc<typeof rpcContract>();
  const container = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const [content, setContent] = useState<{ src: string; title: string } | null>(null);
  const [height, setHeight] = useState(1);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = attributes.id;
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let disposed = false;
    const nonce = crypto.randomUUID();
    let previous = "";
    setContent(null); setReady(false); setError(null);
    const receive = (event: MessageEvent) => {
      const next = acceptHeight(event.source, iframe.current?.contentWindow, event.data, nonce);
      if (next !== null) { setHeight(next); setReady(true); }
    };
    const update = () => {
      const theme = readTheme(element);
      const serialised = JSON.stringify(theme);
      if (serialised === previous) return;
      previous = serialised;
      iframe.current?.contentWindow?.postMessage({ type: "visual-theme", nonce, theme }, "*");
    };
    window.addEventListener("message", receive);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true });
    observer.observe(document.body, { attributes: true });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true });
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    const load = async () => {
      const parsed = visualId.parse(id);
      const [visual, fonts] = await Promise.all([rpc.call("read", { threadId: message.threadId, id: parsed }), fontStyles()]);
      if (!disposed) setContent({ src: frameDocument(visual.html, readTheme(element), fonts, nonce), title: visual.title });
    };
    load().catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { disposed = true; window.removeEventListener("message", receive); observer.disconnect(); media.removeEventListener("change", update); };
  }, [id, message.threadId, rpc]);
  return <div ref={container} style={{ width: "100%", minWidth: 0, background: "transparent" }}>
    {error ? <p role="alert">Visual reply unavailable: {error}</p> : content ? <iframe
      ref={iframe} title={content.title} srcDoc={content.src} sandbox="allow-scripts" referrerPolicy="no-referrer"
      style={{ display: "block", width: "100%", maxWidth: "100%", height, maxHeight: 1200, border: 0, background: "transparent", visibility: ready ? "visible" : "hidden" }}
    /> : <span role="status">Loading visual...</span>}
  </div>;
}
export default definePluginApp(app => {
  app.slots.messageDirective({ id: "visual-reply", component: VisualReply });
});
