import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { CHANGED, rpcContract } from './contracts.ts';
import { Broker, type RunGranted } from './src/broker.ts';
import { parseProfiles, regionConfig } from './src/profiles.ts';
import { AwsService } from './src/service.ts';

const CREDS_PATH = '/creds';
/** Providers whose agent processes get the AWS environment. */
const PROVIDERS = ['claude-code', 'codex', 'pi'];

export default async function load(bb: BbPluginApi) {
  const settings = bb.settings.define({
    granted: {
      type: 'string',
      label: 'Granted executable',
      description: 'Path or name of the granted binary. BB runs it to mint credentials and to sign in.',
      default: 'granted',
    },
    awsConfig: {
      type: 'string',
      label: 'AWS config file',
      description: 'Where profiles are listed from. Empty means ~/.aws/config.',
      default: '',
    },
  });

  const configPath = async () => (await settings.get()).awsConfig || join(homedir(), '.aws', 'config');
  const profiles = async () => parseProfiles(await readFile(await configPath(), 'utf8'));
  // Per-thread AWS config files live in the plugin's own data directory.
  const regionDir = () => join(bb.server.experimental_dataDir, 'plugins', bb.pluginId, 'regions');
  const regionFile = (threadId: string) => join(regionDir(), `${threadId}.ini`);
  const writeRegion = async (threadId: string, region: string | null) => {
    await mkdir(regionDir(), { recursive: true });
    await writeFile(regionFile(threadId), regionConfig(region));
  };

  const run: RunGranted = async (args, timeoutMs) => runGranted((await settings.get()).granted, args, timeoutMs);
  const service = new AwsService({
    kv: bb.storage.kv,
    broker: new Broker(run),
    profiles,
    writeRegion,
    log: message => bb.log.info(message),
  });
  const changed = () => bb.realtime.publish(CHANGED, {});

  bb.rpc.register(rpcContract, {
    state: async () => {
      try {
        const list = await profiles();
        return {
          profiles: list.map(p => ({
            name: p.name, region: p.region,
            status: service.signingIn.has(p.name) ? 'signing-in' as const : service.signInNeeded.has(p.name) ? 'sign-in' as const : 'ok' as const,
          })),
          error: null,
        };
      } catch (error) {
        return { profiles: [], error: `Could not read ${await configPath()}: ${describe(error)}` };
      }
    },
    thread: async ({ threadId }) => {
      const choice = await service.choice(threadId);
      const last = service.lastFetch.get(threadId);
      return { choice, region: await service.region(choice).catch(() => null), lastFetch: last ? { profile: last.profile, at: last.at } : null };
    },
    setChoice: async ({ threadId, choice }) => {
      await service.setChoice(threadId, choice);
      bb.log.info(`thread ${threadId} now uses ${choice.profile ?? 'no AWS profile'}`);
      changed();
      return null;
    },
    signIn: async ({ profile }) => {
      const pending = service.signIn(profile);
      changed();
      const result = await pending;
      changed();
      return result;
    },
  });

  // The per-thread token is the check. "none" skips BB's Origin and plugin-token
  // checks, which an AWS SDK cannot satisfy.
  bb.http.route('GET', CREDS_PATH, async c => {
    const served = await service.serve(c.req.query('thread') ?? null, c.req.header('authorization') ?? null);
    if (served.status === 503) changed();
    return c.json(served.body, served.status);
  }, { auth: 'none' });

  const warmer = setInterval(() => service.keepWarm(), 60_000);
  bb.onDispose(() => clearInterval(warmer));

  for (const providerId of PROVIDERS) {
    bb.providers.experimental_contributeEnv(providerId, async ({ threadId }) => {
      if (!threadId) return [];
      const token = await service.token(threadId);
      // Write the region file before launch so the agent never reads a missing file.
      await writeRegion(threadId, await service.region(await service.choice(threadId)).catch(() => null));
      const url = `${bb.server.loopbackBaseUrl}/api/v1/plugins/${bb.pluginId}/http${CREDS_PATH}?thread=${encodeURIComponent(threadId)}`;
      const reason = 'AWS plugin: credentials for the profile chosen in BB';
      return [
        { name: 'AWS_CONTAINER_CREDENTIALS_FULL_URI', value: url, reason },
        { name: 'AWS_CONTAINER_AUTHORIZATION_TOKEN', value: token, reason },
        { name: 'AWS_CONFIG_FILE', value: regionFile(threadId), reason: 'AWS plugin: region only; no profiles' },
        { name: 'AWS_SHARED_CREDENTIALS_FILE', value: '/dev/null', reason: 'AWS plugin: no static credentials' },
        { name: 'AWS_EC2_METADATA_DISABLED', value: 'true', reason: 'AWS plugin: fail fast instead of probing EC2 metadata' },
      ];
    });
  }
}

async function runGranted(executable: string, args: string[], timeoutMs: number) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    // Granted must not inherit an AWS selection from BB's own environment.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('AWS_')));
    const child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
