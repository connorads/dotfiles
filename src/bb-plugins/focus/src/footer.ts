const selector = 'button[data-testid="plugin-sidebar-footer-item-focus-focus"]';

// Footer action items have no persistent active state, and the mask needs a
// root attribute for its CSS to reach host markup.
export function mountChrome(document: Document, actions: {
  active(): boolean;
  mask(): string | null;
  subscribe(update: () => void): () => void;
}) {
  const root = document.documentElement;
  const update = () => {
    for (const button of Array.from(document.querySelectorAll(selector))) {
      button.setAttribute('aria-pressed', String(actions.active()));
      button.classList.toggle('fx-active', actions.active());
    }
    const mask = actions.mask();
    if (mask) root.setAttribute('data-focus-mask', mask);
    else root.removeAttribute('data-focus-mask');
  };
  const observer = new MutationObserver(update);
  observer.observe(document.body, { childList: true, subtree: true });
  const unsubscribe = actions.subscribe(update);
  update();
  return () => {
    observer.disconnect();
    unsubscribe();
    root.removeAttribute('data-focus-mask');
    for (const button of Array.from(document.querySelectorAll(selector))) {
      button.classList.remove('fx-active');
      button.removeAttribute('aria-pressed');
    }
  };
}
