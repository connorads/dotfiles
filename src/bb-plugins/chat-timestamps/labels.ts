import { getTimes, onTimes, setWanted } from './store';

const COLUMNS = '[data-timeline-row-id] [data-message-column]';

export function mountTimestamps(doc: Document): () => void {
  const added = new Map<HTMLElement, HTMLTimeElement>();
  const sync = () => {
    const wanted = new Set<string>();
    const kept = new Set<HTMLElement>();
    for (const column of Array.from(doc.querySelectorAll<HTMLElement>(COLUMNS))) {
      const id = column.closest<HTMLElement>('[data-timeline-row-id]')?.dataset.timelineRowId;
      if (!id || column.querySelector('time:not(.bb-message-time)')) continue;
      wanted.add(id);
      const message = getTimes().get(id);
      if (!message) continue;
      kept.add(column);
      let time = added.get(column);
      if (!time) {
        time = doc.createElement('time');
        time.className = 'bb-message-time';
        added.set(column, time);
      }
      const date = new Date(message.timestamp);
      const iso = date.toISOString();
      // Do not rewrite text on every DOM mutation; that would retrigger the observer.
      if (time.dateTime !== iso) {
        time.dateTime = iso;
        time.title = date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' });
        const today = date.toDateString() === new Date().toDateString();
        time.textContent = date.toLocaleString(undefined, {
          ...(today ? {} : { day: 'numeric', month: 'short', year: 'numeric' }),
          hour: '2-digit', minute: '2-digit',
        });
        time.setAttribute('aria-label', `${message.role === 'assistant' ? 'Message started' : 'Message sent'} ${time.title}`);
      }
      time.dataset.role = message.role;
      if (column.lastChild !== time) column.append(time);
    }
    for (const [column, time] of added) {
      if (!kept.has(column)) { time.remove(); added.delete(column); }
    }
    setWanted(wanted);
  };
  const observer = new MutationObserver(sync);
  const unsubscribe = onTimes(sync);
  sync();
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-timeline-row-id'] });
  return () => {
    observer.disconnect();
    unsubscribe();
    for (const time of added.values()) time.remove();
    added.clear();
    setWanted(new Set());
  };
}
