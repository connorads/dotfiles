import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const API_BASE = 'https://api.anthropic.com';
export const PROXY_BASE = 'https://mcp-proxy.anthropic.com/v1/mcp';
const USER_AGENT = 'bb-claude-connectors/0.1';
const PROTOCOL = '2025-06-18';

export type FetchLike = typeof fetch;

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const serverList = z.object({
  data: z.array(z.object({ id: z.string(), display_name: z.string() }).passthrough()),
});
export type Connector = { id: string; name: string };

export async function listConnectors(fetchFn: FetchLike, token: string, signal?: AbortSignal): Promise<Connector[]> {
  const res = await fetchFn(`${API_BASE}/v1/mcp_servers?limit=1000`, {
    signal,
    headers: {
      Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT,
      'anthropic-beta': 'mcp-servers-2025-12-04', 'anthropic-version': '2023-06-01',
    },
  });
  if (!res.ok) throw new HttpError(res.status, `Listing connectors failed with HTTP ${res.status}.`);
  return serverList.parse(await res.json()).data.map(s => ({ id: s.id, name: s.display_name }));
}

/** Streamable HTTP replies with JSON or an SSE stream; returns the JSON-RPC message for `id`. */
export function parseRpcBody(body: string, id: number): unknown {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const message = JSON.parse(line.slice(5).trim()) as { id?: unknown };
    if (message.id === id) return message;
  }
  throw new Error('The connector reply had no result.');
}

const rpcReply = z.object({
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).passthrough().optional(),
}).passthrough();

export const toolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  annotations: z.object({ readOnlyHint: z.boolean().optional(), destructiveHint: z.boolean().optional() }).passthrough().optional(),
}).passthrough();
export type Tool = z.infer<typeof toolSchema>;

/** One MCP session with one connector through Anthropic's proxy. */
export class ConnectorSession {
  #sessionId: string | null = null;
  #ready: Promise<void> | null = null;
  #nextId = 1;
  readonly #clientSession = randomUUID();

  private readonly fetchFn: FetchLike;
  private readonly connectorId: string;
  private readonly token: () => Promise<string>;

  constructor(fetchFn: FetchLike, connectorId: string, token: () => Promise<string>) {
    this.fetchFn = fetchFn; this.connectorId = connectorId; this.token = token;
  }

  async #post(message: Record<string, unknown>, signal?: AbortSignal): Promise<{ status: number; body: string }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.token()}`, 'User-Agent': USER_AGENT,
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      'X-Mcp-Client-Session-Id': this.#clientSession,
    };
    if (this.#sessionId) headers['Mcp-Session-Id'] = this.#sessionId;
    const res = await this.fetchFn(`${PROXY_BASE}/${encodeURIComponent(this.connectorId)}`, {
      method: 'POST', headers, body: JSON.stringify(message), signal,
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.#sessionId = sid;
    return { status: res.status, body: await res.text() };
  }

  async #request(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const id = this.#nextId++;
    const { status, body } = await this.#post({ jsonrpc: '2.0', id, method, params }, signal);
    if (status >= 400) throw new HttpError(status, `${method} failed with HTTP ${status}: ${body.slice(0, 200)}`);
    const reply = rpcReply.parse(parseRpcBody(body, id));
    if (reply.error) throw new Error(`${method} failed: ${reply.error.message}`);
    return reply.result;
  }

  #initialise(signal?: AbortSignal): Promise<void> {
    this.#ready ??= (async () => {
      await this.#request('initialize', {
        protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'bb-claude-connectors', version: '0.1.0' },
      }, signal);
      await this.#post({ jsonrpc: '2.0', method: 'notifications/initialized' }, signal);
    })().catch((error: unknown) => { this.#ready = null; throw error; });
    return this.#ready;
  }

  /** Retries once on a fresh session when the proxy forgets this one. */
  async #withSession<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.#initialise(signal);
    try { return await run(); } catch (error) {
      if (!(error instanceof HttpError) || (error.status !== 404 && error.status !== 400)) throw error;
      this.#sessionId = null; this.#ready = null;
      await this.#initialise(signal);
      return run();
    }
  }

  async listTools(signal?: AbortSignal): Promise<Tool[]> {
    return this.#withSession(async () => {
      const result = z.object({ tools: z.array(toolSchema) }).parse(await this.#request('tools/list', {}, signal));
      return result.tools;
    }, signal);
  }

  /** Not retried after a session reset that happens mid-call: a retry could repeat a side effect. */
  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    await this.#initialise(signal);
    return this.#request('tools/call', { name, arguments: args }, signal);
  }
}
