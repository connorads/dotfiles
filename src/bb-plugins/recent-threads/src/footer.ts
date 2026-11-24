const selectorFor = (itemId: string) =>
  `button[data-testid="plugin-sidebar-footer-item-recent-threads-${itemId}"]`;

// Footer action items expose no persistent active state in the SDK, so decorate
// the host buttons to mirror whether each view is currently active.
export function mountChrome(document: Document, actions: {
  items: Record<string, () => boolean>;
  subscribe(update: () => void): () => void;
}) {
  const buttons = (itemId: string) => Array.from(document.querySelectorAll(selectorFor(itemId)));
  const update = () => {
    for (const [itemId, active] of Object.entries(actions.items)) {
      const isActive = active();
      for (const button of buttons(itemId)) {
        button.setAttribute('aria-pressed', String(isActive));
        button.classList.toggle('rt-active', isActive);
      }
    }
  };
  const observer = new MutationObserver(update);
  observer.observe(document.body, { childList: true, subtree: true });
  const unsubscribe = actions.subscribe(update);
  update();
  return () => {
    observer.disconnect();
    unsubscribe();
    for (const itemId of Object.keys(actions.items)) {
      for (const button of buttons(itemId)) {
        button.classList.remove('rt-active');
        button.removeAttribute('aria-pressed');
      }
    }
  };
}
