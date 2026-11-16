import { z } from 'zod';

const labelsSchema = z.record(z.string().regex(/^(default|[a-z][a-z0-9-]{0,31})$/u), z.string().trim().min(1).max(160));

export function parseAntigravityLabels(value: string): Record<string, string> {
  return labelsSchema.parse(JSON.parse(value));
}

export function antigravityAccountLabel(id: string, providerName: string, labels: Record<string, string>): string {
  return labels[id] ?? (id === 'default' ? 'Default' : providerName.replace(/^Antigravity\s*·\s*/u, ''));
}
