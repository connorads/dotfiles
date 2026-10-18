import { UnauthorizedError, type CallToolResult, type Tool } from "@modelcontextprotocol/client";
import type { StateView } from "../contracts.ts";
import { ExecutorConnection } from "./connection.ts";
import { ConnectionSchema, parseConnectionUrl, resolveChoice, slugFor, type Connection, type ThreadChoice } from "./connections.ts";
import type { CredentialStore } from "./credentials.ts";
import {
  discover, exchangeCode, OAuthError, pollDevice, readCallback, refresh, registerClient, revoke, startBrowser, startDevice,
  type DeviceStart, type Endpoints, type FetchLike, type SignInMethod, type Tokens,
} from "./oauth.ts";

type Kv = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
};

export type ToolCache = { tools: Tool[]; instructions: string | null };

export type ServiceDeps = {
  kv: Kv;
  credentials: CredentialStore;
  fetch: FetchLike;
  log: { info(message: string): void; warn(message: string): void };
  /** Tells windows to refetch state. */
  changed(): void;
  /** Runs when the tool list is first known or changes shape. */
  toolsChanged(cache: ToolCache): void;
  /** Where the browser returns after sign-in: BB's own loopback route. */
  callbackUrl(): string;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

/** An error whose message is written for the agent or the person. */
export class UserFacingError extends Error {}

const REFRESH_MARGIN_MS = 60_000;
const THREAD_PREFIX = "thread:";

/** A browser sign-in waits for its callback; a device sign-in polls. Both expire. */
type SignIn =
  | { kind: "device"; start: DeviceStart; controller: AbortController }
  | {
      kind: "browser";
      url: string;
      state: string;
      verifier: string;
      redirectUri: string;
      clientId: string;
      endpoints: Endpoints;
      expiresAt: number;
      controller: AbortController;
    };

const BROWSER_SIGN_IN_MS = 10 * 60_000;

export class ExecutorService {
  readonly #deps: ServiceDeps;
  readonly #now: () => number;
  #connections: Connection[];
  #defaultId: string | null;
  readonly #choices: Map<string, ThreadChoice>;
  #signedIn: Set<string>;
  #tools: ToolCache | null;
  readonly #signIns = new Map<string, SignIn>();
  readonly #errors = new Map<string, string>();
  readonly #endpoints = new Map<string, Promise<Endpoints>>();
  readonly #clients = new Map<string, ExecutorConnection>();
  readonly #refreshing = new Map<string, Promise<string>>();

  private constructor(deps: ServiceDeps, loaded: {
    connections: Connection[];
    defaultId: string | null;
    choices: Map<string, ThreadChoice>;
    signedIn: Set<string>;
    tools: ToolCache | null;
  }) {
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
    this.#connections = loaded.connections;
    this.#defaultId = loaded.defaultId;
    this.#choices = loaded.choices;
    this.#signedIn = loaded.signedIn;
    this.#tools = loaded.tools;
  }

  static async load(deps: ServiceDeps): Promise<ExecutorService> {
    const stored = (await deps.kv.get<unknown[]>("connections")) ?? [];
    const connections = stored.flatMap((c) => {
      const parsed = ConnectionSchema.safeParse(c);
      return parsed.success ? [parsed.data] : [];
    });
    const defaultId = (await deps.kv.get<string>("default")) ?? null;
    const choices = new Map<string, ThreadChoice>();
    for (const key of await deps.kv.list(THREAD_PREFIX)) {
      const choice = await deps.kv.get<ThreadChoice>(key);
      if (choice) choices.set(key.slice(THREAD_PREFIX.length), choice);
    }
    const vault = await deps.credentials.snapshot();
    const signedIn = new Set(Object.keys(vault.grants).filter((id) => connections.some((c) => c.id === id)));
    const tools = (await deps.kv.get<ToolCache>("tools")) ?? null;
    return new ExecutorService(deps, { connections, defaultId, choices, signedIn, tools });
  }

  get tools(): ToolCache | null {
    return this.#tools;
  }

  /** Synchronous: `bb.agents.configure` cannot await. */
  choiceFor(threadId: string): ThreadChoice {
    return this.#choices.get(threadId) ?? { kind: "default" };
  }

  state(): StateView {
    return {
      connections: this.#connections.map((c) => ({
        id: c.id,
        name: c.name,
        url: c.url,
        status: this.#signIns.has(c.id) ? "signing-in" : this.#signedIn.has(c.id) ? "signed-in" : "signed-out",
        isDefault: c.id === this.#defaultId,
      })),
      signIns: [...this.#signIns].map(([id, pending]) =>
        pending.kind === "browser"
          ? { kind: "browser" as const, id, url: pending.url, expiresAt: pending.expiresAt }
          : {
              kind: "device" as const,
              id,
              userCode: pending.start.userCode,
              verificationUri: pending.start.verificationUri,
              verificationUriComplete: pending.start.verificationUriComplete ?? null,
              expiresAt: pending.start.expiresAt,
            }),
      errors: Object.fromEntries(this.#errors),
      toolsReady: this.#tools !== null,
    };
  }

  async add(name: string, rawUrl: string): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
    const parsed = parseConnectionUrl(rawUrl);
    if (!parsed.ok) return parsed;
    if (this.#connections.some((c) => c.url === parsed.url.href)) {
      return { ok: false, message: "That connection is already added." };
    }
    const id = slugFor(name, new Set(this.#connections.map((c) => c.id)));
    this.#connections = [...this.#connections, { id, name: name.trim(), url: parsed.url.href }];
    await this.#deps.kv.set("connections", this.#connections);
    if (this.#defaultId === null) await this.setDefault(id);
    this.#deps.changed();
    return { ok: true, id };
  }

  async remove(id: string): Promise<void> {
    await this.signOut(id);
    this.#connections = this.#connections.filter((c) => c.id !== id);
    await this.#deps.kv.set("connections", this.#connections);
    if (this.#defaultId === id) {
      this.#defaultId = this.#connections[0]?.id ?? null;
      await this.#saveDefault();
    }
    this.#errors.delete(id);
    this.#deps.changed();
  }

  async setDefault(id: string): Promise<void> {
    if (!this.#connections.some((c) => c.id === id)) throw new UserFacingError("No such connection.");
    this.#defaultId = id;
    await this.#saveDefault();
    this.#deps.changed();
  }

  async setThreadChoice(threadId: string, choice: ThreadChoice): Promise<void> {
    if (choice.kind === "connection" && !this.#connections.some((c) => c.id === choice.id)) {
      throw new UserFacingError("No such connection.");
    }
    if (choice.kind === "default") {
      this.#choices.delete(threadId);
      await this.#deps.kv.delete(THREAD_PREFIX + threadId);
    } else {
      this.#choices.set(threadId, choice);
      await this.#deps.kv.set(THREAD_PREFIX + threadId, choice);
    }
  }

  /**
   * Starts a sign-in; progress and the result arrive through `state`.
   * Browser sign-in returns to BB's loopback route; a code works when BB runs
   * on another machine, if the server lets apps start one.
   */
  async signIn(id: string, method: "browser" | "device"): Promise<void> {
    const connection = this.#require(id);
    this.cancelSignIn(id);
    this.#errors.delete(id);
    try {
      const endpoints = await this.#endpointsFor(connection);
      const controller = new AbortController();
      if (method === "browser") {
        const redirectUri = this.#deps.callbackUrl();
        const clientId = await this.#clientFor(endpoints, { kind: "browser", redirectUri });
        const start = startBrowser(endpoints, clientId, redirectUri);
        const expiresAt = this.#now() + BROWSER_SIGN_IN_MS;
        this.#signIns.set(id, { kind: "browser", ...start, redirectUri, clientId, endpoints, expiresAt, controller });
        const timer = setTimeout(() => this.#expire(id, controller), BROWSER_SIGN_IN_MS);
        controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
      } else {
        const { clientId, start } = await this.#startDevice(endpoints);
        this.#signIns.set(id, { kind: "device", start, controller });
        void this.#finishDevice(connection, { endpoints, clientId, start, controller });
      }
      this.#deps.changed();
    } catch (error) {
      const hint = method === "device" && error instanceof OAuthError && error.kind === "unsupported" ? " Use Sign in instead." : "";
      this.#errors.set(id, describe(error) + hint);
      this.#deps.changed();
    }
  }

  /**
   * The browser came back to BB. Each `state` works once. The token exchange
   * runs after the route answers, so the page never waits on the vault.
   */
  completeBrowserSignIn(params: URLSearchParams): { ok: true; name: string } | { ok: false; message: string } {
    const entry = [...this.#signIns].find(([, p]) => p.kind === "browser" && p.state === params.get("state"));
    if (!entry || entry[1].kind !== "browser") return { ok: false, message: "This sign-in link is no longer valid. Start again from BB." };
    const [id, pending] = entry;
    const connection = this.#require(id);
    pending.controller.abort();
    this.#signIns.delete(id);
    let code: string;
    try {
      ({ code } = readCallback(pending.endpoints, params));
    } catch (error) {
      this.#errors.set(id, describe(error));
      this.#deps.changed();
      return { ok: false, message: describe(error) };
    }
    this.#deps.changed();
    void exchangeCode(pending.endpoints, { clientId: pending.clientId, code, redirectUri: pending.redirectUri, verifier: pending.verifier }, this.#deps.fetch, this.#now())
      .then((tokens) => this.#signedInWith(connection, pending.endpoints, pending.clientId, tokens))
      .catch((error: unknown) => {
        this.#errors.set(id, describe(error));
        this.#deps.changed();
      });
    return { ok: true, name: connection.name };
  }

  cancelSignIn(id: string): void {
    const pending = this.#signIns.get(id);
    if (!pending) return;
    pending.controller.abort();
    this.#signIns.delete(id);
    this.#deps.changed();
  }

  async signOut(id: string): Promise<void> {
    this.cancelSignIn(id);
    const connection = this.#connections.find((c) => c.id === id);
    const grant = await this.#deps.credentials.update((vault) => {
      const removed = vault.grants[id];
      delete vault.grants[id];
      return removed;
    });
    this.#signedIn.delete(id);
    await this.#dropClient(id);
    this.#deps.changed();
    if (grant && connection) {
      const endpoints = await this.#endpointsFor(connection).catch(() => null);
      if (endpoints) await revoke(endpoints, grant.clientId, grant.refreshToken, this.#deps.fetch);
    }
  }

  async call(threadId: string, tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<CallToolResult> {
    const connection = this.#connectionForThread(threadId);
    try {
      return await this.#client(connection).callTool(tool, args, signal);
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) throw error;
    }
    // A 401 means Executor ran nothing, so refresh the token and try once more.
    await this.#expireAccessToken(connection.id);
    try {
      return await this.#client(connection).callTool(tool, args, signal);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        throw new UserFacingError(`Executor rejected the sign-in for "${connection.name}". Sign in again from Settings → Executor.`);
      }
      throw error;
    }
  }

  /** Reads the tool list from a signed-in connection, preferring the default. */
  async refreshTools(): Promise<void> {
    const candidates = this.#connections
      .filter((c) => this.#signedIn.has(c.id))
      .sort((a, b) => Number(b.id === this.#defaultId) - Number(a.id === this.#defaultId));
    const connection = candidates[0];
    if (!connection) return;
    const client = this.#client(connection);
    const cache: ToolCache = { tools: await client.listTools(), instructions: (await client.instructions()) ?? null };
    const before = this.#tools?.tools.map((t) => t.name).join(",");
    await this.#deps.kv.set("tools", cache);
    this.#tools = cache;
    if (before !== cache.tools.map((t) => t.name).join(",")) this.#deps.toolsChanged(cache);
  }

  async close(): Promise<void> {
    for (const { controller } of this.#signIns.values()) controller.abort();
    this.#signIns.clear();
    await Promise.all([...this.#clients.values()].map((c) => c.close()));
    this.#clients.clear();
  }

  #connectionForThread(threadId: string): Connection {
    const resolved = resolveChoice(this.choiceFor(threadId), this.#defaultId, this.#connections);
    if (resolved.kind === "off") {
      throw new UserFacingError("Executor is off for this thread. Turn it on from the Executor chip (Alt+E).");
    }
    if (resolved.kind === "unset") {
      throw new UserFacingError("No Executor connection is set up. Add one in Settings → Executor.");
    }
    if (!this.#signedIn.has(resolved.connection.id)) {
      throw new UserFacingError(`Executor connection "${resolved.connection.name}" is signed out. Sign in from Settings → Executor.`);
    }
    return resolved.connection;
  }

  async #finishDevice(
    connection: Connection,
    { endpoints, clientId, start, controller }: { endpoints: Endpoints; clientId: string; start: DeviceStart; controller: AbortController },
  ) {
    try {
      const tokens = await pollDevice(endpoints, clientId, start, {
        fetch: this.#deps.fetch,
        signal: controller.signal,
        now: this.#now,
        ...(this.#deps.sleep ? { sleep: this.#deps.sleep } : {}),
      });
      this.#signIns.delete(connection.id);
      await this.#signedInWith(connection, endpoints, clientId, tokens);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.#signIns.delete(connection.id);
      this.#errors.set(connection.id, describe(error));
      this.#deps.changed();
    }
  }

  async #signedInWith(connection: Connection, endpoints: Endpoints, clientId: string, tokens: Tokens): Promise<void> {
    await this.#deps.credentials.update((vault) => {
      vault.grants[connection.id] = { issuer: endpoints.issuer, clientId, ...tokens };
    });
    this.#signedIn.add(connection.id);
    await this.#dropClient(connection.id);
    this.#deps.changed();
    this.#deps.log.info(`signed in to ${connection.name}`);
    if (this.#tools === null) await this.refreshTools().catch((e: unknown) => this.#deps.log.warn(`tool list: ${describe(e)}`));
  }

  #expire(id: string, controller: AbortController): void {
    if (this.#signIns.get(id)?.controller !== controller) return;
    this.#signIns.delete(id);
    this.#errors.set(id, "The sign-in expired. Start again.");
    this.#deps.changed();
  }

  async #accessToken(id: string): Promise<string> {
    const grant = (await this.#deps.credentials.snapshot()).grants[id];
    if (!grant) throw new UserFacingError("This connection is signed out.");
    if (grant.expiresAt - REFRESH_MARGIN_MS > this.#now()) return grant.accessToken;
    let pending = this.#refreshing.get(id);
    if (!pending) {
      pending = this.#refreshGrant(id).finally(() => this.#refreshing.delete(id));
      this.#refreshing.set(id, pending);
    }
    return pending;
  }

  /** Inside the vault queue, so a rotated refresh token is saved before anyone reads it. */
  async #refreshGrant(id: string): Promise<string> {
    const connection = this.#require(id);
    type Outcome = { token: string } | { error: unknown };
    const outcome = await this.#deps.credentials.update(async (vault): Promise<Outcome> => {
      const grant = vault.grants[id];
      if (!grant) return { error: new UserFacingError("This connection is signed out.") };
      if (grant.expiresAt - REFRESH_MARGIN_MS > this.#now()) return { token: grant.accessToken };
      try {
        const endpoints = await this.#endpointsFor(connection);
        const tokens = await refresh(endpoints, grant, this.#deps.fetch, this.#now());
        vault.grants[id] = { ...grant, ...tokens };
        return { token: tokens.accessToken };
      } catch (error) {
        if (error instanceof OAuthError && error.kind === "invalid-grant") delete vault.grants[id];
        return { error };
      }
    });
    if ("token" in outcome) return outcome.token;
    if (outcome.error instanceof OAuthError && outcome.error.kind === "invalid-grant") {
      this.#signedIn.delete(id);
      this.#errors.set(id, outcome.error.message);
      this.#deps.changed();
      throw new UserFacingError(`Executor ended the sign-in for "${connection.name}". Sign in again from Settings → Executor.`);
    }
    throw outcome.error;
  }

  async #expireAccessToken(id: string): Promise<void> {
    await this.#deps.credentials.update((vault) => {
      const grant = vault.grants[id];
      if (grant) grant.expiresAt = 0;
    });
  }

  #client(connection: Connection): ExecutorConnection {
    let client = this.#clients.get(connection.id);
    if (!client) {
      client = new ExecutorConnection(new URL(connection.url), () => this.#accessToken(connection.id), { fetch: this.#deps.fetch });
      this.#clients.set(connection.id, client);
    }
    return client;
  }

  async #dropClient(id: string): Promise<void> {
    const client = this.#clients.get(id);
    this.#clients.delete(id);
    await client?.close();
  }

  #endpointsFor(connection: Connection): Promise<Endpoints> {
    let endpoints = this.#endpoints.get(connection.url);
    if (!endpoints) {
      endpoints = discover(new URL(connection.url), this.#deps.fetch);
      endpoints.catch(() => this.#endpoints.delete(connection.url));
      this.#endpoints.set(connection.url, endpoints);
    }
    return endpoints;
  }

  /** A saved client Executor no longer knows is registered again, once. */
  async #startDevice(endpoints: Endpoints): Promise<{ clientId: string; start: DeviceStart }> {
    const key = clientKey(endpoints, { kind: "device" });
    const known = (await this.#deps.credentials.snapshot()).clients[key];
    if (known) {
      try {
        return { clientId: known, start: await startDevice(endpoints, known, this.#deps.fetch, this.#now()) };
      } catch (error) {
        if (!(error instanceof OAuthError && error.kind === "registration")) throw error;
        await this.#deps.credentials.update((vault) => {
          delete vault.clients[key];
        });
      }
    }
    const clientId = await this.#clientFor(endpoints, { kind: "device" });
    return { clientId, start: await startDevice(endpoints, clientId, this.#deps.fetch, this.#now()) };
  }

  async #clientFor(endpoints: Endpoints, method: SignInMethod): Promise<string> {
    const key = clientKey(endpoints, method);
    const known = (await this.#deps.credentials.snapshot()).clients[key];
    if (known) return known;
    const clientId = await registerClient(endpoints, method, this.#deps.fetch);
    await this.#deps.credentials.update((vault) => {
      vault.clients[key] = clientId;
    });
    return clientId;
  }

  #require(id: string): Connection {
    const connection = this.#connections.find((c) => c.id === id);
    if (!connection) throw new UserFacingError("No such connection.");
    return connection;
  }

  async #saveDefault(): Promise<void> {
    if (this.#defaultId === null) await this.#deps.kv.delete("default");
    else await this.#deps.kv.set("default", this.#defaultId);
  }
}

/** A browser client is registered for one redirect URI, so a new BB port registers again. */
function clientKey(endpoints: Endpoints, method: SignInMethod): string {
  return method.kind === "browser" ? `browser ${endpoints.issuer} ${method.redirectUri}` : `device ${endpoints.issuer}`;
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
