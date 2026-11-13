import { randomBytes, timingSafeEqual } from 'node:crypto';
import { containerBody, type Broker, type ContainerCredentials } from './broker.ts';
import { REGION_PATTERN, type AwsProfile } from './profiles.ts';

/** A thread's AWS selection. `region` overrides the profile's own region. */
export interface Choice {
  profile: string | null;
  region: string | null;
}

/** Keep minting a profile ahead of requests for this long after its last use. */
const WARM_FOR_MS = 2 * 60 * 60_000;

export const OFF: Choice = { profile: null, region: null };

export interface Kv {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export interface ServiceDeps {
  kv: Kv;
  broker: Broker;
  profiles: () => Promise<AwsProfile[]>;
  /** Writes the AWS config file the thread's agent reads for its region. */
  writeRegion: (threadId: string, region: string | null) => Promise<void>;
  now?: () => number;
  log?: (message: string) => void;
}

export type Served =
  | { status: 200; body: ContainerCredentials }
  | { status: 401 | 403 | 404 | 503 | 502; body: { message: string } };

export interface Fetch {
  threadId: string;
  profile: string;
  at: number;
}

/**
 * Owns thread choices and per-thread tokens, and answers credential requests.
 * The token in a thread's environment is the only thing that lets a request
 * read that thread's credentials.
 */
export class AwsService {
  readonly #deps: ServiceDeps;
  readonly #now: () => number;
  /** Profiles that need an interactive sign-in, with Granted's message. */
  readonly signInNeeded = new Map<string, string>();
  readonly signingIn = new Set<string>();
  readonly lastFetch = new Map<string, Fetch>();
  /** Profiles chosen or served recently, with when. `keepWarm` mints these ahead of requests. */
  readonly #inUse = new Map<string, number>();

  constructor(deps: ServiceDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
  }

  async choice(threadId: string): Promise<Choice> {
    return (await this.#deps.kv.get<Choice>(`choice:${threadId}`)) ?? OFF;
  }

  async setChoice(threadId: string, choice: Choice): Promise<void> {
    if (choice.region !== null && !REGION_PATTERN.test(choice.region)) throw new Error(`${choice.region} is not an AWS region name.`);
    if (choice.profile !== null && !(await this.#deps.profiles()).some(p => p.name === choice.profile)) {
      throw new Error(`No AWS profile named ${choice.profile}.`);
    }
    await this.#deps.kv.set(`choice:${threadId}`, choice);
    await this.#deps.writeRegion(threadId, await this.region(choice));
    if (choice.profile) this.#warm(choice.profile);
  }

  /**
   * Mints recently used profiles before the cache margin runs out. An AWS SDK
   * waits about 2 seconds for container credentials, and Granted takes longer.
   */
  keepWarm() {
    const cutoff = this.#now() - WARM_FOR_MS;
    for (const [profile, at] of this.#inUse) {
      if (at < cutoff) this.#inUse.delete(profile);
      else void this.#deps.broker.get(profile);
    }
  }

  #warm(profile: string) {
    this.#inUse.set(profile, this.#now());
    void this.#deps.broker.get(profile);
  }

  /** The thread's region override, else its profile's region. */
  async region(choice: Choice): Promise<string | null> {
    if (choice.region) return choice.region;
    if (!choice.profile) return null;
    return (await this.#deps.profiles()).find(p => p.name === choice.profile)?.region ?? null;
  }

  /** The thread's token, created on first use and kept across restarts. */
  async token(threadId: string): Promise<string> {
    const key = `token:${threadId}`;
    const existing = await this.#deps.kv.get<string>(key);
    if (existing) return existing;
    const token = randomBytes(32).toString('hex');
    await this.#deps.kv.set(key, token);
    return token;
  }

  async serve(threadId: string | null, authorization: string | null): Promise<Served> {
    if (!threadId || !authorization) return { status: 401, body: { message: 'Missing thread or authorization.' } };
    const expected = await this.#deps.kv.get<string>(`token:${threadId}`);
    if (!expected || !sameSecret(expected, authorization)) return { status: 403, body: { message: 'Wrong token for this thread.' } };
    const { profile } = await this.choice(threadId);
    if (!profile) {
      return { status: 404, body: { message: 'No AWS profile is selected for this thread. Ask the person to choose one in BB (Alt+W). Do not sign in to AWS yourself.' } };
    }
    this.#inUse.set(profile, this.#now());
    const result = await this.#deps.broker.get(profile);
    if (!result.ok) {
      if (result.reason === 'sign-in') this.signInNeeded.set(profile, result.message);
      this.#deps.log?.(`credentials for ${profile} failed: ${result.message}`);
      return result.reason === 'sign-in'
        ? { status: 503, body: { message: `AWS sign-in needed for ${profile}. Ask the person to sign in from BB (Alt+W). Do not sign in to AWS yourself.` } }
        : { status: 502, body: { message: `Could not get credentials for ${profile}: ${result.message}` } };
    }
    this.signInNeeded.delete(profile);
    const at = this.#now();
    this.lastFetch.set(threadId, { threadId, profile, at });
    this.#deps.log?.(`served ${profile} credentials to ${threadId}`);
    return { status: 200, body: containerBody(result.credentials, at) };
  }

  /** Runs Granted's interactive sign-in. Only the person starts this, from BB. */
  async signIn(profile: string): Promise<{ ok: true } | { ok: false; message: string }> {
    this.signingIn.add(profile);
    try {
      const result = await this.#deps.broker.signIn(profile);
      if (!result.ok) return { ok: false, message: result.message };
      this.signInNeeded.delete(profile);
      return { ok: true };
    } finally {
      this.signingIn.delete(profile);
    }
  }
}

function sameSecret(expected: string, header: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(header.replace(/^Bearer\s+/i, ''));
  return a.length === b.length && timingSafeEqual(a, b);
}
