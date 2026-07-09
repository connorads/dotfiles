declare module "@earendil-works/pi-coding-agent" {
  import type { TSchema } from "typebox";

  export interface ToolResultContent {
    readonly type: "text";
    readonly text: string;
  }

  export interface AgentToolResult<TDetails = unknown> {
    readonly content: readonly ToolResultContent[];
    readonly details?: TDetails;
    /** Batch-level hint: end the turn when every finalised result in the batch is terminating. */
    readonly terminate?: boolean;
  }

  export type AgentToolUpdateCallback<TDetails = unknown> = (details: TDetails) => void;

  export interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown> {
    readonly name: string;
    readonly label: string;
    readonly description: string;
    readonly promptSnippet?: string;
    readonly promptGuidelines?: readonly string[];
    readonly parameters: TParams;
    readonly executionMode?: "sequential" | "parallel";
    execute(
      toolCallId: string,
      params: unknown,
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<TDetails>>;
  }

  export function defineTool<TParams extends TSchema, TDetails = unknown>(
    tool: ToolDefinition<TParams, TDetails>,
  ): ToolDefinition<TParams, TDetails>;

  export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

  /** Subset of the registry's Model shape used for agent model selection. */
  export interface Model {
    readonly id: string;
    readonly name: string;
    readonly provider: string;
  }

  export interface ModelRegistry {
    find(provider: string, modelId: string): Model | undefined;
    getAvailable(): Model[];
  }

  /** Progress events carry more fields upstream; only `type` is consumed here. */
  export interface AgentSessionEvent {
    readonly type: string;
  }

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

  export interface TurnEndEvent {
    readonly type: "turn_end";
    readonly toolResults: readonly unknown[];
  }

  export interface AgentEndEvent {
    readonly type: "agent_end";
    readonly messages: readonly unknown[];
  }

  export interface SessionShutdownEvent {
    readonly type: "session_shutdown";
    readonly reason?: string;
  }

  export interface ExtensionUIContext {
    notify(message: string, type?: "info" | "warning" | "error"): void;
    select(title: string, options: string[]): Promise<string | undefined>;
    setWidget(key: string, content: string[] | undefined, options?: { placement?: "aboveEditor" | "belowEditor" }): void;
    confirm(title: string, message: string): Promise<boolean>;
  }

  export interface ExtensionContext {
    readonly ui: ExtensionUIContext;
    readonly cwd: string;
    readonly model: Model | undefined;
    readonly modelRegistry: ModelRegistry;
    readonly hasUI: boolean;
  }

  export interface ExtensionAPI {
    registerTool(tool: ToolDefinition): void;
    registerCommand(
      name: string,
      options: {
        readonly description?: string;
        readonly handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
      },
    ): void;
    on(event: "session_start", handler: (event: unknown, ctx: ExtensionContext) => void | Promise<void>): void;
    on(
      event: "session_shutdown",
      handler: (event: SessionShutdownEvent, ctx: ExtensionContext) => void | Promise<void>,
    ): void;
    on(
      event: "tool_call",
      handler: (
        event: ToolCallEvent,
        ctx: ExtensionContext,
      ) => ToolCallEventResult | void | Promise<ToolCallEventResult | void>,
    ): void;
    on(event: "turn_end", handler: (event: TurnEndEvent, ctx: ExtensionContext) => void | Promise<void>): void;
    on(event: "agent_end", handler: (event: AgentEndEvent, ctx: ExtensionContext) => void | Promise<void>): void;
    getActiveTools(): string[];
    setActiveTools(names: string[]): Promise<void>;
    sendMessage<T = unknown>(
      message: {
        readonly customType: string;
        readonly content: string;
        readonly display: boolean;
        readonly details?: T;
      },
      options?: { readonly triggerTurn?: boolean; readonly deliverAs?: "steer" | "followUp" | "nextTurn" },
    ): void;
    sendUserMessage(
      content: string,
      options?: { readonly deliverAs?: "steer" | "followUp" },
    ): void;
  }

  export interface ExtensionCommandContext extends ExtensionContext {}

  export function getAgentDir(): string;
  export function createCodingTools(cwd: string): ToolDefinition[];

  export class SessionManager {
    static inMemory(): SessionManager;
  }

  export class SettingsManager {
    static create(cwd: string, agentDir: string): SettingsManager;
  }

  export interface AgentSession {
    readonly messages: readonly unknown[];
    prompt(text: string): Promise<void>;
    abort(): Promise<void>;
    dispose(): void;
    setActiveToolsByName(names: string[]): void;
    getActiveToolNames(): string[];
    getSessionStats(): { readonly tokens: { readonly output: number } };
    subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  }

  export function createAgentSession(options: {
    readonly cwd: string;
    readonly agentDir: string;
    readonly sessionManager?: SessionManager;
    readonly settingsManager?: SettingsManager;
    readonly customTools?: ToolDefinition[];
    readonly tools?: readonly string[];
    readonly model?: Model;
    readonly thinkingLevel?: ThinkingLevel;
  }): Promise<{ readonly session: AgentSession }>;
}
