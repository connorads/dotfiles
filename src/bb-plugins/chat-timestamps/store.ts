export type MessageTime = { id: string; timestamp: number; role: 'user' | 'assistant' };

let times = new Map<string, MessageTime>();
let wanted = new Set<string>();
const updates = new Set<() => void>();
const requests = new Set<() => void>();
export const getTimes = () => times;
export const getWanted = () => wanted;
export function setTimes(values: readonly MessageTime[]) {
  times = new Map(values.map(value => [value.id, value]));
  for (const listener of updates) listener();
}
export function setWanted(ids: Set<string>) {
  if (ids.size === wanted.size && [...ids].every(id => wanted.has(id))) return;
  wanted = ids;
  for (const listener of requests) listener();
}
export function onTimes(listener: () => void) {
  updates.add(listener);
  return () => { updates.delete(listener); };
}
export function onWanted(listener: () => void) {
  requests.add(listener);
  return () => { requests.delete(listener); };
}
