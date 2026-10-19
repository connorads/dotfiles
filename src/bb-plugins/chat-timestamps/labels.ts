import { getTimes, onTimes, setWanted } from './store';

const COLUMNS = '[data-timeline-row-id] [data-message-column]';

export function mountTimestamps(doc: Document): () => void {
  const added = new Map<HTMLElement, HTMLTimeElement>();
  const exact = new Map<HTMLElement, HTMLTimeElement>();
  const sync = () => {
    const keptActions = new Set<HTMLElement>();
    const wanted = new Set<string>();
    const kept = new Set<HTMLElement>();
    for (const column of Array.from(doc.querySelectorAll<HTMLElement>(COLUMNS))) {
      const id = column.closest<HTMLElement>('[data-timeline-row-id]')?.dataset.timelineRowId;
      if (!id || column.querySelector('time:not(.bb-message-time):not(.bb-message-exact)')) continue;
      wanted.add(id);
      const message = getTimes().get(id);
      if (!message) continue;
      const date = new Date(message.timestamp);
      const actions = column.querySelector<HTMLButtonElement>('button[aria-label="Message actions"]')?.parentElement;
      if (actions) {
        keptActions.add(actions);
        let label = exact.get(actions);
        if (!label) {
          label = doc.createElement('time');
          label.className = 'bb-message-exact opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 [@media(hover:none)]:opacity-100';
          exact.set(actions, label);
        }
        if (label.dateTime !== date.toISOString()) {
          label.dateTime = date.toISOString();
          label.textContent = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
          label.title = date.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' });
          label.setAttribute('aria-label', `Message ${message.role === 'assistant' ? 'started' : 'sent'} ${label.title}`);
        }
        if (actions.lastChild !== label) actions.append(label);
      }
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
    for (const [actions, time] of exact) {
      if (!keptActions.has(actions)) { time.remove(); exact.delete(actions); }
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
    for (const time of exact.values()) time.remove();
    exact.clear();
    setWanted(new Set());
  };
}
