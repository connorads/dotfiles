import { getHost, getTargets, nearestNavigator, onTargets, threadOf, want } from './store';

const ROW = '[data-timeline-row-id]';
const READ_ROW = /^[^:]+:(?:file-read|image-view|command):/;
const LINK = 'bb-read-link';

/** BB's title views for this row only, excluding nested rows and decoration tooltips. */
function titleViews(row: HTMLElement): HTMLElement[] {
  return Array.from(row.querySelectorAll<HTMLElement>('span[title]'))
    .filter(view => view.closest(ROW) === row && !view.parentElement?.closest('span[title]'));
}

/** The truncating segment that shows the file name. */
function fileSegment(view: HTMLElement): HTMLElement | null {
  const segments = Array.from(view.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.classList.contains('truncate'));
  return segments.at(-1) ?? null;
}

type Link = { path: string; threadId: string };

export function mountReadLinks(doc: Document): () => void {
  const links = new Map<HTMLElement, Link>();

  function decorate(segment: HTMLElement, link: Link) {
    segment.classList.add(LINK);
    segment.setAttribute('role', 'link');
    segment.setAttribute('tabindex', '0');
    segment.setAttribute('title', `Open ${link.path}`);
  }
  function undecorate(segment: HTMLElement) {
    segment.classList.remove(LINK);
    for (const name of ['role', 'tabindex', 'title']) segment.removeAttribute(name);
  }

  function sync() {
    const next = new Map<HTMLElement, Link>();
    const unknown: string[] = [];
    for (const row of Array.from(doc.querySelectorAll<HTMLElement>(ROW))) {
      const id = row.dataset.timelineRowId ?? '';
      if (!READ_ROW.test(id)) continue;
      const targets = getTargets(id);
      if (!targets) { unknown.push(id); continue; }
      const views = titleViews(row);
      // A count mismatch means BB rendered a different title layout; leave it alone.
      if (views.length !== targets.length) continue;
      views.forEach((view, index) => {
        const path = targets[index];
        const segment = path ? fileSegment(view) : null;
        if (path && segment) next.set(segment, { path, threadId: threadOf(id) });
      });
    }
    for (const segment of links.keys()) if (!next.has(segment)) undecorate(segment);
    for (const [segment, link] of next) {
      const previous = links.get(segment);
      if (previous?.path !== link.path || !segment.classList.contains(LINK)) decorate(segment, link);
    }
    links.clear();
    for (const [segment, link] of next) links.set(segment, link);
    if (unknown.length) want(unknown);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => { if (timer === undefined) timer = setTimeout(() => { timer = undefined; sync(); }, 0); };

  function open(segment: HTMLElement): boolean {
    const link = links.get(segment);
    const hostId = link && getHost(link.threadId);
    const navigator = nearestNavigator(segment);
    if (!link || !hostId || !navigator) return false;
    return navigator.navigate.experimental_openFilePreview({ target: { kind: 'host', hostId, path: link.path }, location: null });
  }
  function linkFrom(target: EventTarget | null) {
    const segment = target instanceof Element ? target.closest<HTMLElement>(`.${LINK}`) : null;
    return segment && links.has(segment) ? segment : null;
  }
  // Capture on the document so an opened link does not also toggle BB's row.
  function onClick(event: MouseEvent) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const segment = linkFrom(event.target);
    if (segment && open(segment)) { event.preventDefault(); event.stopPropagation(); }
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const segment = linkFrom(event.target);
    if (segment && event.target === segment && open(segment)) { event.preventDefault(); event.stopPropagation(); }
  }

  const observer = new MutationObserver(schedule);
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-timeline-row-id', 'title'] });
  const stopTargets = onTargets(schedule);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('keydown', onKeyDown, true);
  sync();

  return () => {
    observer.disconnect();
    stopTargets();
    clearTimeout(timer);
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('keydown', onKeyDown, true);
    for (const segment of links.keys()) undecorate(segment);
    links.clear();
  };
}
