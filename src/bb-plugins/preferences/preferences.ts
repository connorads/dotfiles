import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import type { BbPluginApi } from '@get-bb/plugin-sdk';

type Overrides = Parameters<BbPluginApi['sdk']['system']['updateKeyboardSettings']>[0];
const shortcut = z.object({
  key: z.string().min(1).max(32),
  mod: z.boolean().default(false), meta: z.boolean().default(false),
  control: z.boolean().default(false), alt: z.boolean().default(false),
  shift: z.boolean().default(false),
}).strict();
// BB's settings API holds the exact list of command IDs and rejects unknown ones, so a
// typo fails the apply. The pattern only rejects names that cannot be a command.
const command = z.string()
  .regex(/^(?:[A-Za-z]+(?:\.[A-Za-z]+)+|plugin:[a-z0-9-]+\/[A-Za-z0-9-]+)$/) as unknown as z.ZodType<Overrides[number]['command']>;
const preferences = z.object({
  keyboard: z.array(z.object({
    command,
    platform: z.enum(['mac', 'windows', 'linux']).optional(),
    shortcut: shortcut.nullable(),
  }).strict()),
}).strict().superRefine((value, context) => {
  const seen = new Set<string>();
  for (const entry of value.keyboard) {
    const key = JSON.stringify([entry.command, entry.platform]);
    if (seen.has(key)) context.addIssue({ code: 'custom', message: `Duplicate binding: ${key}` });
    seen.add(key);
  }
});

export function parsePreferences(value: unknown) {
  return preferences.parse(value);
}

export function mergePreferences(current: Overrides, desired: Overrides, previous: Overrides): Overrides {
  const merged = [
    ...current.filter(entry => ![...previous, ...desired].some(item => item.command === entry.command && item.platform === entry.platform)),
    ...desired,
  ];
  return isDeepStrictEqual(merged, current) ? current : merged;
}
