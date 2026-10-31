import type { ObservationState, Target, RecordedContext } from './observation';
export const fixtureTarget: Target = { threadId: 'thread-demo', hostId: 'host-demo' };
const usage = { estimated: false, modelContextWindow: 100000, usedTokens: 12000 };
const detailed: RecordedContext = { usage: { ...usage, snapshot: {
  capturedAt: '2026-01-01T12:00:00Z', providerSessionId: 'session-demo', providerTurnId: null,
  model: 'demo-model', estimated: true, contextWindowTokens: 100000, usedTokens: 12000,
  autoCompactAtTokens: null, categories: [{ id: 'instructions', kind: 'used', label: 'Instructions', tokens: 1000, entries: [] }],
} } };
function recorded(context: RecordedContext): ObservationState {
  return { kind: 'recorded', observation: { target: fixtureTarget, receivedAt: '2026-01-01T12:01:00Z', context } };
}
export const fixtures = {
  'Count only': recorded({ usage }),
  'Categories': recorded(detailed),
  'Unavailable': recorded({ usage: null }),
  'Late other target': { kind: 'recorded', observation: { target: { threadId: 'thread-other', hostId: 'host-demo' }, receivedAt: '2026-01-01T12:01:00Z', context: detailed } },
} satisfies Record<string, ObservationState>;
export const fixtureOwner = JSON.stringify({ 'bb-guide': { introduction: true, skills: true }, 'demo-plugin': { enabled: true } }, null, 2) + '\n';
export const fixtureInventory = { truncated: false, rows: [
  { pluginId: 'workspace-tools', enabled: true, kind: 'agent-tool', id: 'files.search', label: 'Search workspace' },
  { pluginId: 'workspace-tools', enabled: true, kind: 'agent-tool', id: 'files.read', label: 'Read a file' },
  { pluginId: 'workspace-tools', enabled: true, kind: 'skill', id: 'workspace-guide', label: 'Workspace guide' },
  { pluginId: 'design-library', enabled: true, kind: 'skill', id: 'interface-design', label: 'Interface design' },
  { pluginId: 'meeting-notes', enabled: false, kind: 'agent-tool', id: 'notes.find', label: 'Find meeting notes' },
] };
