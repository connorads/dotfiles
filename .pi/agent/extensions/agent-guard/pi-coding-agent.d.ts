// Ambient shim for the pi extension host API (install-free convention, as in
// ../workflows). Only the tool_call surface this extension uses is declared.
declare module "@earendil-works/pi-coding-agent" {
  export interface ToolCallEvent {
    readonly type: "tool_call";
    readonly toolCallId: string;
    readonly toolName: string;
    readonly input: Record<string, unknown>;
  }

  export interface ToolCallEventResult {
    readonly block?: boolean;
    readonly reason?: string;
  }

  export interface ExtensionContext {
    readonly cwd: string;
  }

  export interface ExtensionAPI {
    on(
      event: "tool_call",
      handler: (
        event: ToolCallEvent,
        ctx: ExtensionContext,
      ) => ToolCallEventResult | void | Promise<ToolCallEventResult | void>,
    ): void;
  }
}
