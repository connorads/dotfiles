const FILE_LINKS = '[data-timeline-row-id] [data-markdown-preview] a[href^="file://"]';

export function mountFileIcons(doc: Document): () => void {
  const icons = new Map<SVGElement, SVGSVGElement>();
  const sync = () => {
    const wanted = new Set(Array.from(doc.querySelectorAll<SVGElement>(`${FILE_LINKS} svg[data-icon="ExternalLink"].inline`)));
    for (const [original, replacement] of icons) {
      if (!wanted.has(original)) {
        original.classList.remove('bb-file-preview-original');
        replacement.remove();
        icons.delete(original);
      }
    }
    for (const original of wanted) {
      let replacement = icons.get(original);
      if (!replacement) {
        replacement = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        replacement.setAttribute('viewBox', '0 0 24 24');
        replacement.setAttribute('aria-hidden', 'true');
        replacement.setAttribute('class', 'bb-file-preview-icon');
        replacement.innerHTML = '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>';
        icons.set(original, replacement);
      }
      original.classList.add('bb-file-preview-original');
      if (original.nextSibling !== replacement) original.after(replacement);
    }
  };
  const observer = new MutationObserver(sync);
  sync();
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  return () => {
    observer.disconnect();
    for (const [original, replacement] of icons) {
      original.classList.remove('bb-file-preview-original');
      replacement.remove();
    }
    icons.clear();
  };
}
