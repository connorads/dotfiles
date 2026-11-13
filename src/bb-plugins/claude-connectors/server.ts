import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { homedir, userInfo } from 'node:os';
import { promisify } from 'node:util';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { CHANGED, rpcContract } from './contracts.ts';
import { isProfileName, OFF, resolveChoice, type Choice } from './src/choice.ts';
import { policyKey, type Access, type Overrides } from './src/policy.ts';
import { ConnectorService, UserFacingError, type Run } from './src/service.ts';

const MAX_OUTPUT = 60_000;
const expandHome = (path: string) => (path === '~' || path.startsWith('~/') ? homedir() + path.slice(1) : path);

const run: Run = async (file, args, { env, timeoutMs }) =>
  (await promisify(execFile)(file, args, { env, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 })).stdout;

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    profileRoot: { type: 'string', label: 'Claude profile root', default: '~/.claude-profiles/code',
      description: 'Each folder inside is one CLAUDE_CONFIG_DIR, such as ~/.claude-profiles/code/<name>.' },
    executable: { type: 'string', label: 'Native Claude executable', default: 'claude',
      description: 'Runs `claude mcp list` in a profile to renew its login. It makes no model request.' },
  });
  const initial = await settings.get();
  let claudePath = initial.executable || 'claude';
  const service = new ConnectorService({
    run, fetch, now: Date.now, user: userInfo().username,
    listDir: async path => (await readdir(path, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name),
    profilesRoot: expandHome(initial.profileRoot || '~/.claude-profiles/code'),
    claudePath: () => claudePath,
  });

  // configure() is synchronous, so choices and policies live in memory, backed by kv.
  const kv = bb.storage.kv;
  const threads = new Map<string, Choice>();
  const projects = new Map<string, Choice>();
  /** A new-thread composer's pick, applied to that project's next thread at its first dispatch. */
  const drafts = new Map<string, Choice>();
  const policies = new Map<string, Overrides>();
  let fallback: Choice | undefined;
  for (const key of await kv.list('thread:')) { const v = await kv.get<Choice>(key); if (v) threads.set(key.slice(7), v); }
  for (const key of await kv.list('project:')) { const v = await kv.get<Choice>(key); if (v) projects.set(key.slice(8), v); }
  for (const key of await kv.list('draft:')) { const v = await kv.get<Choice>(key); if (v) drafts.set(key.slice(6), v); }
  for (const key of await kv.list('policy:')) { const v = await kv.get<Overrides>(key); if (v) policies.set(key.slice(7), v); }
  fallback = await kv.get<Choice>('default');

  const resolve = (threadId: string, projectId: string) =>
    resolveChoice(threads.get(threadId), projects.get(projectId), fallback);
  const policy = (profile: string) => policies.get(profile) ?? {};

  const changed = () => bb.realtime.publish(CHANGED, {});
  async function setChoice(map: Map<string, Choice>, prefix: string, id: string, value: string) {
    if (value === 'inherit') { map.delete(id); await kv.delete(prefix + id); }
    else { map.set(id, value); await kv.set(prefix + id, value); }
    changed();
  }
  async function setDefault(value: string) {
    if (value === 'inherit') value = OFF;
    fallback = value; await kv.set('default', value); changed();
  }
  async function setAccess({ profile, connector: connectorName, tool: toolName, access, signal }:
    { profile: string; connector: string; tool: string; access: Access; signal?: AbortSignal }) {
    const found = await service.connector(profile, connectorName, signal);
    if (!(await service.tools(profile, found, signal)).some(t => t.name === toolName))
      throw new UserFacingError(`${found.name} has no tool "${toolName}".`);
    const next = { ...policy(profile), [policyKey(found.name, toolName)]: access };
    policies.set(profile, next); await kv.set(`policy:${profile}`, next); changed();
    return found.name;
  }
  const message = (error: unknown) => error instanceof Error ? error.message : String(error);
  async function checkProfile(value: string) {
    if (value === OFF || value === 'inherit') return;
    if (!isProfileName(value) || !(await service.profiles()).includes(value))
      throw new UserFacingError(`Unknown profile "${value}". Profiles: ${(await service.profiles()).join(', ')}.`);
  }

  const bounded = (value: unknown) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 1);
    return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n… truncated at ${MAX_OUTPUT} characters.` : text;
  };
  const failure = (error: unknown) => ({
    content: [{ type: 'text' as const, text: error instanceof UserFacingError ? error.message : `Claude Connectors error: ${error instanceof Error ? error.message : String(error)}` }],
    isError: true,
  });
  const profileFor = (threadId: string, projectId: string) => {
    const resolved = resolve(threadId, projectId);
    if (!resolved.profile) throw new UserFacingError('Claude connectors are off for this thread. The person can turn them on with `bb claude-connectors use <profile>`.');
    return resolved.profile;
  };

  bb.agents.registerTool({
    name: 'claude_connectors_list',
    description: 'List the claude.ai connectors (Slack, Snowflake, HubSpot, ...) available to this thread, or with `connector` set, that connector\'s tools, access and input schemas.',
    presentation: { label: { pending: 'Listing Claude connectors', completed: 'Listed Claude connectors' } },
    parameters: z.object({ connector: z.string().min(1).optional().describe('Connector name, such as "Slack". Omit to list connectors.') }),
    async execute({ connector }, ctx) {
      try {
        const profile = profileFor(ctx.threadId, ctx.projectId);
        if (!connector) {
          const list = await service.connectors(profile, ctx.signal);
          return bounded({ profile, connectors: list.map(c => c.name), next: 'Call again with `connector` to see its tools.' });
        }
        const found = await service.connector(profile, connector, ctx.signal);
        const tools = await service.toolViews({ profile, connector: found, overrides: policy(profile), withSchema: true, signal: ctx.signal });
        return bounded({ profile, connector: found.name, tools });
      } catch (error) { return failure(error); }
    },
  });

  bb.agents.registerTool({
    name: 'claude_connectors_call',
    description: 'Call one tool on a claude.ai connector. Check its input schema with claude_connectors_list first. Tools marked access "off" are refused.',
    presentation: { label: { pending: 'Calling a Claude connector', completed: 'Called a Claude connector' } },
    parameters: z.object({
      connector: z.string().min(1).describe('Connector name, such as "Slack".'),
      tool: z.string().min(1).describe('Tool name from claude_connectors_list.'),
      arguments: z.record(z.string(), z.unknown()).default({}),
    }),
    async execute({ connector, tool, arguments: args }, ctx) {
      try {
        const profile = profileFor(ctx.threadId, ctx.projectId);
        const result = await service.call({ profile, connector, tool, args, overrides: policy(profile), signal: ctx.signal });
        const parsed = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()), isError: z.boolean().optional() })
          .safeParse(result);
        if (!parsed.success) return bounded(result);
        const text = parsed.data.content.map(part => part.text ?? JSON.stringify(part)).join('\n');
        return { content: [{ type: 'text' as const, text: bounded(text) }], isError: parsed.data.isError === true };
      } catch (error) { return failure(error); }
    },
  });

  bb.agents.configure(ctx => {
    const resolved = resolve(ctx.thread.id, ctx.project.id);
    if (!resolved.profile) return { tools: [], skills: [] };
    return {
      tools: ['claude_connectors_list', 'claude_connectors_call'],
      skills: [],
      instructions: `Claude connectors from the "${resolved.profile}" Claude profile are available through claude_connectors_list and claude_connectors_call. `
        + 'They act as the person in that workspace. Confirm the exact content with the person before any write, such as sending a message.',
    };
  });

  bb.experimental_hooks.on('message.dispatch', async ctx => {
    const draft = drafts.get(ctx.project.id);
    if (ctx.thread.status !== 'pending' || draft === undefined || threads.has(ctx.thread.id)) return { action: 'proceed' };
    drafts.delete(ctx.project.id); await kv.delete(`draft:${ctx.project.id}`);
    await setChoice(threads, 'thread:', ctx.thread.id, draft);
    return { action: 'proceed' };
  });

  const resolvedFor = (own: Choice | undefined, projectId: string) => resolveChoice(own, projects.get(projectId), fallback);
  bb.rpc.register(rpcContract, {
    state: async () => {
      const list = await bb.sdk.projects.list();
      return {
        profiles: await service.profiles(),
        defaultChoice: fallback ?? OFF,
        projects: list.map(p => ({ id: p.id, name: p.name, choice: projects.get(p.id) ?? null })),
      };
    },
    thread: async ({ threadId, projectId }) =>
      ({ threadId, own: threads.get(threadId) ?? null, resolved: resolvedFor(threads.get(threadId), projectId) }),
    setThread: async ({ threadId, value }) => { await checkProfile(value); await setChoice(threads, 'thread:', threadId, value); return null; },
    draft: async ({ projectId }) =>
      ({ projectId, own: drafts.get(projectId) ?? null, resolved: resolvedFor(drafts.get(projectId), projectId) }),
    setDraft: async ({ projectId, value }) => { await checkProfile(value); await setChoice(drafts, 'draft:', projectId, value); return null; },
    setProject: async ({ projectId, value }) => { await checkProfile(value); await setChoice(projects, 'project:', projectId, value); return null; },
    setDefault: async ({ value }) => { await checkProfile(value); await setDefault(value); return null; },
    connectors: async ({ profile }) => {
      try { await checkProfile(profile); return { connectors: (await service.connectors(profile)).map(c => c.name), error: null }; }
      catch (error) { return { connectors: [], error: message(error) }; }
    },
    tools: async ({ profile, connector }) => {
      try {
        await checkProfile(profile);
        const found = await service.connector(profile, connector);
        return { tools: await service.toolViews({ profile, connector: found, overrides: policy(profile), withSchema: false }), error: null };
      } catch (error) { return { tools: [], error: message(error) }; }
    },
    setAccess: async ({ profile, connector, tool, access }) => { await checkProfile(profile); await setAccess({ profile, connector, tool, access }); return null; },
  });

  const usage = [
    'bb claude-connectors status',
    'bb claude-connectors use <profile|off|inherit> [--project] [--thread <id>]',
    'bb claude-connectors default <profile|off>',
    'bb claude-connectors connectors [--profile <name>]',
    'bb claude-connectors tools <connector> [--profile <name>]',
    'bb claude-connectors allow <connector> <tool> [--off] [--profile <name>]',
  ];
  const flag = (argv: string[], name: string) => {
    const i = argv.indexOf(name);
    if (i < 0) return undefined;
    const value = argv[i + 1];
    argv.splice(i, value === undefined || value.startsWith('--') ? 1 : 2);
    return value === undefined || value.startsWith('--') ? '' : value;
  };

  bb.cli.register({
    name: 'claude-connectors',
    summary: 'Choose which Claude profile\'s claude.ai connectors a thread or project uses',
    commands: [
      { name: 'status', summary: 'Show the profile this thread resolves to, and why', usage: usage[0] },
      { name: 'use', summary: 'Pick a profile for this thread, or with --project for the project', usage: usage[1] },
      { name: 'default', summary: 'Set the global default profile', usage: usage[2] },
      { name: 'connectors', summary: 'List a profile\'s connectors', usage: usage[3] },
      { name: 'tools', summary: 'List a connector\'s tools and their access', usage: usage[4] },
      { name: 'allow', summary: 'Allow a write tool, or turn a tool off with --off', usage: usage[5] },
    ],
    async run(input, ctx) {
      const argv = [...input];
      const out = (text: string) => ({ exitCode: 0, stdout: `${text}\n` });
      try {
        claudePath = (await settings.get()).executable || 'claude';
        const command = argv.shift();
        const profileFlag = flag(argv, '--profile');
        const profileArg = async () => {
          if (profileFlag) { await checkProfile(profileFlag); return profileFlag; }
          const resolved = ctx.threadId && ctx.projectId ? resolve(ctx.threadId, ctx.projectId).profile : fallback && fallback !== OFF ? fallback : null;
          if (!resolved) throw new UserFacingError('No profile selected here. Add --profile <name>.');
          return resolved;
        };
        switch (command) {
          case 'status': {
            const lines = [`Profiles: ${(await service.profiles()).join(', ') || 'none found'}`, `Global default: ${fallback ?? 'off'}`];
            if (ctx.projectId) lines.push(`Project default: ${projects.get(ctx.projectId) ?? 'inherit'}`);
            if (ctx.threadId && ctx.projectId) {
              const r = resolve(ctx.threadId, ctx.projectId);
              lines.push(`This thread: ${r.profile ?? 'off'} (from ${r.source})`);
            }
            return out(lines.join('\n'));
          }
          case 'use': {
            const projectScope = flag(argv, '--project') !== undefined;
            const threadId = flag(argv, '--thread') || ctx.threadId;
            const value = argv[0];
            if (!value) throw new UserFacingError(`Usage: ${usage[1]}`);
            await checkProfile(value);
            if (projectScope) {
              if (!ctx.projectId) throw new UserFacingError('No project here. Run it inside a BB thread or project.');
              await setChoice(projects, 'project:', ctx.projectId, value);
              return out(`Project default set to ${value}.`);
            }
            if (!threadId) throw new UserFacingError('No thread here. Add --thread <id>.');
            await setChoice(threads, 'thread:', threadId, value);
            return out(`Thread ${threadId} set to ${value}. A newly enabled thread gets the tools from its next turn.`);
          }
          case 'default': {
            const value = argv[0];
            if (!value || value === 'inherit') throw new UserFacingError(`Usage: ${usage[2]}`);
            await checkProfile(value);
            await setDefault(value);
            return out(`Global default set to ${value}.`);
          }
          case 'connectors': {
            const profile = await profileArg();
            return out(`${profile}: ${(await service.connectors(profile, ctx.signal)).map(c => c.name).join(', ')}`);
          }
          case 'tools': {
            const profile = await profileArg();
            if (!argv[0]) throw new UserFacingError(`Usage: ${usage[4]}`);
            const found = await service.connector(profile, argv[0], ctx.signal);
            const views = await service.toolViews({ profile, connector: found, overrides: policy(profile), withSchema: false, signal: ctx.signal });
            return out(views.map(v => `${v.access === 'allow' ? '✓' : '·'} ${v.name}${v.readOnly ? '' : '  (writes)'}`).join('\n'));
          }
          case 'allow': {
            const profile = await profileArg();
            const off = flag(argv, '--off') !== undefined;
            const [connectorName, toolName] = argv;
            if (!connectorName || !toolName) throw new UserFacingError(`Usage: ${usage[5]}`);
            const access: Access = off ? 'off' : 'allow';
            const name = await setAccess({ profile, connector: connectorName, tool: toolName, access, signal: ctx.signal });
            return out(`${profile}: ${name}/${toolName} is now ${access}.`);
          }
          default:
            return { exitCode: command ? 2 : 0, stdout: `${usage.join('\n')}\n` };
        }
      } catch (error) {
        return { exitCode: 1, stderr: `${error instanceof Error ? error.message : String(error)}\n` };
      }
    },
  });
}
