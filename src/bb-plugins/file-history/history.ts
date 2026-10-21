const PANEL = '[data-panel-id="thread-detail-secondary-panel"]';
const TAB = '[data-secondary-panel-tab-content] button[aria-pressed]';

interface PanelHistory {
  entries: HTMLButtonElement[];
  index: number;
  controls: HTMLElement;
  back: HTMLButtonElement;
  forward: HTMLButtonElement;
}

export function mountFileHistory(doc: Document): () => void {
  const panels = new Map<HTMLElement, PanelHistory>();
  let route = doc.location.pathname;

  const clear = () => {
    for (const history of panels.values()) history.controls.remove();
    panels.clear();
  };

  const move = (history: PanelHistory, direction: -1 | 1) => {
    const index = history.index + direction;
    const tab = history.entries[index];
    if (!tab?.isConnected) return;
    history.index = index;
    tab.click();
  };

  const createHistory = (): PanelHistory => {
    const controls = doc.createElement('nav');
    controls.className = 'bb-file-history';
    controls.setAttribute('aria-label', 'File history');
    const button = (label: string, points: string) => {
      const node = doc.createElement('button');
      node.type = 'button';
      node.setAttribute('aria-label', label);
      node.title = label;
      node.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${points}"/></svg>`;
      controls.append(node);
      return node;
    };
    const back = button('Previous file', 'M15 18l-6-6 6-6');
    const forward = button('Next file', 'M9 18l6-6-6-6');
    const history: PanelHistory = { entries: [], index: -1, controls, back, forward };
    back.onclick = () => move(history, -1);
    forward.onclick = () => move(history, 1);
    return history;
  };

  const sync = () => {
    if (route !== doc.location.pathname) {
      clear();
      route = doc.location.pathname;
    }
    for (const [panel, history] of panels) {
      if (panel.isConnected) continue;
      history.controls.remove();
      panels.delete(panel);
    }
    for (const panel of Array.from(doc.querySelectorAll<HTMLElement>(PANEL))) {
      const active = panel.querySelector<HTMLButtonElement>(`${TAB}[aria-pressed="true"]`);
      const path = panel.querySelector('[aria-label="Copy file path"]');
      const header = path?.parentElement?.parentElement;
      let history = panels.get(panel);
      if (!active?.querySelector('[data-icon="File"]') || !header || panel.querySelector('aside[aria-hidden="true"]')) {
        history?.controls.remove();
        continue;
      }
      if (!history) {
        history = createHistory();
        panels.set(panel, history);
      }
      const live = (tab: HTMLButtonElement) => panel.contains(tab) && tab.matches(TAB);
      history.index = history.entries.slice(0, history.index + 1).filter(live).length - 1;
      history.entries = history.entries.filter(live);
      if (history.entries[history.index] !== active) {
        history.entries = history.entries.slice(0, history.index + 1);
        history.entries.push(active);
        history.index = history.entries.length - 1;
      }
      history.back.disabled = history.index <= 0;
      history.forward.disabled = history.index >= history.entries.length - 1;
      if (history.controls.parentElement !== header) header.prepend(history.controls);
    }
  };

  const mouse = (event: MouseEvent) => {
    if (event.button !== 3 && event.button !== 4) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const panel = target.closest<HTMLElement>(PANEL);
    if (!panel) return;
    sync();
    const history = panels.get(panel);
    if (!history?.controls.isConnected) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'mouseup') move(history, event.button === 3 ? -1 : 1);
  };

  const observer = new MutationObserver(sync);
  sync();
  observer.observe(doc.body, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['aria-pressed', 'aria-hidden'],
  });
  for (const type of ['mousedown', 'mouseup', 'auxclick'] as const) doc.addEventListener(type, mouse, true);
  return () => {
    observer.disconnect();
    for (const type of ['mousedown', 'mouseup', 'auxclick'] as const) doc.removeEventListener(type, mouse, true);
    clear();
  };
}
