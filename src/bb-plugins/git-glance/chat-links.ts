export type CommitLink = { threadId: string; sha: string };

const selector = '[data-timeline-row-id] [data-markdown-preview] code';
const attributes = ['role', 'tabindex', 'title', 'aria-label'] as const;

function target(code: HTMLElement): CommitLink | null {
  if (!code.matches(selector) || code.closest('pre, a, button, [contenteditable="true"]')) return null;
  const sha = code.textContent?.trim().toLowerCase() ?? '';
  // Numeric identifiers are common in prose. Git resolves candidates only after a click.
  if (!/^[0-9a-f]{7,64}$/.test(sha) || !/[a-f]/.test(sha)) return null;
  const row = code.closest('[data-timeline-row-id]')?.getAttribute('data-timeline-row-id') ?? '';
  const threadId = /^(thr_[a-zA-Z0-9]+):/.exec(row)?.[1];
  return threadId ? { threadId, sha } : null;
}

export function mountCommitLinks(doc: Document, open: (request: CommitLink) => void): () => void {
  const owned = new Map<HTMLElement, () => void>();
  const sync = () => {
    const candidates = new Set(Array.from(doc.querySelectorAll<HTMLElement>(selector)).filter(code => target(code)));
    for (const [code, cleanup] of owned) {
      if (!candidates.has(code)) { cleanup(); owned.delete(code); }
    }
    for (const code of candidates) {
      if (owned.has(code)) continue;
      // Preserve native interactive code if BB adds its own handler in a later version.
      if (code.hasAttribute('role') || code.hasAttribute('tabindex')) continue;
      const original = attributes.map(name => [name, code.getAttribute(name)] as const);
      const activate = (event: MouseEvent | KeyboardEvent) => {
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        if ('key' in event && (event.repeat || !['Enter', ' '].includes(event.key))) return;
        if (event.type === 'click' && doc.getSelection()?.toString()) return;
        const request = target(code);
        if (!request) return;
        event.preventDefault(); event.stopPropagation();
        open(request);
      };
      code.classList.add('gg-chat-commit');
      code.setAttribute('role', 'button');
      code.setAttribute('tabindex', '0');
      code.title = 'Open commit in Git Glance';
      code.setAttribute('aria-label', 'Open commit in Git Glance');
      code.addEventListener('click', activate);
      code.addEventListener('keydown', activate);
      owned.set(code, () => {
        code.removeEventListener('click', activate);
        code.removeEventListener('keydown', activate);
        code.classList.remove('gg-chat-commit');
        for (const [name, value] of original) {
          if (value === null) code.removeAttribute(name); else code.setAttribute(name, value);
        }
      });
    }
  };
  const observer = new MutationObserver(sync);
  sync();
  observer.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-timeline-row-id'] });
  return () => {
    observer.disconnect();
    for (const cleanup of owned.values()) cleanup();
    owned.clear();
  };
}
