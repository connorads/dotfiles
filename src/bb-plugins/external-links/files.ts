const FILE_LINKS = '[data-timeline-row-id] [data-markdown-preview] a[href^="file://"]';

const paths = {
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  browser: '<path d="M15 3h6v6M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
  editor: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m9 9-3 3 3 3m6-6 3 3-3 3"/>',
};

export function mountFileIcons(doc: Document): () => void {
  const icons = new Map<SVGElement, SVGSVGElement>();
  const sync = () => {
    const wanted = new Map<SVGElement, keyof typeof paths>();
    for (const icon of Array.from(doc.querySelectorAll<SVGElement>(`${FILE_LINKS} svg[data-icon="ExternalLink"].inline`))) wanted.set(icon, 'panel');
    for (const action of Array.from(doc.querySelectorAll<HTMLElement>('a[aria-label],button[aria-label],[role="menuitem"]'))) {
      const label = action.getAttribute('aria-label') ?? action.textContent?.trim() ?? '';
      const icon = action.querySelector<SVGElement>('svg[data-icon]');
      if (!icon) continue;
      const native = icon.getAttribute('data-icon');
      if (action.closest('[data-timeline-row-id]') && /^Open .+ in sidebar$/.test(label) && (native === 'Maximize2' || native === 'ExternalLink')) wanted.set(icon, 'panel');
      if (label === 'Open in external browser' && native === 'Globe') wanted.set(icon, 'browser');
      if (/^Open in editor(?:$|\s|\()/.test(label) && native === 'ExternalLink') wanted.set(icon, 'editor');
    }
    for (const [original, replacement] of icons) {
      if (!wanted.has(original)) {
        original.classList.remove('bb-file-preview-original');
        replacement.remove();
        icons.delete(original);
      }
    }
    for (const [original, destination] of wanted) {
      let replacement = icons.get(original);
      if (!replacement) {
        replacement = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        replacement.setAttribute('viewBox', '0 0 24 24');
        replacement.setAttribute('aria-hidden', 'true');
        replacement.setAttribute('class', `${original.getAttribute('class') ?? ''} bb-destination-icon`);
        icons.set(original, replacement);
      }
      if (replacement.dataset.destination !== destination) {
        replacement.innerHTML = paths[destination];
        replacement.dataset.destination = destination;
      }
      original.classList.add('bb-file-preview-original');
      if (original.nextSibling !== replacement) original.after(replacement);
    }
  };
  const observer = new MutationObserver(sync);
  sync();
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'aria-label', 'data-icon'], characterData: true });
  return () => {
    observer.disconnect();
    for (const [original, replacement] of icons) {
      original.classList.remove('bb-file-preview-original');
      replacement.remove();
    }
    icons.clear();
  };
}
