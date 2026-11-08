import { expect, test } from 'vitest';
import { labActionSchema, labSchema } from './lab-model';
test('rehearsal actions cannot accept caller-selected paths, ports, commands or process IDs', () => {
  const action = { id: 'bb-patch-lab-example', revision: 7 };
  expect(labActionSchema.safeParse(action).success).toBe(true);
  for (const extra of [{ root: '/Applications/bb.app' }, { port: 38886 }, { pid: 123 }, { command: 'activate' }]) {
    expect(labActionSchema.safeParse({ ...action, ...extra }).success).toBe(false);
  }
  expect(labActionSchema.safeParse({ ...action, id: '../../live' }).success).toBe(false);
});
test('live activation cannot appear as an available capability in lab reports', () => {
  const report = { id: 'bb-patch-lab-example', phase: 'ready', revision: 1, events: [], checks: {}, root: '/example/lab', liveActivation: true };
  expect(labSchema.safeParse(report).success).toBe(false);
});
