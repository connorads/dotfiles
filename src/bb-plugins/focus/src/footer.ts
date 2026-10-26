const selector = 'button[data-testid="plugin-sidebar-footer-item-focus-focus"]';

// The footer SDK has no context-menu callback or persistent active state.
export function mountFooter(document: Document, actions: {
  toggle(): void;
  choose(): void;
  active(): boolean;
  subscribe(update: () => void): () => void;
}) {
  const originals = new Map<Element, string | null>();
  const update = () => {
    for (const button of Array.from(document.querySelectorAll(selector))) {
      if (!originals.has(button)) originals.set(button, button.getAttribute('aria-pressed'));
      button.setAttribute('aria-pressed', String(actions.active()));
      button.classList.toggle('fx-active', actions.active());
    }
  };
  const handle = (event: Event) => {
    if (!(event.target instanceof Element) || !event.target.closest(selector)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'contextmenu') actions.choose();
    else actions.toggle();
  };
  document.addEventListener('click', handle, true);
  document.addEventListener('contextmenu', handle, true);
  const observer = new MutationObserver(update);
  observer.observe(document.body, { childList: true, subtree: true });
  const unsubscribe = actions.subscribe(update);
  update();
  return () => {
    observer.disconnect();
    unsubscribe();
    document.removeEventListener('click', handle, true);
    document.removeEventListener('contextmenu', handle, true);
    for (const [button, pressed] of originals) {
      button.classList.remove('fx-active');
      if (pressed === null) button.removeAttribute('aria-pressed');
      else button.setAttribute('aria-pressed', pressed);
    }
  };
}
