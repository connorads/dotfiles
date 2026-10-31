import { z } from 'zod';

const pluginSettings = z.record(z.string(), z.union([z.boolean(), z.number(), z.string()]));
const ownerSchema = z.record(z.string().min(1), pluginSettings);
export type PatchPreview =
  | { ok: false; error: string }
  | { ok: true; desiredJson: string; patch: string; previous: boolean | undefined; introduction: boolean };

/** Pure preview for the existing owner. This function performs no reads or writes. */
export function previewIntroduction(ownerText: string, introduction: boolean): PatchPreview {
  let input: unknown;
  try { input = JSON.parse(ownerText); } catch { return { ok: false, error: 'Owner must contain valid JSON.' }; }
  const parsed = ownerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Owner must map plugin IDs to setting objects.' };
  if (JSON.stringify(parsed.data) !== JSON.stringify(input)) return { ok: false, error: 'Owner contains settings that cannot be preserved.' };
  const guide = parsed.data['bb-guide'];
  const previous = guide?.introduction;
  if (previous !== undefined && typeof previous !== 'boolean') return { ok: false, error: 'bb-guide.introduction must be a boolean.' };
  const desired = { ...parsed.data, 'bb-guide': { ...guide, introduction } };
  const desiredJson = JSON.stringify(desired, null, 2) + '\n';
  if (previous === introduction) return { ok: true, desiredJson, patch: '', previous, introduction };
  // A complete replacement hunk retains exact old bytes for private review/application.
  const oldLines = ownerText.endsWith('\n') ? ownerText.slice(0, -1).split('\n') : ownerText.split('\n');
  const newLines = desiredJson.slice(0, -1).split('\n');
  const patch = ['--- a/.config/bb/plugin-config.json', '+++ b/.config/bb/plugin-config.json',
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...oldLines.map(line => '-' + line),
    ...(!ownerText.endsWith('\n') ? ['\\ No newline at end of file'] : []),
    ...newLines.map(line => '+' + line), ''].join('\n');
  return { ok: true, desiredJson, patch, previous, introduction };
}
