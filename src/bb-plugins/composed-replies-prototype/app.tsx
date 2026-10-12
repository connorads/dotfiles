import { Component, useEffect, useState, type ReactNode } from "react";
import {
  definePluginApp,
  useRpc,
  type PluginMessageDirectiveProps,
} from "@get-bb/plugin-sdk/app";
import { CompositionResetContext } from "./interactive-primitives";
import { HydratedOpenUI } from "./openui-hydration";
import { Renderer as JsonRenderer, JSONUIProvider } from "@json-render/react";
import { registry, functions } from "./catalogue";
import { rpcContract, idSchema, type Composition } from "./contracts";
import { parseComposition, parseSpec } from "./validation";
class CompositionBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  render() {
    return this.state.error ? (
      <p role="alert">Composition unavailable: {this.state.error}</p>
    ) : (
      this.props.children
    );
  }
}
export function CompositionView({ composition }: { composition: Composition }) {
  const [epoch, setEpoch] = useState(0);
  return (
    <CompositionResetContext.Provider value={() => setEpoch((n) => n + 1)}>
      <div
        key={`${composition.format}:${composition.source}:${epoch}`}
        style={{ minWidth: 0 }}
      >
        <CompositionRuntime composition={composition} />
      </div>
    </CompositionResetContext.Provider>
  );
}
function CompositionRuntime({ composition }: { composition: Composition }) {
  if (composition.format === "openui")
    return <HydratedOpenUI source={composition.source} />;
  const spec = parseSpec(composition.source);
  return (
    <JSONUIProvider
      registry={registry}
      functions={functions}
      initialState={spec.state ?? {}}
    >
      <JsonRenderer spec={spec} registry={registry} />
    </JSONUIProvider>
  );
}
export function ComposedReply({
  attributes,
  message,
}: PluginMessageDirectiveProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [content, set] = useState<Composition | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    set(null);
    setError(null);
    rpc
      .call("read", {
        threadId: message.threadId,
        id: idSchema.parse(attributes.id),
      })
      .then((input) => {
        if (!cancelled) set(parseComposition(input));
      })
      .catch((cause) => {
        if (!cancelled) setError(String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [attributes.id, message.threadId, rpc]);
  return (
    <div
      style={{
        width: "100%",
        minWidth: 0,
        color: "var(--foreground)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {error ? (
        <p role="alert">Composition unavailable: {error}</p>
      ) : content ? (
        <CompositionBoundary key={attributes.id}>
          <CompositionView composition={content} />
        </CompositionBoundary>
      ) : (
        <span role="status">Loading visual...</span>
      )}
    </div>
  );
}
export default definePluginApp((app) => {
  app.slots.messageDirective({
    id: "composed-reply",
    component: ComposedReply,
  });
});
