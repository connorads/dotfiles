import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract, STATE_CHANGED, THREAD_CHANGED } from "./contracts.ts";
import { CallCancelledError } from "./src/connection.ts";
import { CredentialStore, vaultSettingSchema } from "./src/credentials.ts";
import type { FetchLike } from "./src/oauth.ts";
import { describe, ExecutorService, UserFacingError, type ToolCache } from "./src/service.ts";
import { bindTools, errorResult, toBbResult } from "./src/tools.ts";

const MAX_INSTRUCTIONS = 4096;
const CALLBACK_PATH = "/oauth/callback";

type Options = {
  /** Serves Executor in-process for tests. */
  fetch?: FetchLike;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Replaces the self-reload that registers a newly known tool list. */
  reload?: () => void;
};

export function createPlugin(options: Options = {}) {
  return (bb: BbPluginApi) => load(bb, options);
}

export default createPlugin();

async function load(bb: BbPluginApi, options: Options) {
  const settings = bb.settings.define({
    vault: {
      type: "string",
      label: "Executor sign-ins",
      description: "Managed by the Executor section below. Do not edit.",
      secret: true,
      experimental_schema: vaultSettingSchema,
    },
  });
  const credentials = new CredentialStore({
    read: async () => (await settings.get()).vault,
    write: async (raw) => {
      await settings.experimental_set({ vault: raw });
    },
  });

  const reload = options.reload ?? (() => {
    // After the current handler returns, so the reload does not dispose it mid-call.
    setTimeout(() => void bb.sdk.plugins.reload({ pluginId: bb.pluginId }).catch((e: unknown) => log.warn(`reload: ${describe(e)}`)), 0);
  });
  const toolsAtLoad = new Set<string>();
  // Background work can outlive a reload; the old API handle must not be touched then.
  let disposed = false;
  const live = <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => {
    if (!disposed) fn(...args);
  };
  const log = { info: live((m: string) => bb.log.info(m)), warn: live((m: string) => bb.log.warn(m)) };

  const service = await ExecutorService.load({
    kv: bb.storage.kv,
    credentials,
    fetch: options.fetch ?? fetch,
    log,
    changed: live(() => bb.realtime.publish(STATE_CHANGED, null)),
    toolsChanged: live((cache: ToolCache) => {
      const names = cache.tools.map((t) => t.name);
      if (names.length !== toolsAtLoad.size || names.some((n) => !toolsAtLoad.has(n))) reload();
    }),
    callbackUrl: () => `${bb.server.loopbackBaseUrl}/api/v1/plugins/${bb.pluginId}/http${CALLBACK_PATH}`,
    ...(options.sleep ? { sleep: options.sleep } : {}),
  });
  bb.onDispose(() => {
    disposed = true;
    return service.close();
  });

  const toolNames = registerTools(bb, service, service.tools);
  for (const name of service.tools?.tools.map((t) => t.name) ?? []) toolsAtLoad.add(name);
  const instructions = agentInstructions(service.tools?.instructions ?? null);
  bb.agents.configure((ctx) => ({
    tools: service.choiceFor(ctx.thread.id).kind === "off" ? [] : toolNames,
    skills: [],
    instructions,
  }));

  bb.rpc.register(rpcContract, {
    state: async () => service.state(),
    add: async ({ name, url }) => service.add(name, url),
    remove: async ({ id }) => (await service.remove(id), null),
    setDefault: async ({ id }) => (await service.setDefault(id), null),
    signIn: async ({ id, method }) => (await service.signIn(id, method), null),
    cancelSignIn: async ({ id }) => (service.cancelSignIn(id), null),
    signOut: async ({ id }) => (await service.signOut(id), null),
    threadChoice: async ({ threadId }) => service.choiceFor(threadId),
    setThreadChoice: async ({ threadId, choice }) => {
      await service.setThreadChoice(threadId, choice);
      bb.realtime.publish(THREAD_CHANGED, { threadId });
      return null;
    },
  });

  // A top-level browser navigation sends no Origin header, which "local" accepts; the
  // single-use `state` is what ties the request to a sign-in this plugin started.
  bb.http.route("GET", CALLBACK_PATH, (c) => {
    const result = service.completeBrowserSignIn(new URL(c.req.url).searchParams);
    return new Response(callbackPage(result), { status: result.ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } });
  });

  // Never block load on the network: tools come from the cache, refreshed here.
  void service.refreshTools().catch((e: unknown) => log.warn(`tool list: ${describe(e)}`));
  bb.log.info(`loaded with ${toolNames.length} Executor tools`);
}

function registerTools(bb: BbPluginApi, service: ExecutorService, cache: ToolCache | null): string[] {
  if (!cache) return [];
  const { bindings, skipped } = bindTools(cache.tools);
  if (skipped.length > 0) bb.log.warn(`skipped tools whose BB names collide: ${skipped.join(", ")}`);
  for (const { bbName, upstream } of bindings) {
    bb.agents.registerTool({
      name: bbName,
      description: upstream.description ?? upstream.title ?? upstream.name,
      parameters: upstream.inputSchema as Record<string, unknown>,
      presentation: { label: { pending: `Running Executor ${upstream.name}`, completed: `Ran Executor ${upstream.name}` } },
      async execute(params, ctx) {
        try {
          return toBbResult(await service.call(ctx.threadId, upstream.name, asArguments(params), ctx.signal));
        } catch (error) {
          if (error instanceof CallCancelledError || error instanceof UserFacingError) return errorResult(error.message);
          return errorResult(`Executor ${upstream.name} failed: ${describe(error)}`);
        }
      },
    });
  }
  return bindings.map((b) => b.bbName);
}

function agentInstructions(server: string | null): string {
  const lead = "Executor tools carry the `executor_` prefix. The person picks which Executor connection this thread uses.";
  const text = server ? `${lead}\n\n${server}` : lead;
  if (text.length <= MAX_INSTRUCTIONS) return text;
  const note = "\n\n[Truncated. Call executor_skills for the full guide.]";
  return text.slice(0, MAX_INSTRUCTIONS - note.length) + note;
}

function callbackPage(result: { ok: true; name: string } | { ok: false; message: string }): string {
  const escape = (text: string) => text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const body = result.ok
    ? `<h1>Signing in to ${escape(result.name)}</h1><p>You can close this tab and return to BB.</p>`
    : `<h1>Sign-in did not finish</h1><p>${escape(result.message)}</p>`;
  return `<!doctype html><meta charset="utf-8"><title>Executor sign-in</title><style>body{font:15px system-ui;margin:15vh auto;max-width:28rem;padding:0 1rem}</style>${body}`;
}

function asArguments(params: unknown): Record<string, unknown> {
  return params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
}
