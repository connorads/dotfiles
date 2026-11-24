import { UnauthorizedError, type CallToolResult, type Tool } from "@modelcontextprotocol/client";
import type { ConnectionHealthView, OwnerResolutionView, ProjectView, ScopedChoiceView, StateView } from "../contracts.ts";
import { ExecutorConnection } from "./connection.ts";
import {
  approvalMode, ConnectionSchema, parseConnectionUrl, resolveHierarchy, slugFor,
  type ApprovalMode, type Connection, type ResolvedChoice, type ScopedChoice, type ThreadChoice,
} from "./connections.ts";
import type { CredentialStore } from "./credentials.ts";
import { hostFor, mergeInventories, parseSearchInventory, parseSkillsInventory, searchProbeArgs, skillsProbeArgs, unknownHealth, webUrlFor } from "./health.ts";
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
export type ToolCaches = Partial<Record<ApprovalMode, ToolCache>>;

export type ServiceDeps = {
  kv: Kv;
  credentials: CredentialStore;
  fetch: FetchLike;
  log: { info(message: string): void; warn(message: string): void };
  /** Tells windows to refetch state. */
  changed(): void;
  /** Runs when the tool list is first known or changes shape. */
  toolsChanged(caches: ToolCaches): void;
  /** Where the browser returns after sign-in: BB's own loopback route. */
  callbackUrl(): string;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

/** An error whose message is written for the agent or the person. */
export class UserFacingError extends Error {}

const REFRESH_MARGIN_MS = 60_000;
const HEALTH_TTL_MS = 2 * 60_000;
const PROBE_TIMEOUT_MS = 8_000;
const THREAD_PREFIX = "thread:";
const PROJECT_PREFIX = "project:";
const OWNER_PREFIX = "owner:";
const THREAD_PROJECT_PREFIX = "thread-project:";

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

function parseStoredScopedChoice(raw: unknown): ScopedChoice | null {
  if (typeof raw === "string" && raw.length > 0) return { kind: "connection", id: raw };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (obj["kind"] === "off") return { kind: "off" };
    if (obj["kind"] === "connection" && typeof obj["id"] === "string" && obj["id"].length > 0) {
      return { kind: "connection", id: obj["id"] };
    }
  }
  return null;
}

export class ExecutorService {
  readonly #deps: ServiceDeps;
  readonly #now: () => number;
  #connections: Connection[];
  #defaultChoice: ScopedChoice | null;
  readonly #choices: Map<string, ThreadChoice>;
  readonly #projects: Map<string, ScopedChoice>;
  readonly #owners: Map<string, string>;
  readonly #threadProjects: Map<string, string>;
  #signedIn: Set<string>;
  #tools: ToolCaches;
  readonly #signIns = new Map<string, SignIn>();
  readonly #errors = new Map<string, string>();
  readonly #health = new Map<string, ConnectionHealthView>();
  readonly #checking = new Map<string, Promise<void>>();
  readonly #probeControllers = new Map<string, AbortController>();
  readonly #endpoints = new Map<string, Promise<Endpoints>>();
  readonly #clients = new Map<string, ExecutorConnection>();
  readonly #refreshing = new Map<string, Promise<string>>();

  private constructor(deps: ServiceDeps, loaded: {
    connections: Connection[];
    defaultChoice: ScopedChoice | null;
    choices: Map<string, ThreadChoice>;
    projects: Map<string, ScopedChoice>;
    owners: Map<string, string>;
    threadProjects: Map<string, string>;
    signedIn: Set<string>;
    tools: ToolCaches;
  }) {
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
    this.#connections = loaded.connections;
    this.#defaultChoice = loaded.defaultChoice;
    this.#choices = loaded.choices;
    this.#projects = loaded.projects;
    this.#owners = loaded.owners;
    this.#threadProjects = loaded.threadProjects;
    this.#signedIn = loaded.signedIn;
    this.#tools = loaded.tools;
  }

  static async load(deps: ServiceDeps): Promise<ExecutorService> {
    const stored = (await deps.kv.get<unknown[]>("connections")) ?? [];
    const connections = stored.flatMap((c) => {
      const parsed = ConnectionSchema.safeParse(c);
      return parsed.success ? [parsed.data] : [];
    });
    const defaultChoice = parseStoredScopedChoice(await deps.kv.get<unknown>("default"));
    const choices = new Map<string, ThreadChoice>();
    for (const key of await deps.kv.list(THREAD_PREFIX)) {
      const choice = await deps.kv.get<ThreadChoice>(key);
      if (choice) choices.set(key.slice(THREAD_PREFIX.length), choice);
    }
    const projects = new Map<string, ScopedChoice>();
    for (const key of await deps.kv.list(PROJECT_PREFIX)) {
      const choice = parseStoredScopedChoice(await deps.kv.get<unknown>(key));
      if (choice) projects.set(key.slice(PROJECT_PREFIX.length), choice);
    }
    const owners = new Map<string, string>();
    for (const key of await deps.kv.list(OWNER_PREFIX)) {
      const owner = await deps.kv.get<string>(key);
      if (owner) owners.set(key.slice(OWNER_PREFIX.length), owner);
    }
    const threadProjects = new Map<string, string>();
    for (const key of await deps.kv.list(THREAD_PROJECT_PREFIX)) {
      const projectId = await deps.kv.get<string>(key);
      if (projectId) threadProjects.set(key.slice(THREAD_PROJECT_PREFIX.length), projectId);
    }
    const vault = await deps.credentials.snapshot();
    const signedIn = new Set(Object.keys(vault.grants).filter((id) => connections.some((c) => c.id === id)));
    // Each mode owns a cache key; the model key also serves saved model connections.
    const tools: ToolCaches = {};
    const model = await deps.kv.get<ToolCache>("tools");
    const browser = await deps.kv.get<ToolCache>("tools:browser");
    if (model) tools.model = model;
    if (browser) tools.browser = browser;
    return new ExecutorService(deps, { connections, defaultChoice, choices, projects, owners, threadProjects, signedIn, tools });
  }

  get tools(): ToolCaches {
    return this.#tools;
  }

  /** Synchronous: `bb.agents.configure` cannot await. */
  choiceFor(threadId: string): ThreadChoice {
    return this.#choices.get(threadId) ?? { kind: "default" };
  }

  state(knownProjects: readonly { id: string; name: string }[] = []): StateView {
    const defaultId = this.#defaultChoice?.kind === "connection" ? this.#defaultChoice.id : null;
    const projects: ProjectView[] = knownProjects.map((p) => ({
      id: p.id,
      name: p.name,
      choice: this.#projects.get(p.id) ?? null,
    }));
    // Include any stored project override not returned by the project list (e.g. archived/test).
    const listedIds = new Set(knownProjects.map((p) => p.id));
    for (const [id, choice] of this.#projects) {
      if (!listedIds.has(id)) projects.push({ id, name: id, choice });
    }
    return {
      connections: this.#connections.map((c) => {
        const stored = this.#health.get(c.id) ?? unknownHealth();
        const health: ConnectionHealthView = this.#checking.has(c.id)
          ? { ...stored, state: "checking" }
          : stored;
        return {
          id: c.id,
          name: c.name,
          url: c.url,
          host: hostFor(c.url),
          webUrl: webUrlFor(c.url),
          approvalMode: approvalMode(c.url),
          status: this.#signIns.has(c.id) ? "signing-in" : this.#signedIn.has(c.id) ? "signed-in" : "signed-out",
          isDefault: c.id === defaultId,
          health,
        };
      }),
      defaultChoice: this.#defaultChoice,
      projects,
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
      toolsReady: Object.keys(this.#tools).length > 0,
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
    if (this.#defaultChoice === null) await this.setDefault({ kind: "connection", id });
    this.#deps.changed();
    return { ok: true, id };
  }

  async remove(id: string): Promise<void> {
    await this.signOut(id);
    this.#connections = this.#connections.filter((c) => c.id !== id);
    await this.#deps.kv.set("connections", this.#connections);
    if (this.#defaultChoice?.kind === "connection" && this.#defaultChoice.id === id) {
      this.#defaultChoice = this.#connections[0] ? { kind: "connection", id: this.#connections[0].id } : null;
      await this.#saveDefault();
    }
    for (const [projectId, choice] of this.#projects) {
      if (choice.kind === "connection" && choice.id === id) {
        this.#projects.delete(projectId);
        await this.#deps.kv.delete(PROJECT_PREFIX + projectId);
      }
    }
    this.#errors.delete(id);
    this.#health.delete(id);
    this.#deps.changed();
  }

  async setDefault(target: string | ScopedChoiceView): Promise<void> {
    const choice: ScopedChoice = typeof target === "string" ? { kind: "connection", id: target } : target;
    if (choice.kind === "connection" && !this.#connections.some((c) => c.id === choice.id)) {
      throw new UserFacingError("No such connection.");
    }
    this.#defaultChoice = choice;
    await this.#saveDefault();
    this.#deps.changed();
  }

  async setProjectChoice(projectId: string, choice: ThreadChoice): Promise<void> {
    if (choice.kind === "connection" && !this.#connections.some((c) => c.id === choice.id)) {
      throw new UserFacingError("No such connection.");
    }
    if (choice.kind === "default") {
      this.#projects.delete(projectId);
      await this.#deps.kv.delete(PROJECT_PREFIX + projectId);
    } else {
      this.#projects.set(projectId, choice);
      await this.#deps.kv.set(PROJECT_PREFIX + projectId, choice);
    }
    this.#deps.changed();
  }

  async recordThreadContext(threadId: string, projectId: string | null, ownerId: string | null): Promise<void> {
    let changed = false;
    if (projectId && this.#threadProjects.get(threadId) !== projectId) {
      this.#threadProjects.set(threadId, projectId);
      await this.#deps.kv.set(THREAD_PROJECT_PREFIX + threadId, projectId);
    }
    if (ownerId && ownerId !== threadId && !this.#owners.has(threadId)) {
      this.#owners.set(threadId, ownerId);
      await this.#deps.kv.set(OWNER_PREFIX + threadId, ownerId);
      changed = true;
    }
    if (changed) this.#deps.changed();
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

  /** Resolves thread → owner (parent/workflow) → project default → global default. */
  resolveFor(threadId: string, projectId?: string | null, seen = new Set<string>()): ResolvedChoice {
    const effectiveProject = projectId ?? this.#threadProjects.get(threadId) ?? null;
    const ownerId = this.#owners.get(threadId);
    seen.add(threadId);
    const owner = ownerId && !seen.has(ownerId)
      ? this.resolveFor(ownerId, this.#threadProjects.get(ownerId) ?? effectiveProject, seen)
      : null;
    return resolveHierarchy({
      thread: this.choiceFor(threadId),
      owner,
      project: effectiveProject ? (this.#projects.get(effectiveProject) ?? null) : null,
      globalDefault: this.#defaultChoice,
      connections: this.#connections,
    });
  }

  /** What a child/worker thread inherits from its parent/workflow owner, or null for root threads. */
  ownerResolutionFor(threadId: string, projectId?: string | null): OwnerResolutionView | null {
    const ownerId = this.#owners.get(threadId);
    if (!ownerId) return null;
    const resolved = this.resolveFor(ownerId, this.#threadProjects.get(ownerId) ?? projectId ?? null, new Set([threadId]));
    if (resolved.kind === "connection") return { kind: "connection", id: resolved.connection.id };
    return { kind: resolved.kind };
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
    this.#probeControllers.get(id)?.abort();
    this.#probeControllers.delete(id);
    const connection = this.#connections.find((c) => c.id === id);
    const grant = await this.#deps.credentials.update((vault) => {
      const removed = vault.grants[id];
      delete vault.grants[id];
      return removed;
    });
    this.#signedIn.delete(id);
    this.#health.delete(id);
    this.#errors.delete(id);
    await this.#dropClient(id);
    this.#deps.changed();
    if (grant && connection) {
      const endpoints = await this.#endpointsFor(connection).catch(() => null);
      if (endpoints) await revoke(endpoints, grant.clientId, grant.refreshToken, this.#deps.fetch);
    }
  }

  /**
   * Verifies a signed-in connection against its MCP server and discovers its apps,
   * accounts, unavailable apps and tool count. Read-only and throttled by TTL.
   */
  async check(id: string, options: { force?: boolean } = {}): Promise<void> {
    const connection = this.#connections.find((c) => c.id === id);
    if (!connection || !this.#signedIn.has(id) || this.#signIns.has(id)) return;
    const prev = this.#health.get(id);
    if (!options.force && prev && prev.checkedAt !== null && this.#now() - prev.checkedAt < HEALTH_TTL_MS && (prev.state === "ok" || prev.state === "degraded")) {
      return;
    }
    const existing = this.#checking.get(id);
    if (existing) return existing;
    const run = this.#probeConnection(connection).finally(() => {
      this.#checking.delete(id);
      this.#probeControllers.delete(id);
      this.#deps.changed();
    });
    this.#checking.set(id, run);
    this.#deps.changed();
    return run;
  }

  async checkAll(options: { force?: boolean } = {}): Promise<void> {
    const targets = this.#connections.filter((c) => this.#signedIn.has(c.id) && !this.#signIns.has(c.id));
    await Promise.allSettled(targets.map((c) => this.check(c.id, options)));
  }

  async call(
    threadId: string,
    tool: { name: string; mode: ApprovalMode },
    args: Record<string, unknown>,
    { signal, projectId }: { signal: AbortSignal; projectId?: string | null },
  ): Promise<CallToolResult> {
    const connection = this.#connectionForThread(threadId, projectId);
    if (approvalMode(connection.url) !== tool.mode) {
      throw new UserFacingError("The Executor approval mode changed. Use the tools for the selected connection in a new turn.");
    }
    const result = await this.#withAuthRetry(connection, (client) => client.callTool(tool.name, args, signal));
    const prev = this.#health.get(connection.id);
    const hadError = this.#errors.delete(connection.id);
    if (!prev || prev.state === "unknown" || prev.state === "unreachable" || prev.state === "reauth") {
      this.#health.set(connection.id, {
        ...(prev ?? unknownHealth()),
        state: "ok",
        checkedAt: this.#now(),
        message: null,
      });
      this.#deps.changed();
    } else if (hadError) {
      this.#deps.changed();
    }
    return result;
  }

  /** Each approval mode owns its schemas and instructions. Never copy a model resume into browser mode. */
  async refreshTools(): Promise<void> {
    const before = JSON.stringify(this.#tools);
    const defaultId = this.#defaultChoice?.kind === "connection" ? this.#defaultChoice.id : null;
    const candidates = this.#connections
      .filter((c) => this.#signedIn.has(c.id))
      .sort((a, b) => Number(b.id === defaultId) - Number(a.id === defaultId));
    for (const mode of ["model", "browser"] as const) {
      const connection = candidates.find((c) => approvalMode(c.url) === mode);
      if (!connection) continue;
      try {
        const cache = await this.#withAuthRetry(connection, async (client): Promise<ToolCache> => ({
          tools: await client.listTools(),
          instructions: (await client.instructions()) ?? null,
        }));
        await this.#deps.kv.set(mode === "model" ? "tools" : "tools:browser", cache);
        this.#tools[mode] = cache;
        const prev = this.#health.get(connection.id);
        const hadError = this.#errors.delete(connection.id);
        if (!prev || prev.state === "unknown" || prev.state === "unreachable" || prev.state === "reauth") {
          this.#health.set(connection.id, {
            ...(prev ?? unknownHealth()),
            state: "ok",
            checkedAt: this.#now(),
            message: null,
          });
          this.#deps.changed();
        } else if (hadError) {
          this.#deps.changed();
        }
      } catch (error) {
        this.#deps.log.warn(`tool list (${mode}): ${describe(error)}`);
        if (this.#signedIn.has(connection.id)) {
          const prev = this.#health.get(connection.id);
          this.#health.set(connection.id, {
            ...(prev ?? unknownHealth()),
            state: "unreachable",
            checkedAt: this.#now(),
            message: describe(error),
          });
          this.#deps.changed();
        }
      }
    }
    if (before !== JSON.stringify(this.#tools)) this.#deps.toolsChanged(this.#tools);
  }

  modeFor(threadId: string, projectId?: string | null): ApprovalMode | null {
    const resolved = this.resolveFor(threadId, projectId);
    return resolved.kind === "connection" ? approvalMode(resolved.connection.url) : null;
  }

  async close(): Promise<void> {
    for (const { controller } of this.#signIns.values()) controller.abort();
    this.#signIns.clear();
    for (const controller of this.#probeControllers.values()) controller.abort();
    this.#probeControllers.clear();
    await Promise.all([...this.#clients.values()].map((c) => c.close()));
    this.#clients.clear();
  }

  async #probeConnection(connection: Connection): Promise<void> {
    const controller = new AbortController();
    this.#probeControllers.set(connection.id, controller);
    try {
      const tools = await this.#withAuthRetry(connection, (client) => client.listTools());
      if (controller.signal.aborted || !this.#signedIn.has(connection.id)) return;

      let apps = this.#health.get(connection.id)?.apps ?? [];
      let toolCount = this.#health.get(connection.id)?.toolCount ?? null;
      let unavailableCount = 0;

      const skillsArgs = skillsProbeArgs(tools);
      const searchArgs = searchProbeArgs(tools);
      const runProbe = async <T>(name: string, args: Record<string, unknown>, parse: (r: CallToolResult) => T | null): Promise<T | null> => {
        try {
          const result = await this.#withAuthRetry(connection, (client) =>
            client.callTool(name, args, controller.signal, PROBE_TIMEOUT_MS),
          );
          if (controller.signal.aborted || !this.#signedIn.has(connection.id)) return null;
          return parse(result);
        } catch (error) {
          if (controller.signal.aborted || !this.#signedIn.has(connection.id)) return null;
          if (error instanceof UserFacingError) throw error;
          this.#deps.log.warn(`${name} probe (${connection.name}): ${describe(error)}`);
          return null;
        }
      };

      try {
        const [skillsInv, searchInv] = await Promise.all([
          skillsArgs !== null ? runProbe("skills", skillsArgs, parseSkillsInventory) : Promise.resolve(null),
          searchArgs !== null ? runProbe("search", searchArgs, parseSearchInventory) : Promise.resolve(null),
        ]);
        if (controller.signal.aborted || !this.#signedIn.has(connection.id)) return;
        const inventory = mergeInventories(skillsInv, searchInv);
        if (inventory) {
          apps = inventory.apps;
          toolCount = inventory.toolCount;
          unavailableCount = inventory.unavailableCount;
        }
      } catch (error) {
        if (error instanceof UserFacingError) return;
        throw error;
      }

      if (controller.signal.aborted || !this.#signedIn.has(connection.id)) return;
      this.#errors.delete(connection.id);
      const state = unavailableCount > 0 ? "degraded" : "ok";
      const message = unavailableCount > 0
        ? `${unavailableCount} app${unavailableCount === 1 ? "" : "s"} need${unavailableCount === 1 ? "s" : ""} attention in Executor.`
        : null;
      this.#health.set(connection.id, { state, checkedAt: this.#now(), message, apps, toolCount });
    } catch (error) {
      if (controller.signal.aborted || !this.#signedIn.has(connection.id)) return;
      const prev = this.#health.get(connection.id);
      this.#health.set(connection.id, {
        state: "unreachable",
        checkedAt: this.#now(),
        message: describe(error),
        apps: prev?.apps ?? [],
        toolCount: prev?.toolCount ?? null,
      });
    }
  }

  /**
   * Runs one MCP request against `connection`. Pre-checks the access token so refresh
   * failures surface immediately rather than hanging inside MCP transport connect. On HTTP 401
   * (meaning Executor ran nothing), refreshes once and retries; a second 401 revokes the local
   * grant and marks the connection as needing re-authentication.
   */
  async #withAuthRetry<T>(connection: Connection, work: (client: ExecutorConnection) => Promise<T>): Promise<T> {
    await this.#accessToken(connection.id);
    try {
      return await work(this.#client(connection));
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) throw error;
    }
    await this.#dropClient(connection.id);
    await this.#expireAccessToken(connection.id);
    await this.#accessToken(connection.id);
    try {
      return await work(this.#client(connection));
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        await this.#invalidateGrant(connection, "Executor rejected this sign-in. Sign in again.");
        throw new UserFacingError(`Executor rejected the sign-in for "${connection.name}". Sign in again from the Executor chip (⌥E) or Settings → Executor.`);
      }
      throw error;
    }
  }

  async #invalidateGrant(connection: Connection, reason: string, staleClientId?: string): Promise<void> {
    await this.#deps.credentials.update((vault) => {
      delete vault.grants[connection.id];
      if (staleClientId) {
        for (const [key, cid] of Object.entries(vault.clients)) {
          if (cid === staleClientId) delete vault.clients[key];
        }
      }
    });
    this.#signedIn.delete(connection.id);
    await this.#dropClient(connection.id);
    this.#health.set(connection.id, { state: "reauth", checkedAt: this.#now(), message: reason, apps: [], toolCount: null });
    this.#errors.set(connection.id, reason);
    this.#deps.changed();
  }

  #connectionForThread(threadId: string, projectId?: string | null): Connection {
    const resolved = this.resolveFor(threadId, projectId);
    if (resolved.kind === "off") {
      throw new UserFacingError("Executor is off for this thread. Turn it on from the Executor chip (Alt+E).");
    }
    if (resolved.kind === "unset") {
      throw new UserFacingError("No Executor connection is set up. Add one in Settings → Executor.");
    }
    if (!this.#signedIn.has(resolved.connection.id)) {
      throw new UserFacingError(`Executor connection "${resolved.connection.name}" is signed out. Sign in from the Executor chip (⌥E) or Settings → Executor.`);
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
    this.#errors.delete(connection.id);
    this.#health.delete(connection.id);
    await this.#dropClient(connection.id);
    this.#deps.changed();
    this.#deps.log.info(`signed in to ${connection.name}`);
    await this.refreshTools();
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
    type Outcome = { token: string } | { error: unknown; staleClientId?: string };
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
        if (error instanceof OAuthError && (error.kind === "invalid-grant" || error.kind === "invalid-client")) {
          delete vault.grants[id];
          if (error.kind === "invalid-client") forgetClient(vault.clients, grant.clientId);
          return { error, staleClientId: error.kind === "invalid-client" ? grant.clientId : undefined };
        }
        return { error };
      }
    });
    if ("token" in outcome) return outcome.token;
    if (outcome.error instanceof OAuthError && (outcome.error.kind === "invalid-grant" || outcome.error.kind === "invalid-client")) {
      this.#signedIn.delete(id);
      await this.#dropClient(id);
      this.#health.set(id, { state: "reauth", checkedAt: this.#now(), message: outcome.error.message, apps: [], toolCount: null });
      this.#errors.set(id, outcome.error.message);
      this.#deps.changed();
      throw new UserFacingError(`Executor ended the sign-in for "${connection.name}". Sign in again from the Executor chip (⌥E) or Settings → Executor.`);
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
    if (this.#defaultChoice === null) await this.#deps.kv.delete("default");
    else if (this.#defaultChoice.kind === "connection") await this.#deps.kv.set("default", this.#defaultChoice.id);
    else await this.#deps.kv.set("default", this.#defaultChoice);
  }
}

/** A browser client is registered for one redirect URI, so a new BB port registers again. */
function clientKey(endpoints: Endpoints, method: SignInMethod): string {
  return method.kind === "browser" ? `browser ${endpoints.issuer} ${method.redirectUri}` : `device ${endpoints.issuer}`;
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Remove every registration that points at a client Executor no longer recognises. */
function forgetClient(clients: Record<string, string>, clientId: string): void {
  for (const [key, cid] of Object.entries(clients)) {
    if (cid === clientId) delete clients[key];
  }
}
