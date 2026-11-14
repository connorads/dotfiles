const CHAT_LINKS = '[data-timeline-row-id] [data-markdown-preview] a[href]';

export function mountExternalLinks(doc: Document): () => void {
  const buttons = new Map<HTMLAnchorElement, HTMLSpanElement>();
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
        // An inline span, not a <button>: browsers may wrap before any atomic inline (button, svg),
        // which strands the arrow at the start of the next line. The CSS draws the icon after a word joiner.
        button = doc.createElement('span');
        button.setAttribute('role', 'button');
        button.tabIndex = 0;
        button.className = 'bb-external-link';
        const open = () => doc.defaultView?.open(anchor.href, '_blank', 'noopener,noreferrer');
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          // A double click opens one tab, not two.
          if (event.detail <= 1) open();
        });
        button.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) open();
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
