import { z } from "zod";

const GrantSchema = z.object({
  issuer: z.string(),
  clientId: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
});
export type Grant = z.infer<typeof GrantSchema>;

const VaultSchema = z.object({
  /** One public client per issuer serves every connection's grant. */
  clients: z.record(z.string(), z.string()),
  grants: z.record(z.string(), GrantSchema),
});
export type Vault = z.infer<typeof VaultSchema>;

/** Rejects hand edits in BB's settings form that would corrupt the vault. */
export const vaultSettingSchema = z.string().refine((value) => value === "" || parseVault(value) !== null, {
  message: "Managed by the Executor settings section. Do not edit.",
});

export function parseVault(raw: string | undefined): Vault | null {
  if (!raw) return { clients: {}, grants: {} };
  try {
    const parsed = VaultSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The vault lives in one secret setting. Every write goes through one queue,
 * so a rotated refresh token is saved before any other change reads the vault.
 */
export class CredentialStore {
  readonly #read: () => Promise<string | undefined>;
  readonly #write: (raw: string) => Promise<void>;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(io: { read: () => Promise<string | undefined>; write: (raw: string) => Promise<void> }) {
    this.#read = io.read;
    this.#write = io.write;
  }

  async snapshot(): Promise<Vault> {
    await this.#queue.catch(() => undefined);
    return parseVault(await this.#read()) ?? { clients: {}, grants: {} };
  }

  update<T>(change: (vault: Vault) => T | Promise<T>): Promise<T> {
    const run = this.#queue.catch(() => undefined).then(async () => {
      const vault = parseVault(await this.#read()) ?? { clients: {}, grants: {} };
      const result = await change(vault);
      await this.#write(JSON.stringify(vault));
      return result;
    });
    this.#queue = run;
    return run;
  }
}
