import {
  Client,
  SdkError,
  SdkHttpError,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/client";
import type { ExecutorConfig } from "./config.ts";

type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

/** Executor caps one program at 5 minutes; leave room for the round trip. */
export const CALL_TIMEOUT_MS = 330_000;
const CONNECT_TIMEOUT_MS = 10_000;
const LIST_TIMEOUT_MS = 10_000;

export class CallCancelledError extends Error {
  constructor() {
    super("Cancelled before Executor answered. Earlier tool calls in the program may already have run.");
  }
}

/**
 * One lazily connected MCP client for an Executor endpoint. A failed
 * connection is dropped and the next call builds a fresh transport, since a
 * started transport cannot be restarted.
 */
export class ExecutorConnection {
  readonly #config: ExecutorConfig;
  readonly #fetch: FetchLike | undefined;
  #client: Promise<Client> | undefined;

  constructor(config: ExecutorConfig, options: { fetch?: FetchLike } = {}) {
    this.#config = config;
    this.#fetch = options.fetch;
  }

  async listTools(): Promise<Tool[]> {
    const client = await this.#connected();
    const { tools } = await client.listTools(undefined, { timeout: LIST_TIMEOUT_MS });
    return tools;
  }

  async instructions(): Promise<string | undefined> {
    return (await this.#connected()).getInstructions();
  }

  /**
   * Never retried after it reaches the server: a dropped stream cancels the
   * program, and a blind retry could repeat its side effects. The one retry
   * is a legacy session expiry (HTTP 404), where the server ran nothing.
   */
  async callTool(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<CallToolResult> {
    try {
      return await this.#call(name, args, signal);
    } catch (error) {
      if (signal.aborted) throw new CallCancelledError();
      if (error instanceof SdkHttpError && error.status === 404) {
        this.#drop();
        return await this.#call(name, args, signal);
      }
      if (error instanceof SdkError && error.code !== "REQUEST_TIMEOUT") this.#drop();
      throw error;
    }
  }

  async close(): Promise<void> {
    const client = this.#client;
    this.#client = undefined;
    await client?.then((c) => c.close(), () => undefined);
  }

  async #call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<CallToolResult> {
    const client = await this.#connected();
    const result = await client.callTool(
      { name, arguments: args },
      { signal, timeout: CALL_TIMEOUT_MS, maxTotalTimeout: CALL_TIMEOUT_MS },
    );
    return result as CallToolResult;
  }

  #connected(): Promise<Client> {
    this.#client ??= this.#connect().catch((error: unknown) => {
      this.#client = undefined;
      throw error;
    });
    return this.#client;
  }

  async #connect(): Promise<Client> {
    const client = new Client(
      { name: "bb-plugin-executor", version: "0.1.0" },
      { versionNegotiation: { mode: "auto" }, capabilities: {} },
    );
    client.onclose = () => this.#drop();
    const token = this.#config.token;
    const transport = new StreamableHTTPClientTransport(this.#config.url, {
      authProvider: { token: async () => token },
      ...(this.#fetch ? { fetch: this.#fetch } : {}),
    });
    await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
    return client;
  }

  #drop(): void {
    const client = this.#client;
    this.#client = undefined;
    void client?.then((c) => c.close(), () => undefined);
  }
}
