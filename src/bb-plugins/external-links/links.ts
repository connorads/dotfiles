const CHAT_LINKS = '[data-timeline-row-id] [data-markdown-preview] a[href]';

export function mountExternalLinks(doc: Document): () => void {
  const buttons = new Map<HTMLAnchorElement, HTMLButtonElement>();
  const sync = () => {
    const links = new Set(Array.from(doc.querySelectorAll<HTMLAnchorElement>(CHAT_LINKS)));
    for (const [anchor, button] of buttons) {
      if (!links.has(anchor) || !/^https?:\/\//i.test(anchor.getAttribute('href') ?? '')) {
        button.remove();
        buttons.delete(anchor);
      }
    }
    for (const anchor of links) {
      if (!/^https?:\/\//i.test(anchor.getAttribute('href') ?? '')) continue;
      let button = buttons.get(anchor);
      if (!button) {
        button = doc.createElement('button');
        button.type = 'button';
        button.className = 'bb-external-link';
        button.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>';
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          doc.defaultView?.open(anchor.href, '_blank', 'noopener,noreferrer');
        });
        buttons.set(anchor, button);
      }
      const label = `Open ${anchor.textContent?.trim() || anchor.href} in external browser`;
      if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
      button.title = 'Open in external browser';
      if (anchor.nextSibling !== button) anchor.after(button);
    }
  };
  const observer = new MutationObserver(sync);
  sync();
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'], characterData: true });
  return () => {
    observer.disconnect();
    for (const button of buttons.values()) button.remove();
    buttons.clear();
  };
}
