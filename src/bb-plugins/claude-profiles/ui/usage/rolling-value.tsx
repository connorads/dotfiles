import { useState } from 'react';

export function RollingValue({ value }: { value: string }) {
  const [reading, setReading] = useState({ current: value, previous: value });
  if (reading.current !== value) setReading({ current: value, previous: reading.current });
  const changed = reading.previous !== reading.current;
  return <span className="au-number" aria-label={value}>
    <span key={value} className="au-number-frame" data-changed={changed || undefined} aria-hidden="true">
      {changed && <span className="au-number-old">{reading.previous}</span>}
      <span className="au-number-current">{value}</span>
    </span>
  </span>;
}
