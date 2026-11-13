import { join } from 'node:path';
import { ARTIFACT_CONNECTOR, type Artifacts } from './artifacts.ts';
import { ConnectorSession, HttpError, listConnectors, type Connector, type FetchLike, type Tool } from './mcp.ts';
import { accessFor, type Access, type Overrides } from './policy.ts';
import { CONNECTOR_SCOPE, keychainService, needsRefresh, parseToken, type Token } from './token.ts';

export type Run = (file: string, args: string[], options: { env?: NodeJS.ProcessEnv; timeoutMs: number }) => Promise<string>;
export type ListDir = (path: string) => Promise<string[]>;

export type Deps = {
  artifacts?: Artifacts;
  run: Run;
  listDir: ListDir;
  fetch: FetchLike;
  now: () => number;
  /** Absolute directory holding one CLAUDE_CONFIG_DIR per profile. */
  profilesRoot: string;
  claudePath: () => string;
  user: string;
};

export class UserFacingError extends Error {}

const TTL_MS = 10 * 60_000;
// Variables that make Claude Code skip the profile's claude.ai login or its connectors.
const SCRUB = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDECODE', 'CLAUDE_CONFIG_DIR', 'ENABLE_CLAUDEAI_MCP_SERVERS'];

type Cached<T> = { value: T; at: number };

export type ToolView = { name: string; description: string; readOnly: boolean; access: Access; inputSchema?: Record<string, unknown> };

export class ConnectorService {
  readonly #tokens = new Map<string, Token>();
  readonly #refreshing = new Map<string, Promise<Token>>();
  readonly #connectors = new Map<string, Cached<Connector[]>>();
  readonly #tools = new Map<string, Cached<Tool[]>>();
  readonly #sessions = new Map<string, ConnectorSession>();

  private readonly deps: Deps;
  constructor(deps: Deps) { this.deps = deps; }

  configDir(profile: string): string { return join(this.deps.profilesRoot, profile); }

  async profiles(): Promise<string[]> {
    const names = await this.deps.listDir(this.deps.profilesRoot).catch(() => []);
    return names.filter(n => !n.startsWith('.')).sort();
  }

  async #readKeychain(profile: string): Promise<Token> {
    let raw: string;
    try {
      raw = await this.deps.run('/usr/bin/security',
        ['find-generic-password', '-s', keychainService(this.configDir(profile)), '-a', this.deps.user, '-w'], { timeoutMs: 10_000 });
    } catch {
      throw new UserFacingError(`No Claude Code login found for profile "${profile}". Sign in with Claude Code in that profile first.`);
    }
    const token = parseToken(raw);
    if (!token.scopes.includes(CONNECTOR_SCOPE))
      throw new UserFacingError(`Profile "${profile}" is signed in without claude.ai connector access (${CONNECTOR_SCOPE}). Use a full claude.ai login, not setup-token or an API key.`);
    return token;
  }

  /** Lets the unmodified Claude Code binary refresh its own login; no model request is made. */
  async #refresh(profile: string): Promise<Token> {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of SCRUB) delete env[key];
    env.CLAUDE_CONFIG_DIR = this.configDir(profile);
    await this.deps.run(this.deps.claudePath(), ['mcp', 'list'], { env, timeoutMs: 120_000 }).catch(() => '');
    return this.#readKeychain(profile);
  }

  async token(profile: string, force = false): Promise<string> {
    const now = this.deps.now();
    const cached = this.#tokens.get(profile);
    if (!force && cached && !needsRefresh(cached, now)) return cached.accessToken;
    let pending = this.#refreshing.get(profile);
    if (!pending) {
      pending = (async () => {
        let token = await this.#readKeychain(profile);
        if (force || needsRefresh(token, this.deps.now())) token = await this.#refresh(profile);
        if (token.expiresAt <= this.deps.now())
          throw new UserFacingError(`The "${profile}" login has expired and Claude Code did not renew it. Open Claude Code in that profile once.`);
        this.#tokens.set(profile, token);
        return token;
      })().finally(() => this.#refreshing.delete(profile));
      this.#refreshing.set(profile, pending);
    }
    return (await pending).accessToken;
  }

  /** Retries once with a renewed token on 401. Safe: a 401 means nothing ran. */
  async #authed<T>(profile: string, run: () => Promise<T>): Promise<T> {
    try { return await run(); } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 401) throw error;
      await this.token(profile, true);
      return run();
    }
  }

  async connectors(profile: string, signal?: AbortSignal): Promise<Connector[]> {
    const hit = this.#connectors.get(profile);
    if (hit && this.deps.now() - hit.at < TTL_MS) return hit.value;
    const value = await this.#authed(profile, async () => listConnectors(this.deps.fetch, await this.token(profile), signal));
    if (this.deps.artifacts) value.push(ARTIFACT_CONNECTOR);
    this.#connectors.set(profile, { value, at: this.deps.now() });
    return value;
  }

  async connector(profile: string, nameOrId: string, signal?: AbortSignal): Promise<Connector> {
    const wanted = nameOrId.trim().toLowerCase();
    if (this.deps.artifacts && (wanted === ARTIFACT_CONNECTOR.id || wanted === ARTIFACT_CONNECTOR.name.toLowerCase()))
      return ARTIFACT_CONNECTOR;
    const all = await this.connectors(profile, signal);
    const found = all.find(c => c.id === nameOrId || c.name.toLowerCase() === wanted);
    if (!found) throw new UserFacingError(`No connector "${nameOrId}" in profile "${profile}". Available: ${all.map(c => c.name).join(', ')}.`);
    return found;
  }

  #session(profile: string, connector: Connector): ConnectorSession {
    const key = `${profile}\u0000${connector.id}`;
    let session = this.#sessions.get(key);
    if (!session) {
      session = new ConnectorSession(this.deps.fetch, connector.id, () => this.token(profile));
      this.#sessions.set(key, session);
    }
    return session;
  }

  async tools(profile: string, connector: Connector, signal?: AbortSignal): Promise<Tool[]> {
    const key = `${profile}\u0000${connector.id}`;
    const hit = this.#tools.get(key);
    if (hit && this.deps.now() - hit.at < TTL_MS) return hit.value;
    const value = connector.id === ARTIFACT_CONNECTOR.id && this.deps.artifacts
      ? await this.deps.artifacts.tools(profile, signal)
      : await this.#authed(profile, () => this.#session(profile, connector).listTools(signal));
    this.#tools.set(key, { value, at: this.deps.now() });
    return value;
  }

  async toolViews({ profile, connector, overrides, withSchema, signal }:
    { profile: string; connector: Connector; overrides: Overrides; withSchema: boolean; signal?: AbortSignal }): Promise<ToolView[]> {
    return (await this.tools(profile, connector, signal)).map(t => ({
      name: t.name,
      description: (t.description ?? '').slice(0, 300),
      readOnly: t.annotations?.readOnlyHint === true,
      access: accessFor(connector.name, t, overrides),
      ...(withSchema && t.inputSchema ? { inputSchema: t.inputSchema } : {}),
    }));
  }

  async call({ profile, connector: connectorName, tool: toolName, args, overrides, signal }:
    { profile: string; connector: string; tool: string; args: Record<string, unknown>; overrides: Overrides; signal?: AbortSignal }): Promise<unknown> {
    const connector = await this.connector(profile, connectorName, signal);
    const tool = (await this.tools(profile, connector, signal)).find(t => t.name === toolName);
    if (!tool) throw new UserFacingError(`${connector.name} has no tool "${toolName}". Call claude_connectors_list with this connector to see its tools.`);
    if (accessFor(connector.name, tool, overrides) !== 'allow')
      throw new UserFacingError(`${connector.name}/${toolName} is turned off in Claude Connectors. Ask the person to allow it: bb claude-connectors allow "${connector.name}" ${toolName}`);
    if (connector.id === ARTIFACT_CONNECTOR.id && this.deps.artifacts)
      return this.deps.artifacts.call({ profile, tool: toolName, args, signal });
    return this.#authed(profile, () => this.#session(profile, connector).callTool(toolName, args, signal));
  }
}
