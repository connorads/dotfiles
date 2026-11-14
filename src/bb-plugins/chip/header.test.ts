import { expect, test } from 'vitest';
import { registerThreadHeaderChip } from './header.ts';

test('registers the chip on the retired header slot unchanged', () => {
  const registered: unknown[] = [];
  const chip = { id: 'usage', title: 'Usage', component: () => null };
  registerThreadHeaderChip({ slots: { experimental_threadHeaderAction: (value: unknown) => registered.push(value) } }, chip);
  expect(registered).toEqual([chip]);
});
