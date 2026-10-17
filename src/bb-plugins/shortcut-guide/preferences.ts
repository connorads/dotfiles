const key = 'bb-plugin-shortcut-guide.favourites';
export function readFavourites(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, 100) : [];
  } catch { return []; }
}
export function saveFavourites(ids: readonly string[]): boolean {
  try { localStorage.setItem(key, JSON.stringify(ids)); return true; }
  catch { return false; }
}
