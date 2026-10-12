// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Chip, ChipDot, ChipValue } from './chip.tsx';

afterEach(cleanup);

test('a chip without a dialog announces no pop-up', () => {
  const { getByRole } = render(<Chip icon={<svg />} aria-label="Cache">x</Chip>);
  const chip = getByRole('button', { name: 'Cache' });
  expect(chip.getAttribute('type')).toBe('button');
  expect(chip.hasAttribute('aria-haspopup')).toBe(false);
  expect(chip.hasAttribute('aria-expanded')).toBe(false);
});

test('a chip that opens a dialog reports whether it is open', () => {
  const { getByRole } = render(<Chip icon={<svg />} aria-label="Git" expanded={false} />);
  const chip = getByRole('button', { name: 'Git' });
  expect(chip.getAttribute('aria-haspopup')).toBe('dialog');
  expect(chip.getAttribute('aria-expanded')).toBe('false');
});

test('tone, class and data attributes reach the button; parts keep their classes', () => {
  const { getByRole } = render(<Chip icon={<svg />} aria-label="Disk" tone="danger" className="mh" data-machine-health="t1">
    <ChipValue>87%</ChipValue><ChipDot tone="warn">2</ChipDot>
  </Chip>);
  const chip = getByRole('button', { name: 'Disk' });
  expect(chip.className).toBe('bbp-chip mh');
  expect(chip.dataset.tone).toBe('danger');
  expect(chip.dataset.machineHealth).toBe('t1');
  expect(chip.querySelector('.bbp-chip-value')?.textContent).toBe('87%');
  expect(chip.querySelector('.bbp-chip-dot')?.getAttribute('data-tone')).toBe('warn');
  expect(chip.textContent).toBe('87%2');
});
