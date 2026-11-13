import { stripVTControlCharacters } from 'node:util';

/** Output of `granted credential-process`, the AWS `credential_process` format. */
interface ProcessCredentials {
  Version: 1;
  AccessKeyId: string;
  SecretAccessKey: string;
  SessionToken?: string;
  Expiration?: string;
}

/** The body an AWS SDK expects from a container credentials endpoint. */
export interface ContainerCredentials {
  AccessKeyId: string;
  SecretAccessKey: string;
  Token: string;
  Expiration: string;
}

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiresAt: number;
}

export type MintResult =
  | { ok: true; credentials: Credentials }
  | { ok: false; reason: 'sign-in' | 'failed'; message: string };

export type RunResult = { code: number | null; stdout: string; stderr: string };
/** Runs Granted with these arguments. Injected so tests use a fake. */
export type RunGranted = (args: string[], timeoutMs: number) => Promise<RunResult>;

/**
 * Reuse cached credentials until this long before they expire. The AWS CLI
 * rejects credentials within 10 minutes of expiry, so the margin must exceed that.
 */
const REFRESH_MARGIN_MS = 20 * 60_000;
/** Ask Granted for credentials valid at least this long, so a fresh mint clears the margin. */
const GRANTED_WINDOW = '30m';
/**
 * Report at most this lifetime to the agent. An SDK caches container
 * credentials until their expiry, so a shorter one bounds how long a
 * long-running process keeps an account after the person switches.
 */
export const MAX_REPORTED_LIFETIME_MS = 30 * 60_000;
const MINT_TIMEOUT_MS = 20_000;
/**
 * Repeat a failure without running Granted again for this long. A failed mint
 * takes seconds, and every agent call would otherwise wait for another.
 */
const FAILURE_TTL_MS = 30_000;
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

/**
 * Mints credentials for a profile through Granted. A mint never opens a
 * browser: only `signIn`, which the person starts from BB, passes `--auto-login`.
 */
export class Broker {
  readonly #run: RunGranted;
  readonly #now: () => number;
  readonly #cache = new Map<string, Credentials>();
  readonly #pending = new Map<string, Promise<MintResult>>();
  readonly #failures = new Map<string, { result: MintResult; at: number }>();

  constructor(run: RunGranted, now: () => number = Date.now) {
    this.#run = run;
    this.#now = now;
  }

  async get(profile: string): Promise<MintResult> {
    const cached = this.#cache.get(profile);
    if (cached && cached.expiresAt - REFRESH_MARGIN_MS > this.#now()) return { ok: true, credentials: cached };
    const failed = this.#failures.get(profile);
    if (failed && this.#now() - failed.at < FAILURE_TTL_MS) return failed.result;
    const pending = this.#pending.get(profile);
    if (pending) return pending;
    const mint = this.#mint(profile, false).finally(() => this.#pending.delete(profile));
    this.#pending.set(profile, mint);
    return mint;
  }

  signIn(profile: string): Promise<MintResult> {
    this.#cache.delete(profile);
    this.#failures.delete(profile);
    return this.#mint(profile, true);
  }

  async #mint(profile: string, autoLogin: boolean): Promise<MintResult> {
    const args = ['credential-process', '--profile', profile, '--window', GRANTED_WINDOW, ...(autoLogin ? ['--auto-login'] : [])];
    const result = await this.#attempt(args, autoLogin);
    if (!result.ok) {
      this.#failures.set(profile, { result, at: this.#now() });
      return result;
    }
    const parsed = result.credentials;
    // An agent could keep a long-lived IAM user key forever; only STS session credentials expire.
    if (!parsed.SessionToken) {
      const refused = { ok: false as const, reason: 'failed' as const,
        message: `${profile} returns long-lived IAM user keys. BB serves only temporary credentials: use an SSO or role profile.` };
      this.#failures.set(profile, { result: refused, at: this.#now() });
      return refused;
    }
    const credentials: Credentials = {
      accessKeyId: parsed.AccessKeyId,
      secretAccessKey: parsed.SecretAccessKey,
      sessionToken: parsed.SessionToken ?? '',
      expiresAt: parsed.Expiration ? Date.parse(parsed.Expiration) : this.#now() + MAX_REPORTED_LIFETIME_MS,
    };
    this.#failures.delete(profile);
    this.#cache.set(profile, credentials);
    return { ok: true, credentials };
  }

  async #attempt(args: string[], autoLogin: boolean): Promise<{ ok: true; credentials: ProcessCredentials } | Extract<MintResult, { ok: false }>> {
    let result: RunResult;
    try {
      result = await this.#run(args, autoLogin ? SIGN_IN_TIMEOUT_MS : MINT_TIMEOUT_MS);
    } catch (error) {
      return { ok: false, reason: 'failed', message: `Could not run Granted: ${describe(error)}` };
    }
    if (result.code !== 0) return failure(result.stderr || result.stdout, result.code);
    const parsed = parseProcessCredentials(result.stdout);
    return parsed ? { ok: true, credentials: parsed } : { ok: false, reason: 'failed', message: 'Granted returned credentials in an unknown format.' };
  }
}

export function containerBody(credentials: Credentials, now: number): ContainerCredentials {
  const expiresAt = Math.min(credentials.expiresAt, now + MAX_REPORTED_LIFETIME_MS);
  return {
    AccessKeyId: credentials.accessKeyId,
    SecretAccessKey: credentials.secretAccessKey,
    Token: credentials.sessionToken,
    Expiration: new Date(expiresAt).toISOString(),
  };
}

function parseProcessCredentials(stdout: string): ProcessCredentials | null {
  try {
    const value = JSON.parse(stdout) as Partial<ProcessCredentials>;
    if (value.Version !== 1 || typeof value.AccessKeyId !== 'string' || typeof value.SecretAccessKey !== 'string') return null;
    if (value.Expiration !== undefined && Number.isNaN(Date.parse(value.Expiration))) return null;
    return value as ProcessCredentials;
  } catch {
    return null;
  }
}

/**
 * Granted has no machine-readable error codes. These phrases mark an SSO or
 * session that only an interactive sign-in can renew.
 */
const SIGN_IN_PHRASES = /auto-login|sso.*(expired|login)|token.*expired|expired.*token|no valid|not logged in|re-?authenticate/i;

function failure(raw: string, code: number | null): Extract<MintResult, { ok: false }> {
  // Granted colours its output even when it is not a terminal.
  const output = stripVTControlCharacters(raw);
  const message = lastLines(output) || `Granted exited ${code === null ? 'on a signal' : `with code ${code}`} and no output.`;
  return { ok: false, reason: SIGN_IN_PHRASES.test(output) ? 'sign-in' : 'failed', message };
}

/** Granted logs progress before the error; the last lines carry the reason. */
function lastLines(text: string): string {
  return text.trim().split(/\r?\n/).slice(-3).join(' ').slice(0, 500);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
