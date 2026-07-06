declare module "@earendil-works/pi-coding-agent" {
  import type { TSchema } from "typebox";

  export interface ToolResultContent {
    readonly type: "text";
    readonly text: string;
  }

  export interface AgentToolResult<TDetails = unknown> {
    readonly content: readonly ToolResultContent[];
    readonly details?: TDetails;
    readonly isError?: boolean;
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

  export interface ExtensionUIContext {
    notify(message: string, type?: "info" | "warning" | "error"): void;
    setWidget(key: string, content: string[] | undefined, options?: { placement?: "aboveEditor" | "belowEditor" }): void;
  }

  export interface ExtensionContext {
    readonly ui: ExtensionUIContext;
    readonly cwd: string;
    readonly model: unknown;
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
    on(event: "session_start" | "session_shutdown", handler: (event: unknown, ctx: ExtensionContext) => void): void;
    getActiveTools(): string[];
    setActiveTools(names: string[]): void;
    sendMessage<T = unknown>(
      message: {
        readonly customType: string;
        readonly content: string;
        readonly display: boolean;
        readonly details?: T;
      },
      options?: { readonly triggerTurn?: boolean; readonly deliverAs?: "steer" | "followUp" | "nextTurn" },
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
    getSessionStats(): { readonly tokens: { readonly output: number } };
  }

  export function createAgentSession(options: {
    readonly cwd: string;
    readonly agentDir: string;
    readonly sessionManager: SessionManager;
    readonly settingsManager: SettingsManager;
    readonly customTools: ToolDefinition[];
    readonly model?: unknown;
  }): Promise<{ readonly session: AgentSession }>;
}
