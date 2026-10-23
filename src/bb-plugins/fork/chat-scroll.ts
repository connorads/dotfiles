// Stock split panes focus their wrapper on pointerdown unless the target is focusable.
const CHAT_VIEWPORT = '[data-split-pane-id][data-focused] [data-thread-window] [data-page-scroll-viewport].thread-scrollbar';
const MARKER = 'data-fork-chat-scroll';

export function mountChatScroll(document: Document): () => void {
  const owned = new Map<HTMLElement, Map<string, string>>();
  const restore = (viewport: HTMLElement, attributes: Map<string, string>) => {
    for (const [name, value] of attributes) {
      if (viewport.getAttribute(name) === value) viewport.removeAttribute(name);
    }
  };
  const refresh = () => {
    const viewports = new Set(Array.from(document.querySelectorAll<HTMLElement>(CHAT_VIEWPORT)));
    for (const [viewport, attributes] of owned) {
      if (viewports.has(viewport)) continue;
      restore(viewport, attributes);
      owned.delete(viewport);
    }
    for (const [index, viewport] of Array.from(viewports).entries()) {
      const attributes = owned.get(viewport) ?? new Map<string, string>();
      const add = (name: string, value: string) => {
        if (viewport.hasAttribute(name)) return;
        viewport.setAttribute(name, value);
        attributes.set(name, value);
      };
      add('tabindex', '0');
      add('role', 'region');
      const label = `Conversation ${index + 1}`;
      const previousLabel = attributes.get('aria-label');
      if (previousLabel !== undefined && viewport.getAttribute('aria-label') === previousLabel) {
        if (previousLabel !== label) viewport.setAttribute('aria-label', label);
        attributes.set('aria-label', label);
      } else if (!viewport.hasAttribute('aria-labelledby')) add('aria-label', label);
      add(MARKER, '');
      owned.set(viewport, attributes);
    }
  };
  const observer = new MutationObserver(refresh);
  refresh();
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-focused'],
  });
  return () => {
    observer.disconnect();
    for (const [viewport, attributes] of owned) restore(viewport, attributes);
    owned.clear();
  };
}
