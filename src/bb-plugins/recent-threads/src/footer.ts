const selector = 'button[data-testid="plugin-sidebar-footer-item-recent-threads-toggle"]';

// Footer action items expose no persistent active state in the SDK, so decorate
// the host button to mirror whether chronological mode is currently active.
export function mountChrome(document: Document, actions: {
  active(): boolean;
  subscribe(update: () => void): () => void;
}) {
  const update = () => {
    const isActive = actions.active();
    for (const button of Array.from(document.querySelectorAll(selector))) {
      button.setAttribute('aria-pressed', String(isActive));
      button.classList.toggle('rt-active', isActive);
    }
  };
  const observer = new MutationObserver(update);
  observer.observe(document.body, { childList: true, subtree: true });
  const unsubscribe = actions.subscribe(update);
  update();
  return () => {
    observer.disconnect();
    unsubscribe();
    for (const button of Array.from(document.querySelectorAll(selector))) {
      button.classList.remove('rt-active');
      button.removeAttribute('aria-pressed');
    }
  };
}
