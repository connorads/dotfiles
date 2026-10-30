import { reviewSchema, type Review } from './contracts.ts';
export type ReviewLink = Review & { threadId: string };
export const openReviewEvent = 'diff-viewer:open';

export function parseReviewReference(text: string): Review | null {
  if (!text.startsWith('git-review://')) return null;
  try {
    const url = new URL(text);
    if (!/^host_[a-zA-Z0-9]+$/.test(url.hostname) || url.username || url.password || url.port || url.hash || [...url.searchParams.keys()].some(key => key !== 'scope') || url.searchParams.getAll('scope').length !== 1) return null;
    const path = decodeURIComponent(url.pathname);
    if (!path.startsWith('/')) return null;
    for (let index = 0; index < path.length; index++) {
      const code = path.charCodeAt(index);
      if (code < 32 || code === 127) return null;
    }
    const kind = url.searchParams.get('scope');
    const parsed = reviewSchema.safeParse({ target: { hostId: url.hostname, path }, scope: kind === 'unpushed' ? { kind, commit: null } : { kind } });
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

const selector = '[data-timeline-row-id] [data-markdown-preview] code';
const attributes = ['role', 'tabindex', 'title', 'aria-label'] as const;
function target(code: HTMLElement): ReviewLink | null {
  if (!code.matches(selector) || code.closest('pre, a, button, [contenteditable="true"]')) return null;
  const checkout = parseReviewReference(code.textContent?.trim() ?? '');
  const row = code.closest('[data-timeline-row-id]')?.getAttribute('data-timeline-row-id') ?? '';
  const threadId = /^(thr_[a-zA-Z0-9]+):/.exec(row)?.[1];
  return checkout && threadId ? { ...checkout, threadId } : null;
}

export function mountReviewLinks(doc: Document, open: (request: ReviewLink) => void): () => void {
  const owned = new Map<HTMLElement, () => void>();
  const sync = () => {
    const candidates = new Set(Array.from(doc.querySelectorAll<HTMLElement>(selector)).filter(code => target(code)));
    for (const [code, cleanup] of owned) {
      if (!candidates.has(code)) { cleanup(); owned.delete(code); }
    }
    for (const code of candidates) {
      if (owned.has(code) || code.hasAttribute('role') || code.hasAttribute('tabindex')) continue;
      const original = attributes.map(name => [name, code.getAttribute(name)] as const);
      const activate = (event: MouseEvent | KeyboardEvent) => {
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        if ('key' in event && (event.repeat || !['Enter', ' '].includes(event.key))) return;
        if (event.type === 'click' && doc.getSelection()?.toString()) return;
        const request = target(code);
        if (!request) return;
        event.preventDefault(); event.stopPropagation(); open(request);
      };
      code.classList.add('dv-chat-review');
      code.setAttribute('role', 'button'); code.setAttribute('tabindex', '0');
      code.title = 'Open checkout in Diff Viewer'; code.setAttribute('aria-label', code.title);
      code.addEventListener('click', activate); code.addEventListener('keydown', activate);
      owned.set(code, () => {
        code.removeEventListener('click', activate); code.removeEventListener('keydown', activate);
        code.classList.remove('dv-chat-review');
        for (const [name, value] of original) {
          if (value === null) code.removeAttribute(name); else code.setAttribute(name, value);
        }
      });
    }
  };
  const observer = new MutationObserver(sync);
  sync();
  observer.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-timeline-row-id'] });
  return () => { observer.disconnect(); for (const cleanup of owned.values()) cleanup(); owned.clear(); };
}
