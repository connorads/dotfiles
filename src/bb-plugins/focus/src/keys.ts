// The switcher list's keyboard contract. Row 0 is Off, then each set, then New set.

export type ListAction =
  | { kind: 'move'; row: number }
  | { kind: 'choose'; row: number }
  | { kind: 'edit'; row: number }
  | { kind: 'close' };

export function listKey(key: string, row: number, rows: number): ListAction | null {
  if (key === 'ArrowDown') return { kind: 'move', row: (row + 1) % rows };
  if (key === 'ArrowUp') return { kind: 'move', row: (row - 1 + rows) % rows };
  if (key === 'Enter') return { kind: 'choose', row };
  if (key === 'Escape') return { kind: 'close' };
  if (key === 'e') return { kind: 'edit', row };
  if (/^[0-9]$/.test(key) && Number(key) < rows - 1) return { kind: 'choose', row: Number(key) };
  return null;
}
