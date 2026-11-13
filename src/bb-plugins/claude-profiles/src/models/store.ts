import { listSchema, type Favourite, type FavouriteInput, type Remembered } from './contract.ts';

export function createStore(
  storage: { get(): Promise<unknown>; set(value: Favourite[]): Promise<void> },
  newId: () => string, changed: () => void,
) {
  let queue = Promise.resolve();
  async function read() {
    const raw = await storage.get();
    return raw == null ? [] : listSchema.parse(raw).sort((a, b) => a.slot - b.slot);
  }
  function mutate(update: (list: Favourite[]) => Favourite[]) {
    const next = queue.then(async () => {
      const list = listSchema.parse(update(await read())).sort((a, b) => a.slot - b.slot);
      await storage.set(list);
      changed();
      return list;
    });
    queue = next.then(() => {}, () => {});
    return next;
  }
  function find(list: Favourite[], id: string) {
    const index = list.findIndex(f => f.id === id);
    if (index === -1) throw new Error('Favourite no longer exists. Reopen the menu.');
    return index;
  }
  return {
    async list() { await queue; return read(); },
    add(input: FavouriteInput) {
      return mutate(list => {
        if (list.some(f => f.providerId === input.providerId && f.model === input.model && (f.daybreak ?? false) === (input.daybreak ?? false))) return list;
        const slot = Array.from({ length: 9 }, (_, i) => i + 1).find(slot => !list.some(f => f.slot === slot));
        if (slot === undefined) throw new Error('All nine favourite slots are full. Remove one before saving.');
        return [...list, { ...input, id: newId(), slot }];
      });
    },
    remove(id: string) {
      return mutate(list => { list.splice(find(list, id), 1); return list; });
    },
    // Undefined keeps a field, null clears it.
    remember(id: string, values: Remembered) {
      return mutate(list => {
        const index = find(list, id);
        const next: Record<string, unknown> = { ...list[index]! };
        for (const field of ['reasoningLevel', 'serviceTier'] as const) {
          const value = values[field];
          if (value === null) delete next[field];
          else if (value !== undefined) next[field] = value;
        }
        list[index] = next as Favourite;
        return list;
      });
    },
  };
}
