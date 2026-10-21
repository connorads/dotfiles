import { getBadges, subscribe } from './store.ts';

// The bundled thread list renders the row link beside the provider icon; no SDK slot decorates that icon.
const ROWS = 'a[data-sidebar-thread-id]';
const CLAUDE_ICON = '[data-sidebar-thread-provider="claude-code"]';
const COLOURS = ['#d97757', '#3b82f6', '#10b981', '#a855f7', '#eab308', '#ec4899', '#14b8a6', '#f97316'];

export function accountColour(profileId: string) {
  let hash = 0;
  for (const char of profileId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COLOURS[hash % COLOURS.length]!;
}

export function mountAccountBadges(doc: Document): () => void {
  const added = new Set<HTMLElement>();
  const sync = () => {
    const badges = getBadges();
    const wanted = new Set<HTMLElement>();
    for (const link of Array.from(doc.querySelectorAll<HTMLAnchorElement>(ROWS))) {
      const account = badges.get(link.dataset.sidebarThreadId ?? '');
      const icon = link.parentElement?.querySelector<HTMLElement>(CLAUDE_ICON);
      if (!account || !icon) continue;
      let badge = icon.querySelector<HTMLElement>(':scope > .cp-row-badge');
      if (!badge) {
        badge = doc.createElement('span');
        badge.className = 'cp-row-badge';
        badge.setAttribute('aria-hidden', 'true');
        icon.append(badge);
      }
      const letter = account.label.trim().charAt(0).toUpperCase() || '?';
      const title = `Claude account: ${account.label}`;
      if (badge.textContent !== letter) badge.textContent = letter;
      if (badge.title !== title) badge.title = title;
      badge.style.backgroundColor = accountColour(account.profileId);
      wanted.add(badge);
      added.add(badge);
    }
    for (const badge of added) if (!wanted.has(badge)) { badge.remove(); added.delete(badge); }
  };
  // A sync with nothing to change writes nothing, so its own mutations settle after one pass.
  const observer = new MutationObserver(sync);
  const unsubscribe = subscribe(sync);
  sync();
  observer.observe(doc.body, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    unsubscribe();
    for (const badge of added) badge.remove();
    added.clear();
  };
}
