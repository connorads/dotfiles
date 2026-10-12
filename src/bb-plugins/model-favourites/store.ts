import { listSchema, nameSchema, type Favourite, type FavouriteInput } from './contracts.ts';

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
        if (list.some(f => f.providerId === input.providerId && f.model === input.model)) return list;
        const slot = Array.from({ length: 9 }, (_, i) => i + 1).find(slot => !list.some(f => f.slot === slot));
        if (slot === undefined) throw new Error('All nine favourite slots are full. Remove one before saving.');
        return [...list, { ...input, id: newId(), slot }];
      });
    },
    rename(id: string, name: string) {
      return mutate(list => { const favourite = list[find(list, id)]; if (favourite) favourite.name = nameSchema.parse(name); return list; });
    },
    remove(id: string) {
      return mutate(list => { list.splice(find(list, id), 1); return list; });
    },
    move(id: string, direction: -1 | 1) {
      return mutate(list => {
        const index = find(list, id);
        const current = list[index];
        const neighbour = list[index + direction];
        if (current && neighbour) [current.slot, neighbour.slot] = [neighbour.slot, current.slot];
        return list;
      });
    },
  };
}
