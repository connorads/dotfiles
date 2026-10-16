// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { RollingValue } from './rolling-value.tsx';

afterEach(cleanup);

test('exposes only the confirmed value when figures increase, reset, or change precision', () => {
  const view = render(<RollingValue value="99%" />);
  for (const value of ['100%', '0%', '0.5%']) {
    view.rerender(<RollingValue value={value} />);
    const number = view.getByLabelText(value);
    expect(number.getAttribute('aria-label')).toBe(value);
    expect(number.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(number.querySelector('.au-number-current')?.textContent).toBe(value);
  }
});
