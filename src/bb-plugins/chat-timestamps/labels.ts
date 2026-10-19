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
      const date = new Date(message.timestamp);
      const previous = message.previousTimestamp;
      if (previous === undefined) continue;
      const changedDay = previous !== null && date.toDateString() !== new Date(previous).toDateString();
      if (previous !== null && !changedDay && message.timestamp - previous < 10 * 60 * 1000) continue;
      kept.add(column);
      let time = added.get(column);
      if (!time) {
        time = doc.createElement('time');
        time.className = 'bb-message-time';
        added.set(column, time);
      }
      const iso = date.toISOString();
      const today = date.toDateString() === new Date().toDateString();
      const day = today ? 'Today' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
      const clock = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      const label = `${day} · ${clock}`;
      // Guard writes because this script observes its own DOM changes.
      if (time.textContent !== label || time.dateTime !== iso) {
        time.dateTime = iso;
        time.title = date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' });
        time.textContent = label;
        time.setAttribute('aria-label', `Conversation resumes ${time.title}`);
      }
      if (column.firstChild !== time) column.prepend(time);
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
